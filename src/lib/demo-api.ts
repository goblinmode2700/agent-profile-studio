import { createTwoFilesPatch } from "diff";

import { buildProfile, parseProfileDoc } from "@/core/pipeline";
import { SEED_FILES } from "@/core/seed";
import type { CommitInfo, DocKind, InstallPlanEntry, StoreSnapshot } from "@/core/types";
import { parseYaml } from "@/core/yaml";

import type { InstallPlan, StudioApi } from "./api";

const STORAGE_KEY = "agent-profile-studio-demo-v1";

interface DemoState {
  files: Record<string, string>;
  commits: Array<{ oid: string; message: string; date: string; files: Record<string, string> }>;
  /** Simulated files inside target directories. Nothing is written to disk. */
  installed: Record<string, string>;
}

const KIND_PATH: Record<DocKind, (name: string) => string> = {
  profile: (n) => `profiles/${n}.yaml`,
  fragment: (n) => `catalog/config/${n}.yaml`,
  partial: (n) => `catalog/prompt/${n}.hbs`,
  helper: (n) => `catalog/helpers/${n}.js`,
  targets: () => "targets.yaml",
};

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `demo-${(h >>> 0).toString(16)}`;
}

/**
 * Demo mode. Everything here is simulated in the browser: "commits" are snapshots in
 * localStorage and "installed files" never touch a disk. Real filesystem and git work only
 * happens through the local Node server (npm run studio).
 */
export class DemoApi implements StudioApi {
  mode = "demo" as const;
  private state: DemoState;

  constructor() {
    this.state = this.load();
  }

