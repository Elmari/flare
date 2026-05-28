import fs from 'node:fs';
import path from 'node:path';
import Conf from 'conf';
import { log } from './log.js';
import type { JenkinsStatus } from './services/jenkins.js';
import type { BitbucketPRStatus } from './services/bitbucket.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface WatcherSnapshot {
  schema_version: typeof SNAPSHOT_SCHEMA_VERSION;
  // Watcher heartbeat — bumped every poll cycle regardless of fetch success.
  // Use this to detect whether the watcher process itself is alive.
  last_poll_at: number;
  jenkins: JenkinsStatus[];
  bitbucket: BitbucketPRStatus[];
  // Per-source liveness: when each source was last successfully fetched.
  // Diverges from last_poll_at when a single source (Jenkins, Bitbucket) is
  // failing while the watcher itself is healthy — readers can flag the
  // stale source without flagging the whole watcher as dead. Optional so
  // older consumers and the very first poll cycle still parse cleanly.
  jenkins_fetched_at?: number;
  bitbucket_fetched_at?: number;
}

let cachedPath: string | undefined;

export function snapshotPath(): string {
  if (cachedPath) return cachedPath;
  // Co-locate with the conf store so external consumers can derive the
  // path the same way without depending on flare internals.
  const store = new Conf({ projectName: 'flare' });
  cachedPath = path.join(path.dirname(store.path), 'snapshot.json');
  return cachedPath;
}

export function writeSnapshotTo(target: string, snapshot: WatcherSnapshot): void {
  const tmp = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), { encoding: 'utf8' });
  // Rename is atomic within a filesystem on both POSIX and Windows, so
  // consumers using fs.watch never see a half-written file.
  fs.renameSync(tmp, target);
}

export function writeSnapshot(snapshot: WatcherSnapshot): void {
  try {
    writeSnapshotTo(snapshotPath(), snapshot);
  } catch (err) {
    log.warn(err, 'snapshot write failed');
  }
}
