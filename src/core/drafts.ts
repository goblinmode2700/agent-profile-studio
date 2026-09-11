/** Selection has no draft; only an actual byte change is dirty. */
export function isDraftDirty(saved: string, draft: string | undefined): boolean {
  return draft !== undefined && draft !== saved;
}
