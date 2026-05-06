export const NOTIFICATION_COOLDOWN_MS = 4 * 60 * 60 * 1000;
export const NOTIFIED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type NotifiedState = Record<string, number>;

export function shouldNotify(
  key: string,
  notified: NotifiedState,
  now: number,
  cooldownMs: number = NOTIFICATION_COOLDOWN_MS,
): boolean {
  const last = notified[key];
  return last === undefined || now - last >= cooldownMs;
}

export function markNotified(
  key: string,
  notified: NotifiedState,
  now: number,
): void {
  notified[key] = now;
}

export function pruneNotified(
  notified: NotifiedState,
  now: number,
  retentionMs: number = NOTIFIED_RETENTION_MS,
): NotifiedState {
  const cutoff = now - retentionMs;
  const result: NotifiedState = {};
  for (const [k, v] of Object.entries(notified)) {
    if (v >= cutoff) result[k] = v;
  }
  return result;
}
