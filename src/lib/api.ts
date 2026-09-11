import type { CommitInfo, DocKind, InstallPlanEntry, StoreSnapshot } from "@/core/types";

import { DemoApi } from "./demo-api";

export interface InstallPlan {
  jsonText: string;
  /** sha256 of the exact bytes this plan proposes to write. */
  proposedHash?: string;
  valid: boolean;
  entries: InstallPlanEntry[];
}

/** A confirmation binds the destination, the proposed bytes and the bytes already there. */
export interface InstallConfirmation {
  target: string;
  expectedHash: string | null;
  proposedHash?: string;
  filePath?: string;
}

export interface StudioApi {
  mode: "local" | "demo";
  getStore(): Promise<StoreSnapshot>;
  saveDoc(kind: DocKind, name: string, content: string, directory?: string): Promise<CommitInfo | null>;
  deleteDoc(kind: DocKind, name: string): Promise<void>;
  history(kind: DocKind, name: string): Promise<CommitInfo[]>;
  version(kind: DocKind, name: string, oid: string): Promise<string>;
  diff(kind: DocKind, name: string, a: string, b?: string): Promise<string>;
  restore(kind: DocKind, name: string, oid: string): Promise<string>;
  installPreview(role: string): Promise<InstallPlan>;
  installApply(
    role: string,
    entries: InstallConfirmation[],
  ): Promise<{ written: InstallPlanEntry[]; conflicts: InstallPlanEntry[] }>;
  createDirectory(directory: string): Promise<void>;
  deleteDirectory(directory: string): Promise<void>;
  moveDoc(kind: "fragment" | "partial" | "helper", name: string, directory: string): Promise<void>;
  getProjects(): Promise<{ available: boolean; measuredAt: string; projects: Array<{ id: string; name: string; path: string; launcherProfileDirectory: string }>; error?: string }>;
}


export const DEFAULT_LOCAL_API =
  (import.meta.env["VITE_STUDIO_API"] as string | undefined) ?? "http://localhost:4319";

class LocalApi implements StudioApi {
  mode = "local" as const;
  constructor(private base: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok && res.status !== 409) {
      throw new Error((payload as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    }
    return payload as T;
  }

  getStore() {
    return this.call<StoreSnapshot>("/api/store");
  }
  getProjects() {
    return this.call<{ available: boolean; measuredAt: string; projects: Array<{ id: string; name: string; path: string; launcherProfileDirectory: string }>; error?: string }>("/api/projects");
  }
  saveDoc(kind: DocKind, name: string, content: string, directory?: string) {
    return this.call<{ commit: CommitInfo | null }>("/api/doc", {
      method: "PUT",
      body: JSON.stringify({ kind, name, content, directory }),
    }).then((r) => r.commit);
  }
  async createDirectory(directory: string) {
    await this.call("/api/catalog/directory", { method: "POST", body: JSON.stringify({ directory }) });
  }
  async deleteDirectory(directory: string) {
    await this.call(`/api/catalog/directory?directory=${encodeURIComponent(directory)}`, { method: "DELETE" });
  }
  async moveDoc(kind: "fragment" | "partial" | "helper", name: string, directory: string) {
    await this.call("/api/catalog/move", { method: "POST", body: JSON.stringify({ kind, name, directory }) });
  }

  async deleteDoc(kind: DocKind, name: string) {
    await this.call(`/api/doc?kind=${kind}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
  }
  history(kind: DocKind, name: string) {
    return this.call<{ commits: CommitInfo[] }>(
      `/api/history?kind=${kind}&name=${encodeURIComponent(name)}`,
    ).then((r) => r.commits);
  }
  version(kind: DocKind, name: string, oid: string) {
    return this.call<{ content: string }>(
      `/api/version?kind=${kind}&name=${encodeURIComponent(name)}&oid=${oid}`,
    ).then((r) => r.content);
  }
  diff(kind: DocKind, name: string, a: string, b?: string) {
    return this.call<{ diff: string }>(
      `/api/diff?kind=${kind}&name=${encodeURIComponent(name)}&a=${a}${b ? `&b=${b}` : ""}`,
    ).then((r) => r.diff);
  }
  restore(kind: DocKind, name: string, oid: string) {
    return this.call<{ content: string }>("/api/restore", {
      method: "POST",
      body: JSON.stringify({ kind, name, oid }),
    }).then((r) => r.content);
  }
  installPreview(role: string) {
    return this.call<InstallPlan>("/api/install/preview", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  }
  installApply(role: string, entries: InstallConfirmation[]) {
    return this.call<{ written: InstallPlanEntry[]; conflicts: InstallPlanEntry[] }>(
      "/api/install/apply",
      { method: "POST", body: JSON.stringify({ role, entries }) },
    );
  }
}

/**
 * The local Node server owns the real filesystem and git. When it is not reachable —
 * for example in a hosted preview, which cannot see your disk — the studio falls back to
 * a clearly labelled in-browser demo that simulates the store.
 */
export async function connect(
  base = DEFAULT_LOCAL_API,
): Promise<{ api: StudioApi; reason?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    if (res.ok) return { api: new LocalApi(base) };
    return { api: new DemoApi(), reason: `local server answered ${res.status}` };
  } catch {
    return { api: new DemoApi(), reason: `no local server at ${base}` };
  } finally {
    clearTimeout(timer);
  }
}

export { DemoApi };
