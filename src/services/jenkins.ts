import { basic, request } from '../http.js';
import { readEnvSecret } from '../config.js';
import type { Config } from '../config.js';
import {
  JenkinsJobResponseSchema,
  type JenkinsBuild,
  type JenkinsJobResponse,
} from './jenkins.schema.js';
import { log } from '../log.js';

export type BuildResult = 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | 'RUNNING';

export interface JenkinsStatus {
  job: string;
  number: number;
  result: BuildResult;
  url: string;
  recent: BuildResult[];
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

export function diagnoseMyBuild(build: JenkinsBuild, identity: Identity): MyBuildDiagnosis {
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
  // single changeSet. Merge both into one author list.
  const changeSetItems = [
    ...(build.changeSet?.items ?? []),
    ...(build.changeSets ?? []).flatMap((cs) => cs.items ?? []),
  ];
  const commitAuthors = changeSetItems
    .map((i) => i.authorEmail)
    .filter((e): e is string => Boolean(e));

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

  for (const author of commitAuthors) {
    if (emails.has(author.toLowerCase())) {
      return {
        match: true,
        reason: `commit author=${author}`,
        causes: causeStrings,
        commitAuthors,
      };
    }
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
}

export function selectBuilds(
  response: JenkinsJobResponse,
  identity: Identity,
  myBuildsOnly: boolean,
): BranchBuild[] {
  const pickFrom = (builds: JenkinsBuild[]): JenkinsBuild | undefined =>
    myBuildsOnly ? builds.find((b) => isMyBuild(b, identity)) : builds[0];

  const recentFrom = (builds: JenkinsBuild[]): BuildResult[] =>
    builds.slice(0, 5).map((b) => (b.result ?? 'RUNNING') as BuildResult);

  if (response.builds && response.builds.length > 0) {
    const match = pickFrom(response.builds);
    return match ? [{ branch: '', build: match, recent: recentFrom(response.builds) }] : [];
  }

  const result: BranchBuild[] = [];
  for (const branch of response.jobs ?? []) {
    const builds = branch.builds ?? [];
    const match = pickFrom(builds);
    if (match) result.push({ branch: branch.name, build: match, recent: recentFrom(builds) });
  }
  return result;
}

const BUILD_FIELDS =
  'number,url,result,timestamp,actions[causes[userId,userName,shortDescription]],' +
  'changeSet[items[authorEmail]],changeSets[items[authorEmail]]';
const TREE_QUERY = `builds[${BUILD_FIELDS}]{0,5},jobs[name,url,builds[${BUILD_FIELDS}]{0,5}]{0,50}`;

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
  const statuses: JenkinsStatus[] = [];

  log.debug(
    { baseUrl: cfg.base_url, jobCount: cfg.jobs.length },
    `jenkins: starting fetch for ${cfg.jobs.length} job(s)`,
  );

  for (const jobConfig of cfg.jobs) {
    try {
      const jobUrl = jobApiUrl(cfg.base_url, jobConfig.path);
      const data = await request<unknown>(jobUrl, { headers, query: { tree: TREE_QUERY } });
      const parsed = JenkinsJobResponseSchema.parse(data);

      logSelection(jobConfig.path, jobConfig.my_builds_only, parsed, config.identity);

      const matches = selectBuilds(parsed, config.identity, jobConfig.my_builds_only);
      for (const { branch, build, recent } of matches) {
        statuses.push({
          job: branch ? `${jobConfig.path}/${branch}` : jobConfig.path,
          number: build.number,
          result: (build.result ?? 'RUNNING') as BuildResult,
          url: build.url,
          recent,
        });
      }
    } catch (err) {
      log.warn(err, `jenkins: job fetch failed for ${jobConfig.path}`);
    }
  }

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

function jobApiUrl(baseUrl: string, path: string): string {
  const segments = path.split('/').filter(Boolean).map((s) => `job/${encodeURIComponent(s)}`);
  return `${baseUrl.replace(/\/$/, '')}/${segments.join('/')}/api/json`;
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
