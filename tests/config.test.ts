import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema, LlmConfigSchema } from '../src/config.js';

test('ConfigSchema accepts a minimal valid config and applies defaults', () => {
  const parsed = ConfigSchema.parse({
    identity: { username: 'alice' },
    sources: {},
    settings: {},
  });

  assert.equal(parsed.identity.username, 'alice');
  assert.deepEqual(parsed.identity.emails, []);
  assert.equal(parsed.settings.poll_interval_seconds, 120);
  assert.equal(parsed.settings.battery_poll_interval_seconds, 600);
  assert.equal(parsed.settings.dashboard_refresh_seconds, 30);
  assert.equal(parsed.settings.notify_on_build_success, false);
  assert.equal(parsed.settings.notify_on_review_requested, true);
});

test('ConfigSchema accepts a full Jenkins + Bitbucket config', () => {
  const parsed = ConfigSchema.parse({
    identity: { username: 'alice', emails: ['alice@firma.de'] },
    sources: {
      jenkins: {
        base_url: 'https://jenkins.firma.de',
        username: 'alice',
        jobs: [{ path: 'team-x/api' }],
      },
      bitbucket: {
        base_url: 'https://bitbucket.firma.de',
      },
    },
    settings: { poll_interval_seconds: 60 },
  });

  assert.equal(parsed.sources.jenkins?.api_token_env, 'JENKINS_TOKEN');
  assert.equal(parsed.sources.jenkins?.jobs[0].my_builds_only, true);
  assert.equal(parsed.sources.bitbucket?.pat_env, 'BITBUCKET_PAT');
  assert.deepEqual(parsed.sources.bitbucket?.ignored_authors, []);
  assert.equal(parsed.settings.poll_interval_seconds, 60);
});

test('ConfigSchema accepts a list of ignored Bitbucket authors', () => {
  const parsed = ConfigSchema.parse({
    identity: { username: 'alice' },
    sources: {
      bitbucket: {
        base_url: 'https://bitbucket.firma.de',
        ignored_authors: ['dependabot', 'release-bot'],
      },
    },
    settings: {},
  });
  assert.deepEqual(parsed.sources.bitbucket?.ignored_authors, ['dependabot', 'release-bot']);
});

test('ConfigSchema rejects a non-URL Jenkins base_url', () => {
  assert.throws(() =>
    ConfigSchema.parse({
      identity: { username: 'alice' },
      sources: { jenkins: { base_url: 'not-a-url', username: 'alice' } },
      settings: {},
    }),
  );
});

test('ConfigSchema rejects poll intervals below the minimum', () => {
  assert.throws(() =>
    ConfigSchema.parse({
      identity: { username: 'alice' },
      sources: {},
      settings: { poll_interval_seconds: 5 },
    }),
  );
});

test('ConfigSchema rejects missing identity.username', () => {
  assert.throws(() =>
    ConfigSchema.parse({
      identity: {},
      sources: {},
      settings: {},
    }),
  );
});

test('LlmConfigSchema applies sensible defaults when only the endpoint is given', () => {
  const parsed = LlmConfigSchema.parse({
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  });
  assert.equal(parsed.api_key_env, 'GEMINI_API_KEY');
  assert.equal(parsed.model, 'gemini-2.5-flash');
  assert.equal(parsed.max_log_kb, 30);
  assert.equal(parsed.max_diff_kb, 50);
});

test('LlmConfigSchema rejects a missing endpoint', () => {
  assert.throws(() => LlmConfigSchema.parse({ api_key_env: 'X' }));
});

test('LlmConfigSchema accepts custom headers and overridden limits', () => {
  const parsed = LlmConfigSchema.parse({
    endpoint: 'https://gateway.firma.de/llm',
    api_key_env: 'CORP_LLM_KEY',
    model: 'claude-sonnet-4-6',
    custom_headers: { 'x-tenant': 'team-x' },
    max_log_kb: 100,
    max_diff_kb: 200,
  });
  assert.equal(parsed.model, 'claude-sonnet-4-6');
  assert.deepEqual(parsed.custom_headers, { 'x-tenant': 'team-x' });
  assert.equal(parsed.max_log_kb, 100);
});

test('ConfigSchema accepts an optional llm block', () => {
  const parsed = ConfigSchema.parse({
    identity: { username: 'alice' },
    sources: {},
    llm: { endpoint: 'https://example.com/v1' },
    settings: {},
  });
  assert.equal(parsed.llm?.endpoint, 'https://example.com/v1');
});
