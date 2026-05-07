import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

const JenkinsJobSchema = z.object({
  path: z.string(),
  my_builds_only: z.boolean().default(true),
});

const JenkinsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  base_url: z.url(),
  username: z.string(),
  api_token_env: z.string().default('JENKINS_TOKEN'),
  jobs: z.array(JenkinsJobSchema).default([]),
});

const BitbucketConfigSchema = z.object({
  enabled: z.boolean().default(true),
  base_url: z.url(),
  pat_env: z.string().default('BITBUCKET_PAT'),
  my_prs_only: z.boolean().default(true),
  ignored_authors: z.array(z.string()).default([]),
});

export const LlmConfigSchema = z.object({
  endpoint: z.url(),
  custom_headers: z.record(z.string(), z.string()).optional(),
  max_log_kb: z.number().int().min(1).max(200).default(30),
  max_diff_kb: z.number().int().min(1).max(500).default(50),
});

export const ConfigSchema = z.object({
  identity: z.object({
    username: z.string(),
    emails: z.array(z.string()).default([]),
  }),
  sources: z.object({
    jenkins: JenkinsConfigSchema.optional(),
    bitbucket: BitbucketConfigSchema.optional(),
  }),
  llm: LlmConfigSchema.optional(),
  settings: z.object({
    poll_interval_seconds: z.number().int().min(30).default(120),
    battery_poll_interval_seconds: z.number().int().min(60).default(600),
    dashboard_refresh_seconds: z.number().int().min(5).default(30),
    notify_on_build_success: z.boolean().default(false),
    notify_on_review_requested: z.boolean().default(true),
    notification_timeout_seconds: z.number().int().min(1).max(60).default(10),
    // Hide Jenkins rows whose latest matching build is older than this
    // many hours. 0 disables the filter. Default: 7 days.
    max_build_age_hours: z.number().int().min(0).default(168),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const p = join(homedir(), '.config', 'flare', 'config.yaml');
  if (!existsSync(p)) {
    throw new Error(`Config not found at ${p}.`);
  }
  const raw = readFileSync(p, 'utf8');
  return ConfigSchema.parse(yaml.load(raw));
}

export function writeSampleConfig(): string {
  const p = join(homedir(), '.config', 'flare', 'config.yaml');
  if (existsSync(p)) {
    throw new Error(`Config already exists at ${p}`);
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, SAMPLE_CONFIG, 'utf8');
  return p;
}

export function readEnvSecret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const SAMPLE_CONFIG = `# flare config
identity:
  username: your.username
  emails:
    - you@firma.de

sources:
  jenkins:
    enabled: true
    base_url: https://jenkins.firma.de
    username: your.username
    api_token_env: JENKINS_TOKEN
    jobs:
      - path: team-x/api-service
        my_builds_only: true
      - path: team-x/web-app
        my_builds_only: true

  bitbucket:
    enabled: true
    base_url: https://bitbucket.firma.de
    pat_env: BITBUCKET_PAT
    my_prs_only: true
    ignored_authors: []

settings:
  poll_interval_seconds: 120
  battery_poll_interval_seconds: 600
  dashboard_refresh_seconds: 30
  notify_on_build_success: false
  notify_on_review_requested: true
  notification_timeout_seconds: 10           # macOS: nur wirksam, wenn 'Banner'-Stil aktiv (System Settings → Notifications)
  max_build_age_hours: 168                   # hide Jenkins rows whose latest "my" build is older than this (0 = no limit)

# Optional: enable on-demand AI analysis ('a' in the dashboard).
# Calls a Gemini generateContent endpoint (Vertex AI, the corporate
# Gemini gateway, or Google's public Generative Language API).
# Auth runs entirely through custom headers, with \${ENV_VAR}
# substitution at request time. Heads up: the build log / PR diff is
# sent to this endpoint — only enable it for endpoints you trust.
# llm:
#   endpoint: https://corp-llm-proxy.firma.de/projects/PROJECT/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent
#   custom_headers:
#     x-api-key: '\${GEMINI_API_KEY}'
#     # x-tenant-id: team-x          # add whatever the gateway requires
#   max_log_kb: 30
#   max_diff_kb: 50
`;
