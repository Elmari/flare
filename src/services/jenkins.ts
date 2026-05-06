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

export function isMyBuild(build: JenkinsBuild, identity: Identity): boolean {
  const username = identity.username.toLowerCase();
  const emails = new Set(identity.emails.map((e) => e.toLowerCase()));
  const userTokens = new Set<string>([username, ...emails]);

  const causes = build.actions?.flatMap((a) => a.causes ?? []) ?? [];
  for (const c of causes) {
    if (c.userId && userTokens.has(c.userId.toLowerCase())) return true;
    if (c.userName && userTokens.has(c.userName.toLowerCase())) return true;
    if (c.shortDescription) {
      const desc = c.shortDescription.toLowerCase();
      for (const email of emails) {
        if (desc.includes(email)) return true;
      }
    }
  }

  const items = build.changeSet?.items ?? [];
  for (const item of items) {
    const authorEmail = item.authorEmail?.toLowerCase();
    if (authorEmail && emails.has(authorEmail)) return true;
  }

  return false;
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
  'number,url,result,timestamp,actions[causes[userId,userName,shortDescription]],changeSet[items[authorEmail]]';
const TREE_QUERY = `builds[${BUILD_FIELDS}]{0,5},jobs[name,url,builds[${BUILD_FIELDS}]{0,5}]{0,50}`;

export async function fetchLatestJenkinsStatus(config: Config): Promise<JenkinsStatus[]> {
  const cfg = config.sources.jenkins;
  if (!cfg || !cfg.enabled) return [];

  const apiToken = readEnvSecret(cfg.api_token_env);
  const headers = { ...basic(cfg.username, apiToken), accept: 'application/json' };
  const statuses: JenkinsStatus[] = [];

  for (const jobConfig of cfg.jobs) {
    try {
      const jobUrl = jobApiUrl(cfg.base_url, jobConfig.path);
      const data = await request<unknown>(jobUrl, { headers, query: { tree: TREE_QUERY } });
      const parsed = JenkinsJobResponseSchema.parse(data);

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
