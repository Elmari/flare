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
  // Source branch (fromRef.displayId). Optional because older Bitbucket
  // servers and some edge-case PRs may not expose it.
  branch?: string;
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
          branch: val.fromRef?.displayId,
        });
      }
    } catch (err) {
      log.warn(err, `bitbucket: fetch failed for role ${role}`);
    }
  }

  // Deduplicate by ID
  return Array.from(new Map(prs.map(p => [p.id, p])).values());
}

export interface BranchAuthorLookup {
  email?: string;
  reason: string;
}

export async function fetchLatestBranchAuthorEmail(
  config: Config,
  repo: string,
  branchName: string,
): Promise<BranchAuthorLookup> {
  const cfg = config.sources.bitbucket;
  if (!cfg) return { reason: 'sources.bitbucket not configured' };
  if (!cfg.enabled) return { reason: 'sources.bitbucket.enabled=false' };

  const [projectKey, slug] = repo.split('/');
  if (!projectKey || !slug) {
    return { reason: `invalid bitbucket_repo '${repo}' (expected "PROJECT/slug")` };
  }

  const pat = readEnvSecret(cfg.pat_env);
  const headers = { ...bearer(pat), accept: 'application/json' };
  const repoBase = `${cfg.base_url.replace(/\/$/, '')}/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(slug)}`;

  // Jenkins sometimes reports branch.name URL-encoded (feature%2Ffoo); the
  // Bitbucket filterText is plain text, so decode first. Also strip a
  // refs/heads/ prefix if a caller passed the full ref form.
  let displayName: string;
  try {
    displayName = decodeURIComponent(branchName);
  } catch {
    displayName = branchName;
  }
  if (displayName.startsWith('refs/heads/')) {
    displayName = displayName.slice('refs/heads/'.length);
  }

  let branchData: { values?: Array<{ displayId?: string; id?: string; latestCommit?: string }> };
  try {
    branchData = await request(`${repoBase}/branches`, {
      headers,
      query: { filterText: displayName, limit: 25 },
    });
  } catch (err) {
    return { reason: `/branches request failed: ${(err as Error).message}` };
  }

  const matches = branchData.values ?? [];
  if (matches.length === 0) {
    return { reason: `/branches?filterText=${displayName} returned 0 results` };
  }
  const exact = matches.find(
    (b) =>
      b.displayId?.toLowerCase() === displayName.toLowerCase() ||
      b.id === `refs/heads/${displayName}`,
  );
  if (!exact) {
    const sample = matches
      .map((b) => b.displayId ?? b.id ?? '?')
      .slice(0, 5)
      .join(', ');
    return {
      reason: `/branches matched ${matches.length} branch(es) but none had displayId='${displayName}' (saw: ${sample})`,
    };
  }
  if (!exact.latestCommit) {
    return { reason: `branch '${displayName}' found but Bitbucket returned no latestCommit hash` };
  }

  let commit: { author?: { emailAddress?: string } };
  try {
    commit = await request(
      `${repoBase}/commits/${encodeURIComponent(exact.latestCommit)}`,
      { headers },
    );
  } catch (err) {
    return { reason: `/commits/${exact.latestCommit} failed: ${(err as Error).message}` };
  }
  const email = commit.author?.emailAddress;
  if (!email) {
    return { reason: `commit ${exact.latestCommit} has no author.emailAddress` };
  }
  return { email, reason: `latestCommit=${exact.latestCommit.slice(0, 8)} author=${email}` };
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
