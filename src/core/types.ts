export type DocKind = "profile" | "fragment" | "partial" | "helper" | "targets";

export interface StudioIssue {
  /** Human readable message, always naming file / field / partial. */
  message: string;
  file?: string | undefined;
  field?: string | undefined;
  partial?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  severity: "error" | "warning";
}

export interface StoreDoc {
  name: string;
  content: string;
  /** Store-relative source path. Names remain flat stems. */
  path?: string;
}

export interface StoreSnapshot {
  storePath: string;
  mode: "local" | "demo";
  profiles: StoreDoc[];
  fragments: StoreDoc[];
  partials: StoreDoc[];
  helpers: StoreDoc[];
  targets: string;
  /** Configured targets file, as given in studio.config.json. */
  targetsFile?: string;
  /** True when the targets file lives outside the store, so it has no git history here. */
  targetsExternal?: boolean;
  targetsBackup?: string;
  /** Store-relative catalog directories, including empty uncommitted folders. */
  catalogDirectories?: string[];
}


export interface ProfileDoc {
  role?: string;
  imports?: string[];
  layout?: string;
  variables?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  targets?: string[];
}

export interface BuildResult {
  role: string;
  renderInput: Record<string, unknown>;
  promptText: string;
  json: Record<string, unknown> | null;
  jsonText: string;
  issues: StudioIssue[];
  valid: boolean;
  renderMs: number;
}

export interface CommitInfo {
  oid: string;
  message: string;
  author: string;
  date: string;
}

export interface InstallPlanEntry {
  target: string;
  directory: string;
  filePath: string;
  status: "new" | "unchanged" | "changed" | "error";
  diff?: string;
  existingHash?: string | null;
  /** sha256 of the exact output bytes this entry proposes to write. */
  proposedHash?: string;
  message?: string;
}
