import Conf from 'conf';
import { log } from './log.js';
import { loadConfig, type Config } from './config.js';
import { isOnBattery } from './battery.js';
import { notify, setNotificationTimeout } from './notifier.js';
import {
  fetchLatestJenkinsStatus,
  type BuildResult,
  type JenkinsStatus,
} from './services/jenkins.js';
import { fetchBitbucketPRs, type BitbucketPRStatus } from './services/bitbucket.js';
import {
  shouldNotify,
  markNotified,
  pruneNotified,
  type NotifiedState,
} from './dedup.js';
import { SNAPSHOT_SCHEMA_VERSION, writeSnapshot } from './snapshot.js';

const store = new Conf({ projectName: 'flare' });

interface JenkinsBuildState {
  number: number;
  result: BuildResult;
  // Last non-RUNNING result observed for this job, so a transient RUNNING poll
  // between FAILURE and SUCCESS doesn't swallow the "Build Fixed" notification.
  lastFinalResult?: BuildResult;
}
type JenkinsState = Record<string, JenkinsBuildState>;

export type JenkinsTransition = 'failed' | 'unstable' | 'fixed' | 'passed' | 'none';

export function classifyJenkinsTransition(
  prev: JenkinsBuildState | undefined,
  current: { number: number; result: BuildResult },
): JenkinsTransition {
  if (!prev) return 'none';
  const isNewBuild = current.number !== prev.number;
  const resultChanged = current.result !== prev.result;
  if (!isNewBuild && !resultChanged) return 'none';

  if (current.result === 'FAILURE') return 'failed';
  if (current.result === 'UNSTABLE') return 'unstable';
  if (current.result === 'SUCCESS') {
    const lastFinal = prev.lastFinalResult ?? prev.result;
    return lastFinal === 'FAILURE' || lastFinal === 'UNSTABLE' ? 'fixed' : 'passed';
  }
  return 'none';
}

interface BitbucketPRState {
  updatedDate: number;
  approvalStatus: 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED';
}
type BitbucketState = Record<string, BitbucketPRState>;

