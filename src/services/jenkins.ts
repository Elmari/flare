import { basic, request } from '../http.js';
import { readEnvSecret } from '../config.js';
import type { Config } from '../config.js';
import { JenkinsJobResponseSchema, type JenkinsBuild } from './jenkins.schema.js';
import { log } from '../log.js';

export interface JenkinsStatus {
  job: string;
  number: number;
  result: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | 'RUNNING';
  url: string;
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

export async function fetchLatestJenkinsStatus(config: Config): Promise<JenkinsStatus[]> {
  const cfg = config.sources.jenkins;
  if (!cfg || !cfg.enabled) return [];

  const apiToken = readEnvSecret(cfg.api_token_env);
  const headers = { ...basic(cfg.username, apiToken), accept: 'application/json' };
  const statuses: JenkinsStatus[] = [];

  for (const jobConfig of cfg.jobs) {
    try {
      const jobUrl = jobApiUrl(cfg.base_url, jobConfig.path);
      const data = await request<unknown>(jobUrl, {
        headers,
        query: {
          tree: 'builds[number,url,result,timestamp,actions[causes[userId,userName,shortDescription]],changeSet[items[authorEmail]]]{0,5}',
        },
      });

      const { builds } = JenkinsJobResponseSchema.parse(data);

      const latestBuild: JenkinsBuild | undefined = jobConfig.my_builds_only
        ? builds.find((b) => isMyBuild(b, config.identity))
        : builds[0];

      if (latestBuild) {
        statuses.push({
          job: jobConfig.path,
          number: latestBuild.number,
          result: latestBuild.result || 'RUNNING',
          url: latestBuild.url,
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

// TODO: Future Proactive Agent: fetch consoleText and use LLM for failure analysis
