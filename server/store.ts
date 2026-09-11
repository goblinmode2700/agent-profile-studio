import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { SEED_FILES } from "../src/core/seed";
import type { CommitInfo, DocKind } from "../src/core/types";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NEW_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KIND_DIR: Record<Exclude<DocKind, "targets">, { dir: string; ext: string }> = {
  profile: { dir: "profiles", ext: ".yaml" },
  fragment: { dir: "catalog/config", ext: ".yaml" },
  partial: { dir: "catalog/prompt", ext: ".hbs" },
  helper: { dir: "catalog/helpers", ext: ".js" },
};
const CATALOG_EXT_KIND = { ".yaml": "fragment", ".hbs": "partial", ".js": "helper" } as const;
type CatalogKind = Exclude<DocKind, "profile" | "targets">;

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
  private movedFrom = new Map<string, string[]>();

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

  targetsBackupPath(): string {
    return `${this.targetsPath()}.studio-backup`;
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

  private async rel(kind: DocKind, name: string): Promise<string> {
    if (kind === "targets" || kind === "profile") return docRelPath(kind, name, this.targetsFile);
    const matches = (await this.catalogIndex()).filter(
      (entry) => entry.kind === kind && entry.name === name,
    );
    if (matches.length > 1) {
      throw new StoreError(
        `${kind} "${name}" is ambiguous: ${matches.map((m) => m.path).join(", ")}`,
        409,
      );
    }
    return matches[0]?.path ?? docRelPath(kind, name, this.targetsFile);
  }

  async pathFor(kind: DocKind, name: string): Promise<string> {
    return this.rel(kind, name);
  }

  private catalogDirectory(directory: string, allowRoot = true): string {
    const catalogRoot = this.abs("catalog");
    const resolved = this.abs(directory);
    assertInside(catalogRoot, resolved, `catalog directory "${directory}"`);
    const relative = path.relative(this.root, resolved).split(path.sep).join("/");
    if (!allowRoot && relative === "catalog")
      throw new StoreError("cannot remove the catalog root");
    return relative;
  }

  private async historicalPaths(rel: string): Promise<string[]> {
    const paths = new Set([rel, ...(this.movedFrom.get(rel) ?? [])]);
    const log = await git.log({ fs, dir: this.root }).catch(() => []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of log) {
        const match = entry.commit.message.trim().match(/^move (.+) -> (.+)$/);
        if (match && paths.has(match[2]!) && !paths.has(match[1]!)) {
          paths.add(match[1]!);
          changed = true;
        }
      }
    }
    return [...paths];
  }

  async catalogIndex(): Promise<Array<{ kind: CatalogKind; name: string; path: string }>> {
    const root = this.abs("catalog");
    if (!fs.existsSync(root)) return [];
    const out: Array<{ kind: CatalogKind; name: string; path: string }> = [];
    const queue = ["catalog"];
    while (queue.length) {
      const rel = queue.shift()!;
      const entries = await fsp.readdir(this.abs(rel), { withFileTypes: true });
      for (const entry of entries) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) queue.push(child);
        else if (entry.isFile()) {
          const ext = path.extname(entry.name) as keyof typeof CATALOG_EXT_KIND;
          const kind = CATALOG_EXT_KIND[ext];
          if (kind) out.push({ kind, name: path.basename(entry.name, ext), path: child });
        }
      }
    }
    const stems = new Map<string, string[]>();
    for (const entry of out) stems.set(entry.name, [...(stems.get(entry.name) ?? []), entry.path]);
    const duplicates = [...stems].filter(([, paths]) => paths.length > 1);
    if (duplicates.length)
      throw new StoreError(
        duplicates
          .map(([name, paths]) => `catalog stem "${name}" is ambiguous: ${paths.join(", ")}`)
          .join("; "),
        409,
      );
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async catalogDirectories(): Promise<string[]> {
    const out: string[] = ["catalog"];
    const queue = ["catalog"];
    while (queue.length) {
      const rel = queue.shift()!;
      if (!fs.existsSync(this.abs(rel))) continue;
      for (const entry of await fsp.readdir(this.abs(rel), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = `${rel}/${entry.name}`;
        out.push(child);
        queue.push(child);
      }
    }
    return out.sort();
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
    if ((await this.list("profile")).length || (await this.catalogIndex()).length) return false;
    return true;
  }

  async list(kind: Exclude<DocKind, "targets">): Promise<Array<{ name: string; content: string }>> {
    const spec = KIND_DIR[kind];
    const paths =
      kind === "profile"
        ? fs.existsSync(this.abs("profiles"))
          ? (await fsp.readdir(this.abs("profiles"), { withFileTypes: true }))
              .filter((e) => e.isFile() && e.name.endsWith(spec.ext))
              .map((e) => ({ name: e.name.slice(0, -spec.ext.length), path: `profiles/${e.name}` }))
          : []
        : (await this.catalogIndex()).filter((entry) => entry.kind === kind);
    const duplicates = new Map<string, string[]>();
    for (const entry of paths)
      duplicates.set(entry.name, [...(duplicates.get(entry.name) ?? []), entry.path]);
    const ambiguous = [...duplicates].filter(([, matches]) => matches.length > 1);
    if (ambiguous.length)
      throw new StoreError(
        ambiguous
          .map(([name, matches]) => `${kind} "${name}" is ambiguous: ${matches.join(", ")}`)
          .join("; "),
        409,
      );
    const out: Array<{ name: string; content: string; path: string }> = [];
    for (const entry of paths)
      out.push({
        name: entry.name,
        path: entry.path,
        content: await fsp.readFile(this.abs(entry.path), "utf8"),
      });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(kind: DocKind, name: string): Promise<string> {
    const rel = await this.rel(kind, name);
    const target = kind === "targets" ? this.targetsPath() : this.abs(rel);
    try {
      return await fsp.readFile(target, "utf8");
    } catch {
      throw new StoreError(`${rel}: not found`, 404);
    }
  }

  async write(
    kind: DocKind,
    name: string,
    content: string,
    directory?: string,
  ): Promise<CommitInfo | null> {
    assertDocName(name);
    let rel = await this.rel(kind, name);
    const exists =
      kind === "targets" ? fs.existsSync(this.targetsPath()) : fs.existsSync(this.abs(rel));
    if (!exists && kind !== "targets" && kind !== "profile") {
      if (!NEW_NAME_RE.test(name))
        throw new StoreError(`new document name "${name}" must be kebab-case.`);
      const collision = (await this.catalogIndex()).find((entry) => entry.name === name);
      if (collision)
        throw new StoreError(`new document stem "${name}" conflicts with ${collision.path}.`, 409);
      const dir = this.catalogDirectory(directory ?? KIND_DIR[kind].dir);
      rel = `${dir}/${name}${KIND_DIR[kind].ext}`;
    }
    const target = kind === "targets" ? this.targetsPath() : this.abs(rel);
    if (kind === "targets" && fs.existsSync(target) && !fs.existsSync(this.targetsBackupPath())) {
      await fsp.copyFile(target, this.targetsBackupPath(), fs.constants.COPYFILE_EXCL);
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, "utf8");
    if (kind === "targets" && this.targetsExternal) return null;
    return this.commitPaths([rel], `save ${rel}`);
  }

  async remove(kind: DocKind, name: string): Promise<CommitInfo> {
    this.assertTracked(kind, "delete");
    const rel = await this.rel(kind, name);
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
    const rel = await this.rel(kind, name);
    const paths = await this.historicalPaths(rel);
    const logs = await Promise.all(
      paths.map((filepath) =>
        git.log({ fs, dir: this.root, filepath, force: true, follow: false }).catch(() => []),
      ),
    );
    const log = [...new Map(logs.flat().map((entry) => [entry.oid, entry])).values()].sort(
      (a, b) => b.commit.author.timestamp - a.commit.author.timestamp,
    );
    return log.map((entry) => ({
      oid: entry.oid,
      message: entry.commit.message.trim(),
      author: entry.commit.author.name,
      date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
    }));
  }

  async readAt(kind: DocKind, name: string, oid: string): Promise<string> {
    this.assertTracked(kind, "reading an earlier version");
    const rel = await this.rel(kind, name);
    for (const candidate of await this.historicalPaths(rel)) {
      try {
        const { blob } = await git.readBlob({ fs, dir: this.root, oid, filepath: candidate });
        return new TextDecoder().decode(blob);
      } catch {
        /* try the pre-move path */
      }
    }
    throw new StoreError(`${rel}: not present in commit ${oid.slice(0, 8)}`, 404);
  }

  async restore(kind: DocKind, name: string, oid: string): Promise<CommitInfo> {
    this.assertTracked(kind, "restore");
    const content = await this.readAt(kind, name, oid);
    const rel = await this.rel(kind, name);
    await fsp.writeFile(this.abs(rel), content, "utf8");
    return this.commitPaths([rel], `restore ${rel} from ${oid.slice(0, 8)}`);
  }

  async createDirectory(directory: string): Promise<void> {
    await fsp.mkdir(this.abs(this.catalogDirectory(directory)), { recursive: true });
  }

  async removeDirectory(directory: string): Promise<void> {
    const safeDirectory = this.catalogDirectory(directory, false);
    const target = this.abs(safeDirectory);
    if ((await fsp.readdir(target)).length)
      throw new StoreError(`${safeDirectory}: directory is not empty`, 409);
    await fsp.rmdir(target);
  }

  async move(kind: CatalogKind, name: string, directory: string): Promise<CommitInfo> {
    const safeDirectory = this.catalogDirectory(directory);
    const from = await this.rel(kind, name);
    const to = `${safeDirectory}/${name}${KIND_DIR[kind].ext}`;
    if (from === to) throw new StoreError(`${from}: already in that directory`, 409);
    if (safeDirectory.startsWith(`${from}/`))
      throw new StoreError("cannot move a directory into itself");
    if (fs.existsSync(this.abs(to))) throw new StoreError(`${to}: destination already exists`, 409);
    await fsp.mkdir(this.abs(safeDirectory), { recursive: true });
    await fsp.rename(this.abs(from), this.abs(to));
    await git.remove({ fs, dir: this.root, filepath: from }).catch(() => undefined);
    await git.add({ fs, dir: this.root, filepath: to });
    this.movedFrom.set(to, [from, ...(this.movedFrom.get(from) ?? [])]);
    return this.commit(`move ${from} -> ${to}`);
  }
}

/** Hash raw bytes, never a decoded string, so byte-level changes can never be missed. */
export function sha256(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
