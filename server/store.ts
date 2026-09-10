import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { SEED_FILES } from "../src/core/seed";
import type { CommitInfo, DocKind } from "../src/core/types";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const KIND_DIR: Record<Exclude<DocKind, "targets">, { dir: string; ext: string }> = {
  profile: { dir: "profiles", ext: ".yaml" },
  fragment: { dir: "catalog/config", ext: ".yaml" },
  partial: { dir: "catalog/prompt", ext: ".hbs" },
  helper: { dir: "catalog/helpers", ext: ".js" },
};

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Document names are single path segments; nothing that could climb out of the store. */
export function assertDocName(name: string): string {
  if (typeof name !== "string" || !NAME_RE.test(name) || name.includes("..")) {
    throw new StoreError(
      `invalid document name "${String(name)}": use letters, digits, dot, dash and underscore only.`,
    );
  }
  return name;
}

export function docRelPath(kind: DocKind, name: string, targetsFile = "targets.yaml"): string {
  if (kind === "targets") return targetsFile;
  assertDocName(name);
  const spec = KIND_DIR[kind];
  if (!spec) throw new StoreError(`unknown document kind "${kind}"`);
  return `${spec.dir}/${name}${spec.ext}`;
}

/**
 * Resolve symlinks for the deepest existing ancestor of a path, so a symlinked directory
 * or file cannot be used to escape a containing directory.
 */
export function realResolve(target: string): string {
  let current = path.resolve(target);
  const tail: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    tail.unshift(path.basename(current));
    current = parent;
  }
  let real: string;
  try {
    real = fs.realpathSync(current);
  } catch {
    real = current;
  }
  return tail.length ? path.join(real, ...tail) : real;
}

/** Throws unless `target` really lives inside `dir`, symlinks included. */
export function assertInside(dir: string, target: string, label: string): string {
  const realDir = realResolve(dir);
  const realTarget = realResolve(target);
  const withSep = realDir.endsWith(path.sep) ? realDir : realDir + path.sep;
  if (realTarget !== realDir && !realTarget.startsWith(withSep)) {
    throw new StoreError(`${label} resolves outside ${dir}`, 403);
  }
  return realTarget;
}

export class Store {
  /** Configured targets file: relative (git-tracked, inside the store) or absolute (external). */
  readonly targetsFile: string;

  constructor(
    readonly root: string,
    targetsFile = "targets.yaml",
  ) {
    this.targetsFile = targetsFile;
  }

  /** True when the targets file lives outside the store and therefore outside its git history. */
  get targetsExternal(): boolean {
    return path.isAbsolute(this.targetsFile);
  }

  targetsPath(): string {
    return this.targetsExternal ? this.targetsFile : this.abs(this.targetsFile);
  }

