import { basic, request } from '../http.js';
import { readEnvSecret } from '../config.js';
import type { Config } from '../config.js';
import {
  JenkinsJobResponseSchema,
  WorkflowRunSchema,
  type JenkinsBuild,
  type JenkinsJobResponse,
  type WorkflowStage,
} from './jenkins.schema.js';
import { fetchLatestBranchAuthorEmail } from './bitbucket.js';
import { log } from '../log.js';

export type BuildResult = 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | 'RUNNING';

export interface JenkinsStatus {
  job: string;
  number: number;
  result: BuildResult;
  url: string;
  recent: BuildResult[];
  timestamp: number;
}

export interface Identity {
  username: string;
  emails: string[];
}

export interface MyBuildDiagnosis {
  match: boolean;
  reason: string;
  causes: string[];
  commitAuthors: string[];
}

export function diagnoseMyBuild(
  build: JenkinsBuild,
  identity: Identity,
  branchAuthorEmail?: string,
): MyBuildDiagnosis {
  const username = identity.username.toLowerCase();
  const emails = new Set(identity.emails.map((e) => e.toLowerCase()));
  const userTokens = new Set<string>([username, ...emails]);

  const causes = build.actions?.flatMap((a) => a.causes ?? []) ?? [];
  const causeStrings = causes.map((c) =>
    c.userId
      ? `userId=${c.userId}`
      : c.userName
        ? `userName=${c.userName}`
        : c.shortDescription
          ? `desc=${c.shortDescription}`
          : '<empty cause>',
  );
  // Pipeline jobs expose changeSets[] (plural); freestyle jobs expose a
  // single changeSet. Merge both into one item list.
  const changeSetItems = [
    ...(build.changeSet?.items ?? []),
    ...(build.changeSets ?? []).flatMap((cs) => cs.items ?? []),
  ];
  const commitAuthors = changeSetItems
    .map((i) => i.authorEmail)
    .filter((e): e is string => Boolean(e));
  // Pick the *most recent* commit by timestamp. If no timestamps are
  // available we fall back to the first item, since Jenkins' git plugin
  // typically lists commits newest-first. Reason: when a renovate branch
  // is freshly indexed, Jenkins can dump *all* commits since the fork
  // point into the changeSet — including unrelated old commits by the
  // user. Anchoring on the latest commit avoids falsely tagging those
  // builds as the user's.
  const latestItem = changeSetItems
    .filter((i) => Boolean(i.authorEmail))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
  const latestAuthor = latestItem?.authorEmail;

  for (const c of causes) {
    if (c.userId && userTokens.has(c.userId.toLowerCase())) {
      return { match: true, reason: `userId=${c.userId}`, causes: causeStrings, commitAuthors };
    }
    if (c.userName && userTokens.has(c.userName.toLowerCase())) {
      return { match: true, reason: `userName=${c.userName}`, causes: causeStrings, commitAuthors };
    }
    if (c.shortDescription) {
      const desc = c.shortDescription.toLowerCase();
      // username substring (e.g. "Aborted by U153618")
      if (username && desc.includes(username)) {
        return {
          match: true,
          reason: `desc contains username '${identity.username}'`,
          causes: causeStrings,
          commitAuthors,
        };
      }
      for (const email of emails) {
        if (desc.includes(email)) {
          return {
            match: true,
            reason: `desc contains email '${email}'`,
            causes: causeStrings,
            commitAuthors,
          };
        }
      }
    }
  }

  if (latestAuthor && emails.has(latestAuthor.toLowerCase())) {
    return {
      match: true,
      reason: `latest commit author=${latestAuthor}`,
      causes: causeStrings,
      commitAuthors,
    };
  }

  if (branchAuthorEmail && emails.has(branchAuthorEmail.toLowerCase())) {
    return {
      match: true,
      reason: `bitbucket branch author=${branchAuthorEmail}`,
      causes: causeStrings,
      commitAuthors,
    };
  }

  return { match: false, reason: 'no identity signal', causes: causeStrings, commitAuthors };
}

