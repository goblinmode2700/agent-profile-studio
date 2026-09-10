import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { createTwoFilesPatch } from "diff";

import { buildProfile, parseProfileDoc, type StoreView } from "../src/core/pipeline";
import type { InstallPlanEntry } from "../src/core/types";
import { parseYaml } from "../src/core/yaml";
import { Store, StoreError, assertDocName, assertInside, realResolve, sha256 } from "./store";

export interface TargetDef {
  directory: string;
}

export async function loadTargets(
  store: Store,
  targetsFile: string,
): Promise<Record<string, TargetDef>> {
  const abs = path.isAbsolute(targetsFile) ? targetsFile : store.abs(targetsFile);
  if (!fs.existsSync(abs)) return {};
  const parsed = parseYaml<Record<string, TargetDef>>(await fsp.readFile(abs, "utf8"), targetsFile);
  if (parsed.issues.length) throw new StoreError(parsed.issues[0]!.message);
  const value = parsed.value;
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new StoreError(`${targetsFile}: must be a mapping of target name to { directory }.`);
  }
  return value;
}

export async function storeView(store: Store): Promise<StoreView> {
  const [fragments, partials, helpers] = await Promise.all([
    store.list("fragment"),
    store.list("partial"),
    store.list("helper"),
  ]);
  const toMap = (list: Array<{ name: string; content: string }>) =>
    Object.fromEntries(list.map((d) => [d.name, d.content]));
  return { fragments: toMap(fragments), partials: toMap(partials), helpers: toMap(helpers) };
}

export function resolveTargetDir(store: Store, directory: string): string {
  return path.isAbsolute(directory) ? directory : path.resolve(store.root, directory);
}

/**
 * The output file name comes from `role`, which is user YAML. It must be a plain document
 * name, and the resolved file must be a direct child of the resolved target directory —
 * symlinks resolved — before anything is written.
 */
export function resolveOutputFile(dir: string, role: unknown): string {
  if (typeof role !== "string") {
    throw new StoreError(`profile "role" must be a string, not ${Array.isArray(role) ? "a list" : typeof role}.`);
  }
  assertDocName(role);
  const fileName = `${role}.json`;
  const candidate = path.join(dir, fileName);
  if (path.basename(candidate) !== fileName || path.dirname(path.resolve(candidate)) !== path.resolve(dir)) {
    throw new StoreError(`profile "role" does not produce a file inside the target directory.`, 403);
  }
  assertInside(dir, candidate, `output file "${fileName}"`);
  return realResolve(candidate);
}

export interface InstallPlanResult {
  jsonText: string;
  /** sha256 of the exact bytes this plan proposes to write. */
  proposedHash: string;
  valid: boolean;
  entries: InstallPlanEntry[];
}

export async function planInstall(
  store: Store,
  targetsFile: string,
  role: string,
): Promise<InstallPlanResult> {
  assertDocName(role);
  const source = await store.read("profile", role);
  const parsed = parseProfileDoc(source, role);
  if (!parsed.value) throw new StoreError(parsed.issues[0]?.message ?? `profiles/${role}.yaml is empty`);
  const view = await storeView(store);
  const built = buildProfile(parsed.value, view);
  const targets = await loadTargets(store, targetsFile);
  const entries: InstallPlanEntry[] = [];
  const proposedBytes = Buffer.from(built.jsonText, "utf8");
  const proposedHash = sha256(proposedBytes);

  const requested = Array.isArray(parsed.value.targets) ? parsed.value.targets : [];
  for (const name of requested) {
    if (typeof name !== "string") {
      entries.push({
        target: String(name),
        directory: "",
        filePath: "",
        status: "error",
        message: `profiles/${role}.yaml: "targets" must be a list of target names.`,
      });
      continue;
    }
    const def = targets[name];
    if (!def?.directory || typeof def.directory !== "string") {
      entries.push({
        target: name,
        directory: "",
        filePath: "",
        status: "error",
        message: `${targetsFile}: unknown target "${name}" or missing "directory".`,
      });
      continue;
    }
    const dir = resolveTargetDir(store, def.directory);
    let filePath: string;
    try {
      filePath = resolveOutputFile(dir, built.role);
    } catch (error) {
      entries.push({
        target: name,
        directory: dir,
        filePath: "",
        status: "error",
        message: (error as Error).message,
      });
      continue;
    }
    if (!fs.existsSync(filePath)) {
      entries.push({
        target: name,
        directory: dir,
        filePath,
        status: "new",
        existingHash: null,
        proposedHash,
      });
      continue;
    }
    const existing = await fsp.readFile(filePath);
    if (existing.equals(proposedBytes)) {
      entries.push({
        target: name,
        directory: dir,
        filePath,
        status: "unchanged",
        existingHash: sha256(existing),
        proposedHash,
      });
      continue;
    }
    entries.push({
      target: name,
      directory: dir,
      filePath,
      status: "changed",
      existingHash: sha256(existing),
      proposedHash,
      diff: createTwoFilesPatch(
        `${built.role}.json (on disk)`,
        `${built.role}.json (studio)`,
        existing.toString("utf8"),
        built.jsonText,
      ),
    });
  }

  return { jsonText: built.jsonText, proposedHash, valid: built.valid, entries };
}

