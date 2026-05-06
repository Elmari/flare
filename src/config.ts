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
  base_url: z.string().url(),
  username: z.string(),
  api_token_env: z.string().default('JENKINS_TOKEN'),
  jobs: z.array(JenkinsJobSchema).default([]),
});

const BitbucketConfigSchema = z.object({
  enabled: z.boolean().default(true),
  base_url: z.string().url(),
  pat_env: z.string().default('BITBUCKET_PAT'),
  my_prs_only: z.boolean().default(true),
  ignored_authors: z.array(z.string()).default([]),
});

// TODO: Future Proactive Agent: add LLM configuration for failure analysis
export const ConfigSchema = z.object({
  identity: z.object({
    username: z.string(),
    emails: z.array(z.string()).default([]),
  }),
  sources: z.object({
    jenkins: JenkinsConfigSchema.optional(),
    bitbucket: BitbucketConfigSchema.optional(),
  }),
  settings: z.object({
    poll_interval_seconds: z.number().int().min(30).default(120),
    battery_poll_interval_seconds: z.number().int().min(60).default(600),
    dashboard_refresh_seconds: z.number().int().min(5).default(30),
    notify_on_build_success: z.boolean().default(false),
    notify_on_review_requested: z.boolean().default(true),
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
`;
