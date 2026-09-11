import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isOriginAllowed, loadConfig } from "../server/config";
import { applyInstall, planInstall, resolveOutputFile } from "../server/install";
import { Store, StoreError, assertInside, sha256 } from "../server/store";
import { buildProfile, validateProfileDocShape } from "../src/core/pipeline";
import { SEED_FILES } from "../src/core/seed";
import { validateProfileFieldSubset } from "../src/core/validate";
import type { StoreView } from "../src/core/pipeline";

let root: string;
let store: Store;

function seedView(): StoreView {
  const pick = (prefix: string, ext: string) =>
    Object.fromEntries(
      SEED_FILES.filter((f) => f.path.startsWith(prefix)).map((f) => [
        f.path.slice(prefix.length, -ext.length),
        f.content,
      ]),
    );
  return {
    fragments: pick("catalog/config/", ".yaml"),
    partials: pick("catalog/prompt/", ".hbs"),
    helpers: pick("catalog/helpers/", ".js"),
  };
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "aps-review-"));
  store = new Store(path.join(root, "store"));
  await store.init();
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

// (1) loopback binding and origin policy
describe("local-only network defaults", () => {
  it("defaults to loopback and a fixed list of local UI origins", () => {
    const cfg = loadConfig(root);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.allowedOrigins).not.toContain("*");
    expect(cfg.allowedOrigins).toContain("http://localhost:8080");
  });

  it("rejects a disallowed origin and allows header-less callers", () => {
    const allowed = ["http://localhost:8080"];
    expect(isOriginAllowed("http://localhost:8080", allowed)).toBe(true);
    expect(isOriginAllowed("http://evil.example", allowed)).toBe(false);
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
    expect(isOriginAllowed("http://evil.example", ["*"])).toBe(true);
  });
});

// (2) role / path containment and symlink escapes
describe("output path containment", () => {
  it("rejects a role that is not a plain document name", () => {
    const dir = path.join(root, "targetdir");
    fs.mkdirSync(dir, { recursive: true });
    expect(() => resolveOutputFile(dir, "../../escaped")).toThrow(StoreError);
    expect(() => resolveOutputFile(dir, "nested/role")).toThrow(StoreError);
    expect(() => resolveOutputFile(dir, 42)).toThrow(StoreError);
    expect(() => resolveOutputFile(dir, ["a"])).toThrow(StoreError);
    expect(resolveOutputFile(dir, "code-reviewer")).toBe(
      path.join(fs.realpathSync(dir), "code-reviewer.json"),
    );
  });

  it("refuses a role from YAML that would escape the target directory", async () => {
    const source = await store.read("profile", "code-reviewer");
    await store.write(
      "profile",
      "code-reviewer",
      source.replace("role: code-reviewer", "role: ../escaped"),
    );
    const plan = await planInstall(store, "targets.yaml", "code-reviewer");
    expect(plan.entries.every((e) => e.status === "error")).toBe(true);
    expect(plan.entries[0]!.message).toMatch(/invalid document name|inside the target directory/);
  });

  it("detects a symlinked path that leaves the containing directory", () => {
    const outside = path.join(root, "outside");
    const inside = path.join(root, "inside");
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(inside, { recursive: true });
    fs.symlinkSync(outside, path.join(inside, "link"), "dir");
    expect(() => assertInside(inside, path.join(inside, "link", "x.json"), "output")).toThrow(
      StoreError,
    );
    expect(assertInside(inside, path.join(inside, "ok.json"), "output")).toContain("ok.json");
  });

  it("rejects a document path that reaches out of the store through a symlink", async () => {
    const outside = path.join(root, "outside2");
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(store.root, "profiles-link"), "dir");
    expect(() => store.abs("profiles-link/evil.yaml")).toThrow(StoreError);
  });
});