export interface ApplyRequestEntry {
  target: string;
  /** sha256 of the bytes on disk the user saw, or null if the user saw "new". */
  expectedHash: string | null;
  /** sha256 of the exact output bytes the user confirmed. */
  proposedHash?: string;
  /** the destination the user saw resolved. */
  filePath?: string;
}

/**
 * Writes confirmed targets. A confirmation is bound to three things: the exact proposed
 * output bytes, the resolved destination, and the bytes already on disk. Any edit to the
 * profile, a partial, a fragment or the targets file between preview and apply changes one
 * of them, so the write is refused and a fresh diff is required.
 */
export async function applyInstall(
  store: Store,
  targetsFile: string,
  role: string,
  requested: ApplyRequestEntry[],
): Promise<{ written: InstallPlanEntry[]; conflicts: InstallPlanEntry[] }> {
  const plan = await planInstall(store, targetsFile, role);
  if (!plan.valid) throw new StoreError(`profiles/${role}.yaml does not validate; refusing to install.`);
  const written: InstallPlanEntry[] = [];
  const conflicts: InstallPlanEntry[] = [];
  const proposedBytes = Buffer.from(plan.jsonText, "utf8");

  for (const req of requested) {
    const entry = plan.entries.find((e) => e.target === req.target);
    if (!entry || entry.status === "error") {
      conflicts.push(
        entry ?? { target: req.target, directory: "", filePath: "", status: "error", message: "unknown target" },
      );
      continue;
    }
    if (req.proposedHash !== undefined && req.proposedHash !== plan.proposedHash) {
      conflicts.push({
        ...entry,
        status: "changed",
        message: `the profile output changed since the preview (profile, partial, fragment or targets edit). Nothing was written; review the new diff.`,
      });
      continue;
    }
    if (req.filePath !== undefined && req.filePath !== entry.filePath) {
      conflicts.push({
        ...entry,
        status: "changed",
        message: `the destination changed since the preview (was ${req.filePath}, now ${entry.filePath}). Nothing was written.`,
      });
      continue;
    }
    const currentHash = fs.existsSync(entry.filePath)
      ? sha256(await fsp.readFile(entry.filePath))
      : null;
    if (currentHash !== req.expectedHash) {
      conflicts.push({
        ...entry,
        status: "changed",
        existingHash: currentHash,
        message: `${entry.filePath} changed on disk since the preview. Nothing was written; review the new diff.`,
      });
      continue;
    }
    if (entry.status === "unchanged") {
      written.push(entry);
      continue;
    }
    await fsp.mkdir(entry.directory, { recursive: true });
    assertInside(entry.directory, entry.filePath, `output file "${path.basename(entry.filePath)}"`);
    await fsp.writeFile(entry.filePath, proposedBytes);
    written.push({ ...entry, status: entry.status });
  }

  return { written, conflicts };
}