  private load(): DemoState {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          return JSON.parse(raw) as DemoState;
        } catch {
          /* fall through to a fresh seed */
        }
      }
    }
    const files = Object.fromEntries(SEED_FILES.map((f) => [f.path, f.content]));
    const state: DemoState = {
      files,
      commits: [
        {
          oid: hash(JSON.stringify(files)),
          message: "seed example store",
          date: new Date().toISOString(),
          files: { ...files },
        },
      ],
      installed: {},
    };
    return state;
  }

  private persist() {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    }
  }

  private snapshot(message: string): CommitInfo {
    const commit = {
      oid: hash(message + Date.now() + JSON.stringify(this.state.files)),
      message,
      date: new Date().toISOString(),
      files: { ...this.state.files },
    };
    this.state.commits.unshift(commit);
    this.persist();
    return { oid: commit.oid, message, author: "demo", date: commit.date };
  }

  reset() {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
    this.state = this.load();
    this.persist();
  }

  async getStore(): Promise<StoreSnapshot> {
    const pick = (prefix: string, ext: string) =>
      Object.entries(this.state.files)
        .filter(([p]) => p.startsWith(prefix) && p.endsWith(ext))
        .map(([p, content]) => ({ name: p.slice(prefix.length, -ext.length), content }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
      storePath: "(demo mode — in-browser store, nothing on disk)",
      mode: "demo",
      profiles: pick("profiles/", ".yaml"),
      fragments: pick("catalog/config/", ".yaml"),
      partials: pick("catalog/prompt/", ".hbs"),
      helpers: pick("catalog/helpers/", ".js"),
      targets: this.state.files["targets.yaml"] ?? "",
    };
  }

  async saveDoc(kind: DocKind, name: string, content: string) {
    const path = KIND_PATH[kind](name);
    this.state.files[path] = content;
    return this.snapshot(`save ${path}`);
  }

  async deleteDoc(kind: DocKind, name: string) {
    const path = KIND_PATH[kind](name);
    delete this.state.files[path];
    this.snapshot(`delete ${path}`);
  }

  async history(kind: DocKind, name: string): Promise<CommitInfo[]> {
    const path = KIND_PATH[kind](name);
    const out: CommitInfo[] = [];
    let previous: string | undefined;
    for (const commit of [...this.state.commits].reverse()) {
      const content = commit.files[path];
      if (content !== undefined && content !== previous) {
        out.unshift({ oid: commit.oid, message: commit.message, author: "demo", date: commit.date });
        previous = content;
      }
    }
    return out;
  }

  async version(kind: DocKind, name: string, oid: string) {
    const path = KIND_PATH[kind](name);
    const commit = this.state.commits.find((c) => c.oid === oid);
    if (!commit || commit.files[path] === undefined) throw new Error(`${path}: not in ${oid}`);
    return commit.files[path];
  }

  async diff(kind: DocKind, name: string, a: string, b?: string) {
    const path = KIND_PATH[kind](name);
    const left = await this.version(kind, name, a);
    const right = b ? await this.version(kind, name, b) : (this.state.files[path] ?? "");
    return createTwoFilesPatch(`${path}@${a.slice(0, 10)}`, `${path}@${b ? b.slice(0, 10) : "working"}`, left, right);
  }

  async restore(kind: DocKind, name: string, oid: string) {
    const content = await this.version(kind, name, oid);
    this.state.files[KIND_PATH[kind](name)] = content;
    this.snapshot(`restore ${KIND_PATH[kind](name)} from ${oid.slice(0, 10)}`);
    return content;
  }

  private build(role: string) {
    const source = this.state.files[`profiles/${role}.yaml`];
    if (source === undefined) throw new Error(`profiles/${role}.yaml: not found`);
    const parsed = parseProfileDoc(source, role);
    if (!parsed.value) throw new Error(parsed.issues[0]?.message ?? "empty profile");
    const map = (prefix: string, ext: string) =>
      Object.fromEntries(
        Object.entries(this.state.files)
          .filter(([p]) => p.startsWith(prefix) && p.endsWith(ext))
          .map(([p, c]) => [p.slice(prefix.length, -ext.length), c]),
      );
    const built = buildProfile(parsed.value, {
      fragments: map("catalog/config/", ".yaml"),
      partials: map("catalog/prompt/", ".hbs"),
      helpers: map("catalog/helpers/", ".js"),
    });
    const targets =
      parseYaml<Record<string, { directory: string }>>(
        this.state.files["targets.yaml"] ?? "",
        "targets.yaml",
      ).value ?? {};
    return { doc: parsed.value, built, targets };
  }

  async installPreview(role: string): Promise<InstallPlan> {
    const { doc, built, targets } = this.build(role);
    const proposedHash = hash(built.jsonText);
    const requested = Array.isArray(doc.targets) ? doc.targets : [];
    const entries: InstallPlanEntry[] = requested.map((name) => {
      const def = targets[name];
      if (!def?.directory || typeof def.directory !== "string") {
        return {
          target: name,
          directory: "",
          filePath: "",
          status: "error" as const,
          message: `targets.yaml: unknown target "${name}" or missing "directory".`,
        };
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(built.role)) {
        return {
          target: name,
          directory: def.directory,
          filePath: "",
          status: "error" as const,
          message: `profile "role" must be a plain name to become a file inside the target directory.`,
        };
      }
      const filePath = `${def.directory.replace(/\/$/, "")}/${built.role}.json`;
      const existing = this.state.installed[filePath];
      if (existing === undefined) {
        return {
          target: name,
          directory: def.directory,
          filePath,
          status: "new" as const,
          existingHash: null,
          proposedHash,
        };
      }
      if (existing === built.jsonText) {
        return {
          target: name,
          directory: def.directory,
          filePath,
          status: "unchanged" as const,
          existingHash: hash(existing),
          proposedHash,
        };
      }
      return {
        target: name,
        directory: def.directory,
        filePath,
        status: "changed" as const,
        existingHash: hash(existing),
        proposedHash,
        diff: createTwoFilesPatch(
          `${built.role}.json (simulated)`,
          `${built.role}.json (studio)`,
          existing,
          built.jsonText,
        ),
      };
    });
    return { jsonText: built.jsonText, proposedHash, valid: built.valid, entries };
  }

  async installApply(
    role: string,
    requested: Array<{
      target: string;
      expectedHash: string | null;
      proposedHash?: string;
      filePath?: string;
    }>,
  ) {
    const plan = await this.installPreview(role);
    if (!plan.valid) throw new Error(`profiles/${role}.yaml does not validate; refusing to install.`);
    const written: InstallPlanEntry[] = [];
    const conflicts: InstallPlanEntry[] = [];
    for (const req of requested) {
      const entry = plan.entries.find((e) => e.target === req.target);
      if (!entry || entry.status === "error") {
        conflicts.push(entry ?? { target: req.target, directory: "", filePath: "", status: "error" });
        continue;
      }
      if (req.proposedHash !== undefined && req.proposedHash !== plan.proposedHash) {
        conflicts.push({
          ...entry,
          message: `the profile output changed since the preview. Nothing was written; review the new diff.`,
        });
        continue;
      }
      if (req.filePath !== undefined && req.filePath !== entry.filePath) {
        conflicts.push({
          ...entry,
          message: `the destination changed since the preview. Nothing was written.`,
        });
        continue;
      }
      const existing = this.state.installed[entry.filePath];
      const currentHash = existing === undefined ? null : hash(existing);
      if (currentHash !== req.expectedHash) {
        conflicts.push({
          ...entry,
          existingHash: currentHash,
          message: `${entry.filePath} changed since the preview. Nothing was written; review the new diff.`,
        });
        continue;
      }
      this.state.installed[entry.filePath] = plan.jsonText;
      written.push(entry);
    }
    this.persist();
    return { written, conflicts };
  }
}
