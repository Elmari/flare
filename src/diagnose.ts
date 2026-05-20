import { basic, request } from './http.js';
import { readEnvSecret } from './config.js';
import type { Config } from './config.js';
import {
  JenkinsJobResponseSchema,
  type JenkinsBuild,
} from './services/jenkins.schema.js';
import {
  BUILD_FIELDS,
  diagnoseMyBuild,
  jobApiUrl,
  type Identity,
} from './services/jenkins.js';

const DEBUG_SCAN_COUNT = 30;
const DEBUG_TREE_QUERY = `builds[${BUILD_FIELDS}]{0,${DEBUG_SCAN_COUNT}},jobs[name,url,builds[${BUILD_FIELDS}]{0,${DEBUG_SCAN_COUNT}}]{0,50}`;

export async function diagnoseJenkinsJob(config: Config, jobPath: string): Promise<string> {
  const cfg = config.sources.jenkins;
  if (!cfg) return 'Jenkins source not configured (sources.jenkins missing).';
  if (!cfg.enabled) return 'Jenkins source disabled (sources.jenkins.enabled = false).';

  const jobConfig = cfg.jobs.find((j) => j.path === jobPath);
  if (!jobConfig) {
    const known = cfg.jobs.map((j) => `  - ${j.path}`).join('\n') || '  (none)';
    return `Job '${jobPath}' is not listed in config.sources.jenkins.jobs.\nConfigured jobs:\n${known}`;
  }

  const apiToken = readEnvSecret(cfg.api_token_env);
  const headers = { ...basic(cfg.username, apiToken), accept: 'application/json' };
  const url = jobApiUrl(cfg.base_url, jobConfig.path);

  let data: unknown;
  try {
    data = await request<unknown>(url, { headers, query: { tree: DEBUG_TREE_QUERY } });
  } catch (err) {
    return `Fetch failed for ${url}\n  ${(err as Error).message}`;
  }

  const parsed = JenkinsJobResponseSchema.parse(data);

  const lines: string[] = [];
  const ageHours = config.settings.max_build_age_hours;
  const cutoff = ageHours > 0 ? Date.now() - ageHours * 3600 * 1000 : null;

  lines.push(`Job:             ${jobConfig.path}`);
  lines.push(`my_builds_only:  ${jobConfig.my_builds_only}`);
  lines.push(
    `Identity:        username=${config.identity.username}, emails=[${config.identity.emails.join(', ')}]`,
  );
  lines.push(
    `Max build age:   ${ageHours}h${cutoff ? ` (cutoff ${new Date(cutoff).toISOString()})` : ' (disabled)'}`,
  );
  lines.push(
    `Watcher scans:   ${config.settings.recent_builds_count} latest builds per branch (settings.recent_builds_count)`,
  );
  lines.push(`Debug scanned:   ${DEBUG_SCAN_COUNT} latest builds per branch (for this diagnose run)`);
  lines.push('');

  if (parsed.builds && parsed.builds.length > 0) {
    lines.push(`Shape: leaf job, ${parsed.builds.length} builds returned`);
    lines.push('');
    formatBuilds(lines, parsed.builds, config.identity, jobConfig.my_builds_only, cutoff);
  } else {
    const branches = parsed.jobs ?? [];
    lines.push(`Shape: multibranch, ${branches.length} branches returned (Jenkins caps at 50)`);
    lines.push('');
    for (const branch of branches) {
      const builds = branch.builds ?? [];
      lines.push(`--- Branch: ${branch.name}  (${builds.length} builds) ---`);
      if (builds.length === 0) {
        lines.push('  (no builds)');
      } else {
        formatBuilds(lines, builds, config.identity, jobConfig.my_builds_only, cutoff);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatBuilds(
  lines: string[],
  builds: JenkinsBuild[],
  identity: Identity,
  myBuildsOnly: boolean,
  cutoff: number | null,
): void {
  // Replicate selection logic: first build that matches (or just the first build
  // if my_builds_only is off).
  const selectedIdx = builds.findIndex((b) =>
    myBuildsOnly ? diagnoseMyBuild(b, identity).match : true,
  );
  const selectedBuild = selectedIdx >= 0 ? builds[selectedIdx] : null;
  const droppedAsStale =
    selectedBuild !== null && cutoff !== null && selectedBuild.timestamp < cutoff;

  builds.forEach((b, i) => {
    const d = diagnoseMyBuild(b, identity);
    const ts = new Date(b.timestamp).toISOString();
    const result = (b.result ?? 'RUNNING').padEnd(8);
    const matchTag = d.match ? '✓ match  ' : '· no-match';

    let suffix = '';
    if (i === selectedIdx) {
      suffix = droppedAsStale
        ? '  ← would pick, but BUILD TOO OLD (filtered by max_build_age_hours)'
        : '  ← SELECTED';
    }

    lines.push(`  #${String(b.number).padEnd(5)} ${result}  ${ts}  ${matchTag}${suffix}`);
    lines.push(`         reason:  ${d.reason}`);
    if (d.causes.length > 0) {
      lines.push(`         causes:  ${d.causes.join(' | ')}`);
    }
    if (d.commitAuthors.length > 0) {
      lines.push(`         authors: ${d.commitAuthors.join(', ')}`);
    }
  });

  if (myBuildsOnly && selectedIdx === -1) {
    lines.push('');
    lines.push(
      `  No build in the scanned window matched your identity. Try lowering my_builds_only, ` +
        `bumping settings.recent_builds_count, or adding more emails/aliases to identity.emails.`,
    );
  }
}
