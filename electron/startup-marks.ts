/** Startup phases read by `pnpm perf:measure`; only the first occurrence is kept so a long-lived app never grows the timeline. */
export function startupMark(name: string) {
  if (!performance.getEntriesByName(name, 'mark').length) performance.mark(name);
}
