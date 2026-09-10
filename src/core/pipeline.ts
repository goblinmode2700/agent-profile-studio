import { validateDollarPlaceholders, findPlaceholderProvenance } from "./dollars";
import { deepMergeProfileParts } from "./merge";
import { renderTemplate } from "./render";
import { PROFILE_DOC_FIELDS } from "./schema";
import type { BuildResult, ProfileDoc, StudioIssue } from "./types";
import { projectLauncherFields, validateLauncherJson, validateProfileFieldSubset } from "./validate";
import { parseYaml } from "./yaml";

export interface StoreView {
  /** fragment stem -> YAML source */
  fragments: Record<string, string>;
  /** partial stem -> Handlebars source */
  partials: Record<string, string>;
  /** helper stem -> JS source */
  helpers: Record<string, string>;
}

/**
 * Documented resolution of the spec ambiguity:
 * imported fragments, then `variables`, then `overrides` merge into ONE render input, in
 * that order. The same object is the Handlebars input. Only schema-defined keys are then
 * projected into the launcher JSON, so arbitrary template variables never leak into output.
 * Fragments and `overrides` reject unknown profile fields; `variables` may hold anything.
 */
/**
 * Structural validation of a profile document, before anything is trimmed or iterated.
 * Malformed YAML shapes (a list where a mapping belongs, a numeric role, …) become
 * file/field errors instead of runtime crashes.
 */
export function validateProfileDocShape(doc: unknown, file: string): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const err = (message: string, field?: string) =>
    issues.push({ severity: "error", file, ...(field ? { field } : {}), message });

  if (doc == null) {
    err(`${file}: the document is empty; expected a mapping of profile document fields.`);
    return issues;
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    err(`${file}: must be a mapping, not ${Array.isArray(doc) ? "a list" : typeof doc}.`);
    return issues;
  }
  const record = doc as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(PROFILE_DOC_FIELDS as readonly string[]).includes(key)) {
      err(
        `${file}: unknown profile document field "${key}". Allowed: ${PROFILE_DOC_FIELDS.join(", ")}.`,
        key,
      );
    }
  }
  if (record["role"] !== undefined && typeof record["role"] !== "string") {
    err(`${file}: "role" must be a string.`, "role");
  }
  if (record["layout"] !== undefined && typeof record["layout"] !== "string") {
    err(`${file}: "layout" must be a string.`, "layout");
  }
  for (const key of ["imports", "targets"]) {
    const value = record[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      err(`${file}: "${key}" must be a list of names.`, key);
    }
  }
  for (const key of ["variables", "overrides"]) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) {
      err(`${file}: "${key}" must be a mapping.`, key);
    }
  }
  return issues;
}

export function buildProfile(doc: ProfileDoc, store: StoreView): BuildResult {
  const rawRole = (doc as Record<string, unknown> | null)?.["role"];
  const role = typeof rawRole === "string" ? rawRole.trim() : "untitled";
  const file = `profiles/${role || "untitled"}.yaml`;
  const shapeIssues = validateProfileDocShape(doc, file);
  const issues: StudioIssue[] = [...shapeIssues];

  const record = (doc && typeof doc === "object" && !Array.isArray(doc)
    ? (doc as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const listOf = (key: string): string[] => {
    const value = record[key];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  };
  const mapOf = (key: string): Record<string, unknown> => {
    const value = record[key];
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  };


  // 1. imports -> deep merge, later wins
  const fragmentObjects: Array<Record<string, unknown>> = [];
  for (const name of listOf("imports")) {
    const source = store.fragments[name];
    const fragFile = `catalog/config/${name}.yaml`;
    if (source === undefined) {
      issues.push({
        severity: "error",
        file: fragFile,
        message: `${file}: missing config fragment "${name}" (expected ${fragFile}).`,
      });
      continue;
    }
    const parsed = parseYaml<Record<string, unknown>>(source, fragFile);
    issues.push(...parsed.issues);
    if (parsed.value) {
      issues.push(...validateProfileFieldSubset(parsed.value, fragFile, "fragment"));
      fragmentObjects.push(parsed.value);
    }
  }

  issues.push(...validateProfileFieldSubset(record["overrides"] ?? {}, file, "overrides"));

  // 2. fragments -> variables -> overrides, in that order
  const renderInput = deepMergeProfileParts([
    ...fragmentObjects,
    mapOf("variables"),
    mapOf("overrides"),
  ]);

  // 3. render the layout with the catalog partials
  const layout = typeof record["layout"] === "string" ? (record["layout"] as string) : "";

  const render = renderTemplate({
    layout,
    partials: store.partials,
    helpers: store.helpers,
    input: renderInput,
    file,
  });
  issues.push(...render.issues);
  const promptText = render.text;

  // 4. dollar placeholders: $project and $cwd only, every $ left untouched
  const dollarIssues = validateDollarPlaceholders(promptText, { file });
  for (const di of dollarIssues) {
    const provenance = di.field ? findPlaceholderProvenance(di.field, store.partials) : [];
    issues.push(
      provenance.length
        ? {
            ...di,
            partial: provenance[0],
            message: `${di.message} Contributed by partial${provenance.length > 1 ? "s" : ""}: ${provenance
              .map((p) => `catalog/prompt/${p}.hbs`)
              .join(", ")}.`,
          }
        : di,
    );
  }

  // 5. project only schema keys, then place the prompt text
  const fields = projectLauncherFields(renderInput);
  const mergedPrompt = fields["prompt"];
  if (layout.trim() === "" && mergedPrompt == null) {
    fields["prompt"] = null;
  } else {
    const mode =
      mergedPrompt && typeof mergedPrompt === "object" && "mode" in mergedPrompt
        ? (mergedPrompt as { mode?: unknown }).mode
        : undefined;
    fields["prompt"] = mode === undefined ? { template: promptText } : { template: promptText, mode };
  }

  // 6. validate against the launcher schema
  issues.push(...validateLauncherJson(fields, file));

  const valid = issues.every((i) => i.severity !== "error");
  return {
    role,
    renderInput,
    promptText,
    json: valid ? fields : fields,
    jsonText: JSON.stringify(fields, null, 2) + "\n",
    issues,
    valid,
    renderMs: render.ms,
  };
}

export function parseProfileDoc(source: string, name: string) {
  return parseYaml<ProfileDoc>(source, `profiles/${name}.yaml`);
}
