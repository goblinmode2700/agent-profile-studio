import { useEffect, useState } from "react";

/**
 * True only after hydration. Use it for values that legitimately differ between the
 * server render and the browser (render timings), so React never sees a text mismatch.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/** Formats a render duration, but only once hydrated. */
export function useTimingLabel(label: string, ms: number | undefined): string {
  const hydrated = useHydrated();
  return hydrated && ms !== undefined ? `${label} · ${ms.toFixed(1)} ms` : label;
}