  /** Every filesystem access goes through here: the path must stay inside the store. */
  abs(relPath: string): string {
    const resolved = path.resolve(this.root, relPath);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new StoreError(`path "${relPath}" escapes the store directory`, 403);
    }
    assertInside(this.root, resolved, `path "${relPath}"`);
    return resolved;
  }

  private rel(kind: DocKind, name: string): string {
    return docRelPath(kind, name, this.targetsFile);
  }

  private assertTracked(kind: DocKind, action: string): void {
    if (kind === "targets" && this.targetsExternal) {
      throw new StoreError(
        `the targets file is configured outside the store (${this.targetsFile}), so it has no git history in this store: ${action} is unavailable for it.`,
        409,
      );
    }
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
    for (const dir of ["catalog/config", "catalog/prompt", "catalog/helpers", "profiles"]) {
      await fsp.mkdir(this.abs(dir), { recursive: true });
    }
    if (!fs.existsSync(path.join(this.root, ".git"))) {
      await git.init({ fs, dir: this.root, defaultBranch: "main" });
    }
    // Seed ONLY a genuinely new, empty store. An existing store is never written over,
    // not even file by file, and no unrelated file is dragged into the seed commit.
    if (!(await this.isEmpty())) return;
    const written: string[] = [];
    for (const file of SEED_FILES) {
      const target = this.abs(file.path);
      if (fs.existsSync(target)) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, file.content, "utf8");
      written.push(file.path);
    }
    if (written.length) await this.commitPaths(written, "seed example store");
  }

  /** A store counts as new when it holds no documents and no targets file of its own. */
  private async isEmpty(): Promise<boolean> {
    if (!this.targetsExternal && fs.existsSync(this.targetsPath())) return false;
    for (const kind of Object.keys(KIND_DIR) as Array<Exclude<DocKind, "targets">>) {
      if ((await this.list(kind)).length) return false;
    }
    return true;
  }

  async list(kind: Exclude<DocKind, "targets">): Promise<Array<{ name: string; content: string }>> {
    const spec = KIND_DIR[kind];
    const dir = this.abs(spec.dir);
    if (!fs.existsSync(dir)) return [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const out: Array<{ name: string; content: string }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(spec.ext)) continue;
      out.push({
        name: entry.name.slice(0, -spec.ext.length),
        content: await fsp.readFile(this.abs(`${spec.dir}/${entry.name}`), "utf8"),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(kind: DocKind, name: string): Promise<string> {
    const rel = this.rel(kind, name);
    const target = kind === "targets" ? this.targetsPath() : this.abs(rel);
    try {
      return await fsp.readFile(target, "utf8");
    } catch {
      throw new StoreError(`${rel}: not found`, 404);
    }
  }

  async write(kind: DocKind, name: string, content: string): Promise<CommitInfo | null> {
    const rel = this.rel(kind, name);
    const target = kind === "targets" ? this.targetsPath() : this.abs(rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, "utf8");
    if (kind === "targets" && this.targetsExternal) return null;
    return this.commitPaths([rel], `save ${rel}`);
  }

  async remove(kind: DocKind, name: string): Promise<CommitInfo> {
    this.assertTracked(kind, "delete");
    const rel = this.rel(kind, name);
    await fsp.rm(this.abs(rel), { force: true });
    await git.remove({ fs, dir: this.root, filepath: rel }).catch(() => undefined);
    return this.commit(`delete ${rel}`);
  }

  async commitPaths(paths: string[], message: string): Promise<CommitInfo> {
    for (const rel of paths) await git.add({ fs, dir: this.root, filepath: rel });
    return this.commit(message);
  }

  private async commit(message: string): Promise<CommitInfo> {
    const oid = await git.commit({
      fs,
      dir: this.root,
      message,
      author: { name: "Agent Profile Studio", email: "studio@localhost" },
    });
    const [entry] = await git.log({ fs, dir: this.root, depth: 1 });
    return {
      oid,
      message,
      author: entry?.commit.author.name ?? "Agent Profile Studio",
      date: new Date((entry?.commit.author.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
    };
  }

  async history(kind: DocKind, name: string): Promise<CommitInfo[]> {
    this.assertTracked(kind, "history");
    const rel = this.rel(kind, name);
    const log = await git
      .log({ fs, dir: this.root, filepath: rel, force: true, follow: false })
      .catch(() => []);
    return log.map((entry) => ({
      oid: entry.oid,
      message: entry.commit.message.trim(),
      author: entry.commit.author.name,
      date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
    }));
  }

  async readAt(kind: DocKind, name: string, oid: string): Promise<string> {
    this.assertTracked(kind, "reading an earlier version");
    const rel = this.rel(kind, name);
    try {
      const { blob } = await git.readBlob({ fs, dir: this.root, oid, filepath: rel });
      return new TextDecoder().decode(blob);
    } catch {
      throw new StoreError(`${rel}: not present in commit ${oid.slice(0, 8)}`, 404);
    }
  }

  async restore(kind: DocKind, name: string, oid: string): Promise<CommitInfo> {
    this.assertTracked(kind, "restore");
    const content = await this.readAt(kind, name, oid);
    const rel = this.rel(kind, name);
    await fsp.writeFile(this.abs(rel), content, "utf8");
    return this.commitPaths([rel], `restore ${rel} from ${oid.slice(0, 8)}`);
  }
}

/** Hash raw bytes, never a decoded string, so byte-level changes can never be missed. */
export function sha256(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
