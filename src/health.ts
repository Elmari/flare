export type WatcherHealth =
  | { state: 'unknown' }
  | { state: 'fresh'; ageMs: number }
  | { state: 'stale'; ageMs: number };

export function classifyHealth(
  lastPollAt: number | undefined,
  now: number,
  staleAfterMs: number,
): WatcherHealth {
  if (!lastPollAt) return { state: 'unknown' };
  const ageMs = Math.max(0, now - lastPollAt);
  return ageMs > staleAfterMs ? { state: 'stale', ageMs } : { state: 'fresh', ageMs };
}

export function relativeAge(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
