import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyInstall, planInstall } from "../server/install";
import { Store, StoreError, sha256 } from "../server/store";

let root: string;
let store: Store;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "aps-test-"));
  store = new Store(path.join(root, "store"));
  await store.init();
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe("store paths", () => {
  it("seeds the example store and commits it", async () => {
    expect((await store.list("profile")).map((p) => p.name)).toEqual(["code-reviewer"]);
    expect((await store.list("fragment")).length).toBe(3);
    expect((await store.history("profile", "code-reviewer")).length).toBe(1);
  });

  it("rejects a document name that escapes the store", async () => {
    await expect(store.write("profile", "../../evil", "role: x")).rejects.toBeInstanceOf(
      StoreError,
    );
    await expect(store.write("partial", "a/b", "x")).rejects.toBeInstanceOf(StoreError);
    expect(() => store.abs("../outside.txt")).toThrow(StoreError);
  });
});

describe("git history, diff and restore", () => {
  it("commits every save and restores an earlier version", async () => {
    const original = await store.read("profile", "code-reviewer");
    await store.write("profile", "code-reviewer", original.replace("spec-03", "spec-99"));
    const history = await store.history("profile", "code-reviewer");
    expect(history.length).toBe(2);

    const older = history[history.length - 1];
    expect(await store.readAt("profile", "code-reviewer", older.oid)).toContain("spec-03");

    await store.restore("profile", "code-reviewer", older.oid);
    expect(await store.read("profile", "code-reviewer")).toContain("spec-03");
    expect((await store.history("profile", "code-reviewer")).length).toBe(3);
  });
});

describe("install", () => {
  const hashOf = (p: string) => sha256(fs.readFileSync(p, "utf8"));

  it("reports new, writes, then reports unchanged", async () => {
    const first = await planInstall(store, "targets.yaml", "code-reviewer");
    expect(first.entries.map((e) => e.status)).toEqual(["new", "new"]);

    const applied = await applyInstall(
      store,
      "targets.yaml",
      "code-reviewer",
      first.entries.map((e) => ({ target: e.target, expectedHash: null })),
    );
    expect(applied.conflicts).toEqual([]);
    const [a, b] = first.entries.map((e) => fs.readFileSync(e.filePath, "utf8"));
    expect(a).toBe(b);
    expect(JSON.parse(a).prompt.template).toContain("$project");

    const second = await planInstall(store, "targets.yaml", "code-reviewer");
    expect(second.entries.map((e) => e.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("shows a diff when a variable changed", async () => {
    const plan = await planInstall(store, "targets.yaml", "code-reviewer");
    await applyInstall(
      store,
      "targets.yaml",
      "code-reviewer",
      plan.entries.map((e) => ({ target: e.target, expectedHash: null })),
    );
    const source = await store.read("profile", "code-reviewer");
    await store.write("profile", "code-reviewer", source.replace("spec-03", "spec-77"));

    const changed = await planInstall(store, "targets.yaml", "code-reviewer");
    expect(changed.entries.every((e) => e.status === "changed")).toBe(true);
    expect(changed.entries[0].diff).toContain("spec-77");
  });

  it("refuses to overwrite when the file changed since the preview", async () => {
    const plan = await planInstall(store, "targets.yaml", "code-reviewer");
    await applyInstall(
      store,
      "targets.yaml",
      "code-reviewer",
      plan.entries.map((e) => ({ target: e.target, expectedHash: null })),
    );
    const source = await store.read("profile", "code-reviewer");
    await store.write("profile", "code-reviewer", source.replace("spec-03", "spec-77"));

    const stale = await planInstall(store, "targets.yaml", "code-reviewer");
    const entry = stale.entries[0];
    // Someone else edits the installed file after the preview was taken.
    await fsp.writeFile(entry.filePath, '{"provider":"claude"}\n', "utf8");

    const result = await applyInstall(store, "targets.yaml", "code-reviewer", [
      { target: entry.target, expectedHash: entry.existingHash ?? null },
    ]);
    expect(result.written).toEqual([]);
    expect(result.conflicts[0].message).toContain("changed on disk");
    expect(fs.readFileSync(entry.filePath, "utf8")).toBe('{"provider":"claude"}\n');

    // Re-previewing yields a fresh hash, and confirming with it writes.
    const fresh = await planInstall(store, "targets.yaml", "code-reviewer");
    const freshEntry = fresh.entries.find((e) => e.target === entry.target)!;
    const ok = await applyInstall(store, "targets.yaml", "code-reviewer", [
      { target: freshEntry.target, expectedHash: hashOf(freshEntry.filePath) },
    ]);
    expect(ok.conflicts).toEqual([]);
    expect(fs.readFileSync(freshEntry.filePath, "utf8")).toContain("spec-77");
  });

  it("refuses to install a profile that does not validate", async () => {
    const source = await store.read("profile", "code-reviewer");
    await store.write(
      "profile",
      "code-reviewer",
      source.replace("effort: high", "temperature: 0.5"),
    );
    await expect(
      applyInstall(store, "targets.yaml", "code-reviewer", [
        { target: "reference-project", expectedHash: null },
      ]),
    ).rejects.toThrow(/does not validate/);
  });
});