export function isMyBuild(build: JenkinsBuild, identity: Identity): boolean {
  return diagnoseMyBuild(build, identity).match;
}

export interface BranchBuild {
  branch: string;
  build: JenkinsBuild;
  recent: BuildResult[];
  // The raw recent builds carry URLs we need later to fetch per-stage status
  // via wfapi for failure reclassification. recent[] stays as the result list
  // so existing consumers and tests are unaffected.
  recentBuilds: JenkinsBuild[];
}

export function selectBuilds(
  response: JenkinsJobResponse,
  identity: Identity,
  myBuildsOnly: boolean,
): BranchBuild[] {
  const pickFrom = (builds: JenkinsBuild[]): JenkinsBuild | undefined =>
    myBuildsOnly ? builds.find((b) => isMyBuild(b, identity)) : builds[0];

  const recentSliceFrom = (builds: JenkinsBuild[]): JenkinsBuild[] => builds.slice(0, 5);
  const recentFrom = (builds: JenkinsBuild[]): BuildResult[] =>
    recentSliceFrom(builds).map((b) => (b.result ?? 'RUNNING') as BuildResult);

  if (response.builds && response.builds.length > 0) {
    const match = pickFrom(response.builds);
    return match
      ? [{
          branch: '',
          build: match,
          recent: recentFrom(response.builds),
          recentBuilds: recentSliceFrom(response.builds),
        }]
      : [];
  }

  const result: BranchBuild[] = [];
  for (const branch of response.jobs ?? []) {
    const builds = branch.builds ?? [];
    const match = pickFrom(builds);
    if (match) {
      result.push({
        branch: branch.name,
        build: match,
        recent: recentFrom(builds),
        recentBuilds: recentSliceFrom(builds),
      });
    }
  }
  return result;
}

// If Jenkins marks a build FAILURE but the only non-green stages are UNSTABLE
// (i.e. nothing actually red), treat it as UNSTABLE. Mirrors how Jenkins'
// build-result aggregation can over-promote a single unstable stage in some
// pipeline setups. Non-FAILURE results, missing stage data, and builds with
// any FAILED stage are passed through unchanged.
export function reclassifyByStages(
  result: BuildResult,
  stages: WorkflowStage[] | null,
): BuildResult {
  if (result !== 'FAILURE') return result;
  if (!stages || stages.length === 0) return result;
  if (stages.some((s) => s.status === 'FAILED')) return result;
  if (stages.some((s) => s.status === 'UNSTABLE')) return 'UNSTABLE';
  return result;
}

export async function fetchBuildStages(
  config: Config,
  buildUrl: string,
): Promise<WorkflowStage[] | null> {
  const cfg = config.sources.jenkins;
  if (!cfg || !cfg.enabled) return null;
  const apiToken = readEnvSecret(cfg.api_token_env);
  const headers = { ...basic(cfg.username, apiToken), accept: 'application/json' };
  const url = `${buildUrl.replace(/\/$/, '')}/wfapi/describe`;
  try {
    const data = await request<unknown>(url, { headers });
    const parsed = WorkflowRunSchema.parse(data);
    return parsed.stages ?? [];
  } catch (err) {
    // wfapi is only exposed for Pipeline jobs (workflow-api-plugin). Freestyle
    // jobs 404 here; that's expected — we just keep the original result.
    log.debug(
      { url, err: (err as Error).message },
      'jenkins: wfapi/describe unavailable — skipping stage-based reclassification',
    );
    return null;
  }
}

export const BUILD_FIELDS =
  'number,url,result,timestamp,actions[causes[userId,userName,shortDescription]],' +
  'changeSet[items[authorEmail,timestamp]],changeSets[items[authorEmail,timestamp]]';

export function buildTreeQuery(recentBuildsCount: number): string {
  return `builds[${BUILD_FIELDS}]{0,${recentBuildsCount}},jobs[name,url,builds[${BUILD_FIELDS}]{0,${recentBuildsCount}}]{0,50}`;
}

