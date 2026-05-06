import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigSchema } from '../src/config.js';

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
  assert.equal(parsed.settings.poll_interval_seconds, 60);
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
