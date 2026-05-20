import { bearer, request } from '../http.js';
import { readEnvSecret } from '../config.js';
import type { Config } from '../config.js';
import { BitbucketDashboardResponseSchema, type BitbucketPR } from './bitbucket.schema.js';
import { log } from '../log.js';

export interface BitbucketPRStatus {
  id: number;
  title: string;
  repo: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED';
  updatedDate: number;
  url: string;
  author: string;
  iAmAuthor: boolean;
  approvalStatus: 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED';
}

export async function fetchBitbucketPRs(config: Config): Promise<BitbucketPRStatus[]> {
  const cfg = config.sources.bitbucket;
  if (!cfg || !cfg.enabled) return [];

  const pat = readEnvSecret(cfg.pat_env);
  const headers = { ...bearer(pat), accept: 'application/json' };
  const prs: BitbucketPRStatus[] = [];
  const ignored = new Set(cfg.ignored_authors.map((a) => a.toLowerCase()));

  const roles = ['AUTHOR', 'REVIEWER'] as const;

  for (const role of roles) {
    try {
      const data = await request<unknown>(`${cfg.base_url}/rest/api/1.0/dashboard/pull-requests`, {
        headers,
        query: { state: 'OPEN', role, limit: 50 },
      });

      const { values } = BitbucketDashboardResponseSchema.parse(data);

      for (const val of values) {
        if (val.state !== 'OPEN') continue;

        const authorSlug = val.author.user.slug.toLowerCase();
        const authorName = val.author.user.name.toLowerCase();
        if (ignored.has(authorSlug) || ignored.has(authorName)) continue;

        const myStatus = val.reviewers?.find((r) =>
          r.user.slug.toLowerCase() === config.identity.username.toLowerCase() ||
          r.user.name.toLowerCase() === config.identity.username.toLowerCase()
        )?.status;

        prs.push({
          id: val.id,
          title: val.title,
          repo: `${val.toRef.repository.project.key}/${val.toRef.repository.slug}`,
          state: val.state,
          updatedDate: val.updatedDate,
          url: val.links?.self?.[0]?.href || '',
          author: val.author.user.displayName || val.author.user.name,
          iAmAuthor: authorSlug === config.identity.username.toLowerCase(),
          approvalStatus: myStatus || 'UNAPPROVED',
        });
      }
    } catch (err) {
      log.warn(err, `bitbucket: fetch failed for role ${role}`);
    }
  }

  // Deduplicate by ID
  return Array.from(new Map(prs.map(p => [p.id, p])).values());
}

export async function fetchLatestBranchAuthorEmail(
  config: Config,
  repo: string,
  branchName: string,
): Promise<string | undefined> {
  const cfg = config.sources.bitbucket;
  if (!cfg || !cfg.enabled) return undefined;

  const [projectKey, slug] = repo.split('/');
  if (!projectKey || !slug) {
    log.warn({ repo }, 'bitbucket: invalid repo identifier for branch author lookup (expected "PROJECT/slug")');
    return undefined;
  }

  const pat = readEnvSecret(cfg.pat_env);
  const headers = { ...bearer(pat), accept: 'application/json' };
  const url = `${cfg.base_url.replace(/\/$/, '')}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(slug)}/commits`;

  // Pass the full ref. With just the bare branch name, Bitbucket Server
  // tries to resolve it as a commit hash first and 404s for branches that
  // contain slashes (e.g. 'feature/PROJ-1234').
  const ref = branchName.startsWith('refs/') ? branchName : `refs/heads/${branchName}`;

  try {
    const data = await request<{ values?: Array<{ author?: { emailAddress?: string } }> }>(url, {
      headers,
      query: { until: ref, limit: 1 },
    });
    return data.values?.[0]?.author?.emailAddress;
  } catch (err) {
    log.warn(
      { repo, branchName, ref, err: (err as Error).message },
      'bitbucket: latest branch author lookup failed',
    );
    return undefined;
  }
}

export interface PRDiff {
  text: string;
  truncated: boolean;
}

export async function fetchPRDiff(config: Config, repo: string, prId: number, maxBytes: number): Promise<PRDiff> {
  const cfg = config.sources.bitbucket;
  if (!cfg || !cfg.enabled) throw new Error('Bitbucket source disabled');

  const [projectKey, slug] = repo.split('/');
  if (!projectKey || !slug) throw new Error(`invalid repo identifier: ${repo}`);

  const pat = readEnvSecret(cfg.pat_env);
  const headers = { ...bearer(pat), accept: 'text/plain' };
  const url = `${cfg.base_url.replace(/\/$/, '')}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(slug)}/pull-requests/${prId}/diff`;

  const text = await request<string>(url, { headers });
  if (text.length <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxBytes), truncated: true };
}
