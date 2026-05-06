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
