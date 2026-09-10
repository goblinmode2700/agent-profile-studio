import mergeWith from "lodash-es/mergeWith.js";
import cloneDeep from "lodash-es/cloneDeep.js";

import { CONCAT_FIELDS } from "./schema";

const CONCAT = new Set<string>(CONCAT_FIELDS as readonly string[]);

/**
 * Deep merge with the store's documented rules:
 *  - objects merge key by key, later wins
 *  - lists are replaced, not concatenated
 *  - `extra` is the single exception: it concatenates, preserving order
 */
export function deepMergeProfileParts(
  parts: Array<Record<string, unknown> | undefined | null>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part) continue;
    mergeWith(out, cloneDeep(part), customizer);
  }
  return out;
}

function customizer(objValue: unknown, srcValue: unknown, key: string): unknown {
  if (Array.isArray(srcValue)) {
    if (CONCAT.has(key) && Array.isArray(objValue)) {
      // Ordered concatenation: earlier fragments first, later ones appended.
      return [...objValue, ...srcValue];
    }
    return cloneDeep(srcValue);
  }
  return undefined; // fall back to lodash deep merge
}