// (3) seeding never overwrites an existing store
describe("store seeding", () => {
  it("does not seed or overwrite an existing store missing its targets file", async () => {
    const partialPath = path.join(store.root, "catalog/prompt/reader-role.hbs");
    await fsp.writeFile(partialPath, "MY OWN CONTENT", "utf8");
    await fsp.rm(store.targetsPath());

    const reopened = new Store(store.root);
    await reopened.init();

    expect(await fsp.readFile(partialPath, "utf8")).toBe("MY OWN CONTENT");
    expect(fs.existsSync(store.targetsPath())).toBe(false);
  });

  it("does not sweep unrelated files into the seed commit", async () => {
    const fresh = new Store(path.join(root, "fresh"));
    await fsp.mkdir(fresh.root, { recursive: true });
    await fsp.writeFile(path.join(fresh.root, "unrelated.txt"), "not mine", "utf8");
    await fresh.init();
    const status = await fresh.history("profile", "code-reviewer");
    expect(status.length).toBe(1);
    // unrelated.txt stays untracked: reading it at the seed commit fails.
    await expect(
      fresh.readAt("profile", "unrelated" as string, status[0]!.oid),
    ).rejects.toBeInstanceOf(StoreError);
    expect(await fsp.readFile(path.join(fresh.root, "unrelated.txt"), "utf8")).toBe("not mine");
  });
});

// (4) configured targets file is used consistently
describe("configured targets file", () => {
  it("reads, writes and versions a renamed in-store targets file", async () => {
    const custom = new Store(path.join(root, "custom"), "install-targets.yaml");
    await custom.init();
    expect(fs.existsSync(path.join(custom.root, "install-targets.yaml"))).toBe(false);
    await custom.write("targets", "targets", "demo:\n  directory: ./out/demo\n");
    expect(await custom.read("targets", "targets")).toContain("./out/demo");
    expect(fs.existsSync(path.join(custom.root, "install-targets.yaml"))).toBe(true);
    const history = await custom.history("targets", "targets");
    expect(history.length).toBeGreaterThanOrEqual(1);
    // The configured file is the one install reads: targets it does not define are errors
    // and the message names the configured file, not a hardcoded targets.yaml.
    const plan = await planInstall(custom, custom.targetsFile, "code-reviewer");
    expect(plan.entries.every((e) => e.status === "error")).toBe(true);
    expect(plan.entries[0]!.message).toContain("install-targets.yaml");
  });

  it("explains that an external targets file has no history in this store", async () => {
    const external = path.join(root, "elsewhere", "targets.yaml");
    await fsp.mkdir(path.dirname(external), { recursive: true });
    await fsp.writeFile(external, "demo:\n  directory: ./out\n", "utf8");
    const s = new Store(path.join(root, "ext-store"), external);
    await s.init();
    expect(s.targetsExternal).toBe(true);
    expect(await s.read("targets", "targets")).toContain("./out");
    expect(await s.write("targets", "targets", "demo:\n  directory: ./out2\n")).toBeNull();
    expect(await fsp.readFile(external, "utf8")).toContain("./out2");
    await expect(s.history("targets", "targets")).rejects.toThrow(/no git history/);
    await expect(s.restore("targets", "targets", "deadbeef")).rejects.toThrow(/no git history/);
  });
});