export function jobApiUrl(baseUrl: string, path: string): string {
  const segments = path.split('/').filter(Boolean).map((s) => `job/${encodeURIComponent(s)}`);
  return `${baseUrl.replace(/\/$/, '')}/${segments.join('/')}/api/json`;
}

async function enrichWithBitbucketBranchAuthors(
  parsed: JenkinsJobResponse,
  matches: BranchBuild[],
  bitbucketRepo: string,
  config: Config,
): Promise<void> {
  const branches = parsed.jobs ?? [];
  if (branches.length === 0) return;

  const matchedNames = new Set(matches.map((m) => m.branch));
  for (const branch of branches) {
    if (matchedNames.has(branch.name)) continue;
    const builds = branch.builds ?? [];
    if (builds.length === 0) continue;

    const lookup = await fetchLatestBranchAuthorEmail(config, bitbucketRepo, branch.name);
    if (!lookup.email) {
      log.debug(
        { branch: branch.name, reason: lookup.reason },
        `jenkins: bitbucket fallback for '${branch.name}' returned no author`,
      );
      continue;
    }

    const topBuild = builds[0];
    const diagnosis = diagnoseMyBuild(topBuild, config.identity, lookup.email);
    if (!diagnosis.match) continue;

    log.debug(
      { branch: branch.name, author: lookup.email, build: topBuild.number },
      `jenkins: bitbucket fallback matched branch '${branch.name}'`,
    );
    const recentSlice = builds.slice(0, 5);
    matches.push({
      branch: branch.name,
      build: topBuild,
      recent: recentSlice.map((b) => (b.result ?? 'RUNNING') as BuildResult),
      recentBuilds: recentSlice,
    });
  }
}

async function reclassifyIfFailure(
  config: Config,
  buildUrl: string,
  result: BuildResult,
): Promise<BuildResult> {
  if (result !== 'FAILURE') return result;
  const stages = await fetchBuildStages(config, buildUrl);
  return reclassifyByStages(result, stages);
}

async function reclassifyRecent(
  config: Config,
  recentBuilds: JenkinsBuild[],
  recentResults: BuildResult[],
): Promise<BuildResult[]> {
  // Each entry in recent is independent — fan out the wfapi calls in parallel
  // so a job with several FAILURE entries in its trend doesn't serialize 5+
  // network round-trips on every poll.
  return Promise.all(
    recentResults.map((r, i) => {
      const b = recentBuilds[i];
      if (r === 'FAILURE' && b) return reclassifyIfFailure(config, b.url, r);
      return Promise.resolve(r);
    }),
  );
}

