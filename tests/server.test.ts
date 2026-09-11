import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyInstall, planInstall } from "../server/install";
import { queryProjects } from "../server/projects";
import { Store, StoreError, realResolve, sha256 } from "../server/store";

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

describe("recursive catalog", () => {
  it("discovers nested documents by extension and does not seed a nested-only store", async () => {
    const nestedRoot = path.join(root, "nested-only");
    await fsp.mkdir(path.join(nestedRoot, "catalog/policies/deep"), { recursive: true });
    await fsp.writeFile(path.join(nestedRoot, "catalog/policies/deep/read-only.yaml"), "autonomy: read_only\n");
    const nested = new Store(nestedRoot);
    await nested.init();
    expect(await nested.list("fragment")).toEqual([{ name: "read-only", path: "catalog/policies/deep/read-only.yaml", content: "autonomy: read_only\n" }]);
    expect(fs.existsSync(path.join(nestedRoot, "profiles/code-reviewer.yaml"))).toBe(false);
  });

  it("moves without changing identity and keeps history and restore across the move", async () => {
    const before = await store.read("fragment", "model-sonnet-medium");
    const oldHistory = await store.history("fragment", "model-sonnet-medium");
    await store.createDirectory("catalog/policies");
    await store.move("fragment", "model-sonnet-medium", "catalog/policies");
    expect((await store.list("fragment")).find((d) => d.name === "model-sonnet-medium")?.path).toBe("catalog/policies/model-sonnet-medium.yaml");
    const reopened = new Store(store.root);
    expect((await reopened.history("fragment", "model-sonnet-medium")).length).toBeGreaterThan(oldHistory.length);
    await reopened.restore("fragment", "model-sonnet-medium", oldHistory.at(-1)!.oid);
    expect(await reopened.read("fragment", "model-sonnet-medium")).toBe(before);
  });

  it("enforces new kebab-case names, global stems, directory safety and nonempty removal", async () => {
    await store.createDirectory("catalog/other");
    await expect(store.write("partial", "Bad_Name", "x", "catalog/other")).rejects.toThrow(/kebab-case/);
    await expect(store.write("partial", "model-sonnet-medium", "x", "catalog/other")).rejects.toThrow(/conflicts/);
    await expect(store.removeDirectory("catalog/config")).rejects.toThrow(/not empty/);
    await expect(store.createDirectory("../outside")).rejects.toThrow(/inside catalog/);
  });

  it("reports every same-kind ambiguous legacy path", async () => {
    await fsp.mkdir(path.join(store.root, "catalog/duplicate"), { recursive: true });
    await fsp.writeFile(path.join(store.root, "catalog/duplicate/model-sonnet-medium.yaml"), "autonomy: edit\n");
    await expect(store.list("fragment")).rejects.toThrow(/catalog\/config\/model-sonnet-medium.yaml.*catalog\/duplicate\/model-sonnet-medium.yaml/);
  });

  it("shows empty folders without hidden marker files and removes only empty folders", async () => {
    await store.createDirectory("catalog/empty/sub");
    expect(await store.catalogDirectories()).toContain("catalog/empty/sub");
    expect(await fsp.readdir(path.join(store.root, "catalog/empty/sub"))).toEqual([]);
    await store.removeDirectory("catalog/empty/sub");
    expect(await store.catalogDirectories()).not.toContain("catalog/empty/sub");
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

describe("optional project provider", () => {
  it("normalizes a bounded argv-only provider and reports absence/failure without throwing", async () => {
    const absent = await queryProjects({});
    expect(absent.available).toBe(false);
    const payload = JSON.stringify([{ id: "project.with-dots", name: "Example", path: "/tmp/project.with-dots", launcherProfileDirectory: "/tmp/project-with-dots/profiles" }]);
    const ok = await queryProjects({ projectProvider: { executable: process.execPath, args: ["-e", `process.stdout.write(${JSON.stringify(payload)})`] } });
    expect(ok.available).toBe(true);
    expect(ok.projects[0]?.id).toBe("project.with-dots");
    const failed = await queryProjects({ projectProvider: { executable: process.execPath, args: ["-e", "process.exit(7)"] } });
    expect(failed.available).toBe(false);
  });

  it("derives governed destinations and requires a new preview when the mapping changes", async () => {
    const snapshot = path.join(root, "projects.json");
    const firstDir = path.join(root, "launcher-one/profiles");
    const secondDir = path.join(root, "launcher-two/profiles");
    const writeProvider = (directory: string) => fsp.writeFile(snapshot, JSON.stringify([{ id: "example-project", name: "Example", path: root, launcherProfileDirectory: directory }]));
    await writeProvider(firstDir);
    const provider = { executable: process.execPath, args: ["-e", "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))", snapshot] };
    await store.write("targets", "targets", "governed:\n  project: example-project\n");
    const profile = await store.read("profile", "code-reviewer");
    await store.write("profile", "code-reviewer", profile.replace(/targets:\n(?:  - .*\n)+/, "targets:\n  - governed\n"));
    const preview = await planInstall(store, "targets.yaml", "code-reviewer", provider);
    expect(preview.entries[0]?.directory).toBe(realResolve(firstDir));
    expect(fs.existsSync(store.targetsBackupPath())).toBe(true);
    await writeProvider(secondDir);
    const applied = await applyInstall(store, "targets.yaml", "code-reviewer", [{ target: "governed", expectedHash: null, filePath: preview.entries[0]!.filePath }], provider);
    expect(applied.conflicts[0]?.message).toContain("destination changed");
    expect(fs.existsSync(firstDir)).toBe(false);
  });
});