// (5) nested unknown fields are named and rejected
describe("nested unknown field rejection", () => {
  it("rejects an unknown key inside prompt and inside session", () => {
    const issues = validateProfileFieldSubset(
      { prompt: { template: "x", styl: "loud" }, session: { mode: "new", ttl: 5 } },
      "catalog/config/bad.yaml",
    );
    const text = issues.map((i) => i.message).join("\n");
    expect(text).toContain('"styl"');
    expect(text).toContain('"ttl"');
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("still reports a root-level unknown field exactly once", () => {
    const issues = validateProfileFieldSubset({ nonsense: 1 }, "catalog/config/bad.yaml");
    expect(issues.filter((i) => i.message.includes("nonsense")).length).toBe(1);
  });
});

// (6) confirmation binds bytes and destination
describe("install confirmation binding", () => {
  it("requires the proposed bytes and resolved destination from the preview", async () => {
    const plan = await planInstall(store, "targets.yaml", "code-reviewer");
    const entry = plan.entries[0]!;
    const result = await applyInstall(store, "targets.yaml", "code-reviewer", [
      { target: entry.target, expectedHash: null } as never,
    ]);
    expect(result.written).toEqual([]);
    expect(result.conflicts[0]!.message).toContain("must include");
    expect(fs.existsSync(entry.filePath)).toBe(false);
  });
  it("refuses to write when the profile output changed after the preview", async () => {
    const plan = await planInstall(store, "targets.yaml", "code-reviewer");
    const entry = plan.entries[0]!;
    // The user edits a partial after previewing — output bytes no longer match.
    const partial = await store.read("partial", "write-boundary");
    await store.write("partial", "write-boundary", `${partial}\nAFTER PREVIEW\n`);

    const result = await applyInstall(store, "targets.yaml", "code-reviewer", [
      {
        target: entry.target,
        expectedHash: entry.existingHash ?? null,
        proposedHash: entry.proposedHash!,
        filePath: entry.filePath,
      },
    ]);
    expect(result.written).toEqual([]);
    expect(result.conflicts[0]!.message).toMatch(/changed since the preview/);
    expect(fs.existsSync(entry.filePath)).toBe(false);
  });

  it("refuses to write when the destination moved after the preview", async () => {
    const plan = await planInstall(store, "targets.yaml", "code-reviewer");
    const entry = plan.entries[0]!;
    const targetsText = await store.read("targets", "targets");
    await store.write("targets", "targets", targetsText.replace("out/", "out-moved/"));

    const result = await applyInstall(store, "targets.yaml", "code-reviewer", [
      {
        target: entry.target,
        expectedHash: null,
        proposedHash: plan.proposedHash,
        filePath: entry.filePath,
      },
    ]);
    expect(result.written).toEqual([]);
    expect(result.conflicts[0]!.message).toMatch(/destination changed|changed since the preview/);
  });

  it("hashes raw bytes, so a byte-level change is never missed", async () => {
    const a = Buffer.from([0xff, 0xfe, 0x00]);
    const b = Buffer.from([0xff, 0xfd, 0x00]);
    expect(sha256(a)).not.toBe(sha256(b));
    // A lone surrogate survives hashing as bytes rather than being replaced.
    expect(sha256(Buffer.from("\uD800", "utf8"))).toBe(sha256("\uD800"));
  });

  it("writes when the confirmation still matches", async () => {
    const plan = await planInstall(store, "targets.yaml", "code-reviewer");
    const result = await applyInstall(
      store,
      "targets.yaml",
      "code-reviewer",
      plan.entries.map((e) => ({
        target: e.target,
        expectedHash: e.existingHash ?? null,
        proposedHash: e.proposedHash!,
        filePath: e.filePath,
      })),
    );
    expect(result.conflicts).toEqual([]);
    expect(result.written.length).toBe(plan.entries.length);
  });
});

// (7) malformed profile shapes produce errors, not crashes
describe("malformed profile documents", () => {
  it("reports a list where a mapping belongs", () => {
    const issues = validateProfileDocShape(["a", "b"], "profiles/x.yaml");
    expect(issues[0]!.message).toContain("must be a mapping");
  });

  it("builds without crashing when every field has the wrong type", () => {
    const built = buildProfile(
      {
        role: 42,
        imports: "reads-two-repositories",
        layout: ["a"],
        variables: ["x"],
        overrides: "nope",
        targets: { specs: true },
      } as never,
      seedView(),
    );
    expect(built.valid).toBe(false);
    const text = built.issues.map((i) => i.message).join("\n");
    expect(text).toContain('"role" must be a string');
    expect(text).toContain('"imports" must be a list');
    expect(text).toContain('"layout" must be a string');
    expect(text).toContain('"variables" must be a mapping');
    expect(text).toContain('"overrides" must be a mapping');
    expect(text).toContain('"targets" must be a list');
    expect(built.issues.every((i) => !!i.file)).toBe(true);
  });

  it("reports an empty document instead of throwing", () => {
    const built = buildProfile(null as never, seedView());
    expect(built.valid).toBe(false);
    expect(built.issues[0]!.message).toContain("empty");
  });

  it("installing a malformed profile fails with a message, not a crash", async () => {
    await store.write("profile", "code-reviewer", "- just\n- a list\n");
    await expect(applyInstall(store, "targets.yaml", "code-reviewer", [])).rejects.toThrow(
      /does not validate|must be a mapping/,
    );
  });
});