export async function fetchLatestJenkinsStatus(config: Config): Promise<JenkinsStatus[]> {
  const cfg = config.sources.jenkins;
  if (!cfg) {
    log.info('jenkins: sources.jenkins not configured — skipping');
    return [];
  }
  if (!cfg.enabled) {
    log.info('jenkins: sources.jenkins.enabled=false — skipping');
    return [];
  }
  if (cfg.jobs.length === 0) {
    log.debug('jenkins: no jobs configured — skipping');
    return [];
  }

  const apiToken = readEnvSecret(cfg.api_token_env);
  const headers = { ...basic(cfg.username, apiToken), accept: 'application/json' };
  const treeQuery = buildTreeQuery(config.settings.recent_builds_count);
  const maxAgeMs = (config.settings.max_build_age_hours ?? 0) * 3600 * 1000;
  const cutoff = maxAgeMs > 0 ? Date.now() - maxAgeMs : null;

  log.debug(
    { baseUrl: cfg.base_url, jobCount: cfg.jobs.length },
    `jenkins: starting fetch for ${cfg.jobs.length} job(s)`,
  );

  // Jobs are independent — fan out the per-job fetches in parallel. A single
  // job's failure stays isolated to its own catch and doesn't block the rest.
  const perJob = await Promise.all(
    cfg.jobs.map(async (jobConfig): Promise<JenkinsStatus[]> => {
      try {
        const jobUrl = jobApiUrl(cfg.base_url, jobConfig.path);
        const data = await request<unknown>(jobUrl, { headers, query: { tree: treeQuery } });
        const parsed = JenkinsJobResponseSchema.parse(data);

        logSelection(jobConfig.path, jobConfig.my_builds_only, parsed, config.identity);

        const matches = selectBuilds(parsed, config.identity, jobConfig.my_builds_only);
        if (jobConfig.my_builds_only && jobConfig.bitbucket_repo) {
          await enrichWithBitbucketBranchAuthors(
            parsed,
            matches,
            jobConfig.bitbucket_repo,
            config,
          );
        }

        const eligible = matches.filter(
          (m) => cutoff === null || m.build.timestamp >= cutoff,
        );

        // For each surviving match, run the wfapi reclassification of the
        // current build and the trend concurrently. Across matches we also
        // fan out, so a multibranch job with many red branches doesn't
        // serialize.
        return await Promise.all(
          eligible.map(async ({ branch, build, recent, recentBuilds }) => {
            const rawResult = (build.result ?? 'RUNNING') as BuildResult;
            const [reclassifiedResult, reclassifiedRecent] = await Promise.all([
              reclassifyIfFailure(config, build.url, rawResult),
              reclassifyRecent(config, recentBuilds, recent),
            ]);
            return {
              job: branch ? `${jobConfig.path}/${branch}` : jobConfig.path,
              number: build.number,
              result: reclassifiedResult,
              url: build.url,
              recent: reclassifiedRecent,
              timestamp: build.timestamp,
            };
          }),
        );
      } catch (err) {
        log.warn(err, `jenkins: job fetch failed for ${jobConfig.path}`);
        return [];
      }
    }),
  );

  const statuses = perJob.flat();
  statuses.sort((a, b) => b.timestamp - a.timestamp);
  return statuses;
}

function logSelection(
  path: string,
  myBuildsOnly: boolean,
  parsed: JenkinsJobResponse,
  identity: Identity,
): void {
  const summarize = (builds: JenkinsBuild[]) =>
    builds.slice(0, 30).map((b) => {
      const d = diagnoseMyBuild(b, identity);
      return {
        n: b.number,
        result: b.result ?? 'RUNNING',
        match: d.match,
        reason: d.reason,
        causes: d.causes,
        commitAuthors: d.commitAuthors,
      };
    });

  if (parsed.builds && parsed.builds.length > 0) {
    log.debug(
      {
        path,
        shape: 'leaf',
        myBuildsOnly,
        identity: { username: identity.username, emails: identity.emails },
        totalBuilds: parsed.builds.length,
        builds: summarize(parsed.builds),
      },
      `jenkins: scanned ${path}`,
    );
    return;
  }

  const branches = parsed.jobs ?? [];
  log.debug(
    {
      path,
      shape: 'multibranch',
      myBuildsOnly,
      identity: { username: identity.username, emails: identity.emails },
      branchCount: branches.length,
      branches: branches.map((b) => ({
        name: b.name,
        totalBuilds: b.builds?.length ?? 0,
        builds: summarize(b.builds ?? []),
      })),
    },
    `jenkins: scanned ${path}`,
  );
}

export interface BuildLog {
  text: string;
  truncated: boolean;
}

export async function fetchBuildLog(config: Config, buildUrl: string, maxBytes: number): Promise<BuildLog> {
  const cfg = config.sources.jenkins;
  if (!cfg || !cfg.enabled) throw new Error('Jenkins source disabled');

  const apiToken = readEnvSecret(cfg.api_token_env);
  const headers = { ...basic(cfg.username, apiToken) };
  const url = `${buildUrl.replace(/\/$/, '')}/consoleText`;

  const text = await request<string>(url, { headers });
  if (text.length <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: text.slice(text.length - maxBytes), truncated: true };
}