export function shouldNotifyReviewRequested(
  pr: { iAmAuthor: boolean; approvalStatus: 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED' },
  initialized: boolean,
  notifyOnReviewRequested: boolean,
): boolean {
  if (!initialized) return false;
  if (pr.iAmAuthor) return false;
  if (!notifyOnReviewRequested) return false;
  // If we've never bookkept this PR but the user has already taken action on it
  // (approved or requested changes), don't fire a stale review-request notification.
  return pr.approvalStatus === 'UNAPPROVED';
}

function readState<T>(key: string): T {
  return ((store.get(key) as T | undefined) ?? ({} as T));
}

export async function startWatcher(): Promise<void> {
  log.info('Flare Watcher started');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const config = loadConfig();
      setNotificationTimeout(config.settings.notification_timeout_seconds);
      const battery = isOnBattery();
      const interval = battery
        ? config.settings.battery_poll_interval_seconds
        : config.settings.poll_interval_seconds;

      log.debug(`Polling cycle started (Battery: ${battery}, Interval: ${interval}s)`);

      await pollAll(config);

      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    } catch (err) {
      log.error(err, 'Watcher error');
      if (err instanceof Error && err.message.includes('Config not found')) {
        notify('Flare Error', 'Configuration file not found. Please run flare config init.');
        await new Promise((resolve) => setTimeout(resolve, 600000));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
  }
}

// Per-source last-known-good cache. Lives at module scope so it survives
// individual poll cycles. Lets pollAll fall back to the last successful list
// when one source fails, instead of throwing the whole cycle and freezing
// last_poll_at — that used to make the watcher look dead to external
// consumers (deck) on any transient Jenkins/Bitbucket hiccup. The fetchedAt
// fields surface per-source liveness in the snapshot so consumers can flag
// a stale source independently of the watcher heartbeat.
const lastGood: {
  jenkins: JenkinsStatus[];
  bitbucket: BitbucketPRStatus[];
  jenkinsFetchedAt?: number;
  bitbucketFetchedAt?: number;
} = {
  jenkins: [],
  bitbucket: [],
};

export interface PollMergeResult {
  jenkins: JenkinsStatus[];
  bitbucket: BitbucketPRStatus[];
  jenkinsFetchedAt?: number;
  bitbucketFetchedAt?: number;
  jenkinsError?: unknown;
  bitbucketError?: unknown;
}

export function mergePollResults(
  jenkinsRes: PromiseSettledResult<JenkinsStatus[]>,
  bitbucketRes: PromiseSettledResult<BitbucketPRStatus[]>,
  fallback: {
    jenkins: JenkinsStatus[];
    bitbucket: BitbucketPRStatus[];
    jenkinsFetchedAt?: number;
    bitbucketFetchedAt?: number;
  },
  now: number,
): PollMergeResult {
  return {
    jenkins: jenkinsRes.status === 'fulfilled' ? jenkinsRes.value : fallback.jenkins,
    bitbucket:
      bitbucketRes.status === 'fulfilled' ? bitbucketRes.value : fallback.bitbucket,
    jenkinsFetchedAt:
      jenkinsRes.status === 'fulfilled' ? now : fallback.jenkinsFetchedAt,
    bitbucketFetchedAt:
      bitbucketRes.status === 'fulfilled' ? now : fallback.bitbucketFetchedAt,
    jenkinsError: jenkinsRes.status === 'rejected' ? jenkinsRes.reason : undefined,
    bitbucketError:
      bitbucketRes.status === 'rejected' ? bitbucketRes.reason : undefined,
  };
}

async function pollAll(config: Config): Promise<void> {
  const now = Date.now();
  const notified = pruneNotified(readState<NotifiedState>('notified'), now);

  const [jenkinsRes, bitbucketRes] = await Promise.allSettled([
    pollJenkins(config, notified, now),
    pollBitbucket(config, notified, now),
  ]);

  const merged = mergePollResults(jenkinsRes, bitbucketRes, lastGood, now);
  if (jenkinsRes.status === 'fulfilled') {
    lastGood.jenkins = jenkinsRes.value;
    lastGood.jenkinsFetchedAt = now;
  }
  if (bitbucketRes.status === 'fulfilled') {
    lastGood.bitbucket = bitbucketRes.value;
    lastGood.bitbucketFetchedAt = now;
  }
  if (merged.jenkinsError)
    log.warn(merged.jenkinsError, 'jenkins poll failed; reusing last known-good list');
  if (merged.bitbucketError)
    log.warn(merged.bitbucketError, 'bitbucket poll failed; reusing last known-good list');

  store.set('notified', notified);
  store.set('last_poll_at', now);

  writeSnapshot({
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    last_poll_at: now,
    jenkins: merged.jenkins,
    bitbucket: merged.bitbucket,
    jenkins_fetched_at: merged.jenkinsFetchedAt,
    bitbucket_fetched_at: merged.bitbucketFetchedAt,
  });
}

async function pollJenkins(
  config: Config,
  notified: NotifiedState,
  now: number,
): Promise<JenkinsStatus[]> {
  const latest = await fetchLatestJenkinsStatus(config);
  const prevState = readState<JenkinsState>('jenkins');
  const nextState: JenkinsState = {};

  for (const s of latest) {
    const prev = prevState[s.job];
    nextState[s.job] = {
      number: s.number,
      result: s.result,
      lastFinalResult: s.result === 'RUNNING' ? prev?.lastFinalResult : s.result,
    };

    // First time we see this job: bookkeep only, don't spam on watcher startup.
    if (!prev) continue;

    const transition = classifyJenkinsTransition(prev, s);
    if (transition === 'failed') {
      const key = `build:${s.job}:${s.number}:FAILURE`;
      if (shouldNotify(key, notified, now)) {
        notify('Build Failed 🚨', `${s.job} #${s.number} failed.`);
        markNotified(key, notified, now);
      }
    } else if (transition === 'unstable') {
      const key = `build:${s.job}:${s.number}:UNSTABLE`;
      if (shouldNotify(key, notified, now)) {
        notify('Build Unstable ⚠️', `${s.job} #${s.number} is unstable.`);
        markNotified(key, notified, now);
      }
    } else if (transition === 'fixed') {
      const key = `build:${s.job}:${s.number}:FIXED`;
      if (shouldNotify(key, notified, now)) {
        notify('Build Fixed ✅', `${s.job} #${s.number} is back to green.`);
        markNotified(key, notified, now);
      }
    } else if (transition === 'passed' && config.settings.notify_on_build_success) {
      const key = `build:${s.job}:${s.number}:SUCCESS`;
      if (shouldNotify(key, notified, now)) {
        notify('Build Passed ✅', `${s.job} #${s.number} succeeded.`);
        markNotified(key, notified, now);
      }
    }
  }

  store.set('jenkins', nextState);
  return latest;
}

async function pollBitbucket(
  config: Config,
  notified: NotifiedState,
  now: number,
): Promise<BitbucketPRStatus[]> {
  const prs = await fetchBitbucketPRs(config);
  const prevState = readState<BitbucketState>('bitbucket');
  const nextState: BitbucketState = {};
  const initialized = store.get('bitbucket_initialized') === true;

  for (const pr of prs) {
    nextState[pr.id] = { updatedDate: pr.updatedDate, approvalStatus: pr.approvalStatus };
    const prev = prevState[pr.id];

    if (!prev) {
      if (shouldNotifyReviewRequested(pr, initialized, config.settings.notify_on_review_requested)) {
        const key = `pr:${pr.id}:REVIEW_REQUESTED`;
        if (shouldNotify(key, notified, now)) {
          notify('Review Requested 👀', `PR #${pr.id} in ${pr.repo}: ${pr.title}`);
          markNotified(key, notified, now);
        }
      }
      continue;
    }
    if (pr.approvalStatus === prev.approvalStatus) continue;

    if (pr.approvalStatus === 'NEEDS_WORK') {
      const key = `pr:${pr.id}:NEEDS_WORK`;
      if (shouldNotify(key, notified, now)) {
        notify('Changes Requested ⚠️', `PR #${pr.id} in ${pr.repo} needs work.`);
        markNotified(key, notified, now);
      }
    } else if (pr.approvalStatus === 'APPROVED') {
      const key = `pr:${pr.id}:APPROVED`;
      // Only notify if I am the author (someone else approved my PR).
      // If I am NOT the author and it's APPROVED, it means I just approved it.
      if (pr.iAmAuthor && shouldNotify(key, notified, now)) {
        notify('PR Approved ✅', `PR #${pr.id} in ${pr.repo} was approved.`);
        markNotified(key, notified, now);
      }
    }
  }

  store.set('bitbucket', nextState);
  store.set('bitbucket_initialized', true);
  return prs;
}
