import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

import { AGENT_PROFILE_SCHEMA, PROFILE_FIELDS } from "./schema";
import type { StudioIssue } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false });

let compiled: ValidateFunction | null = null;
function validator(): ValidateFunction {
  if (!compiled) compiled = ajv.compile(AGENT_PROFILE_SCHEMA as unknown as object);
  return compiled;
}

/** Full launcher-output validation (draft 2020-12). */
export function validateLauncherJson(value: unknown, file?: string): StudioIssue[] {
  const validate = validator();
  const ok = validate(value);
  if (ok) return [];
  return (validate.errors ?? []).map((err) => ({
    severity: "error" as const,
    file,
    field: err.instancePath.replace(/^\//, "").replace(/\//g, ".") || undefined,
    message: `${file ? `${file}: ` : ""}${err.instancePath || "(root)"} ${err.message ?? "is invalid"}${
      err.params && "allowedValues" in err.params
        ? ` (allowed: ${(err.params as { allowedValues: unknown[] }).allowedValues.join(", ")})`
        : ""
    }${
      err.params && "additionalProperty" in err.params
        ? `: "${(err.params as { additionalProperty: string }).additionalProperty}"`
        : ""
    }`,
  }));
}

/**
 * A config fragment (or an `overrides` block) holds only profile fields.
 * An unknown field is an error, named by file and field.
 */
export function validateProfileFieldSubset(
  value: unknown,
  file: string,
  label = "fragment",
): StudioIssue[] {
  if (value == null) return [];
  if (typeof value !== "object" || Array.isArray(value)) {
    return [
      {
        severity: "error",
        file,
        message: `${file}: ${label} must be a mapping of profile fields.`,
      },
    ];
  }
  const issues: StudioIssue[] = [];
  const record = value as Record<string, unknown>;
  if (label === "fragment" && record["promptText"] !== undefined && typeof record["promptText"] !== "string") {
    issues.push({ severity: "error", file, field: "promptText", message: `${file}: promptText must be a string.` });
  }
  for (const key of Object.keys(record)) {
    if (label === "fragment" && key === "promptText") continue;
    if (!PROFILE_FIELDS.includes(key)) {
      issues.push({
        severity: "error",
        file,
        field: key,
        message: `${file}: unknown profile field "${key}" in ${label}. Allowed fields: ${PROFILE_FIELDS.join(", ")}.`,
      });
    }
  }
  // Type-check the known keys against the launcher schema, without requiring completeness.
  const subset: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (PROFILE_FIELDS.includes(key)) subset[key] = record[key];
  }
  const promptValue = subset["prompt"];
  if (promptValue && typeof promptValue === "object") {
    // A fragment may legitimately carry only prompt.mode; the studio fills in template later.
    const p = promptValue as Record<string, unknown>;
    if (p["template"] === undefined) subset["prompt"] = { ...p, template: "" };
  }
  // Root-level unknown keys are already reported above by name; nested unknown keys
  // (prompt.*, session.*, …) must still be named and rejected here.
  issues.push(
    ...validateLauncherJson(subset, file).filter(
      (i) => !(i.message.includes("must NOT have additional") && !i.field),
    ),
  );
  return issues;
}


/** Only schema-defined keys reach the launcher JSON. Template variables never leak. */
export function projectLauncherFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_FIELDS) {
    if (key in input) out[key] = input[key];
  }
  return out;
}
