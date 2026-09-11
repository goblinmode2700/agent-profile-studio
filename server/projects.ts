import { execFile } from "node:child_process";

import type { StudioConfig } from "./config";

export interface GovernedProject {
  id: string;
  name: string;
  path: string;
  launcherProfileDirectory: string;
}
export interface ProjectsResult {
  available: boolean;
  measuredAt: string;
  projects: GovernedProject[];
  error?: string;
}

/** Invoke a configured executable with literal argv. Browser requests cannot supply commands. */
export async function queryProjects(config: Pick<StudioConfig, "projectProvider">): Promise<ProjectsResult> {
  const measuredAt = new Date().toISOString();
  if (!config.projectProvider) return { available: false, measuredAt, projects: [], error: "No project provider is configured." };
  const provider = config.projectProvider;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(provider.executable, provider.args ?? [], { timeout: Math.min(Math.max(provider.timeoutMs ?? 2000, 100), 10_000), maxBuffer: 2 * 1024 * 1024 },
        (error, out) => error ? reject(error) : resolve(out));
    });
    const payload = JSON.parse(stdout) as unknown;
    const raw = Array.isArray(payload) ? payload : (payload as { projects?: unknown })?.projects;
    if (!Array.isArray(raw)) throw new Error("provider output must be an array or an object with a projects array");
    const projects = raw.map((item, index) => normalizeProject(item, index));
    return { available: true, measuredAt, projects };
  } catch (error) {
    return { available: false, measuredAt, projects: [], error: (error as Error).message };
  }
}

function normalizeProject(value: unknown, index: number): GovernedProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`project ${index}: must be an object`);
  const item = value as Record<string, unknown>;
  const result = {
    id: item["id"], name: item["name"], path: item["path"],
    launcherProfileDirectory: item["launcherProfileDirectory"],
  };
  for (const [key, field] of Object.entries(result)) if (typeof field !== "string" || !field) throw new Error(`project ${index}: ${key} must be a nonempty string`);
  return result as GovernedProject;
}
