import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisResponseSchema,
  PRSummaryResponseSchema,
  buildAnalysisPrompt,
  buildPRPrompt,
  extractJson,
  resolveCustomHeaders,
} from '../src/llm.js';

test('extractJson parses raw JSON content', () => {
  const result = extractJson('{"summary":"build failed"}');
  assert.deepEqual(result, { summary: 'build failed' });
});

test('extractJson recovers JSON from a fenced markdown block', () => {
  const wrapped = '```json\n{"summary":"build failed"}\n```';
  assert.deepEqual(extractJson(wrapped), { summary: 'build failed' });
});

test('extractJson recovers JSON from a fenced block without language tag', () => {
  const wrapped = 'Here you go:\n```\n{"summary":"x"}\n```\nThanks';
  assert.deepEqual(extractJson(wrapped), { summary: 'x' });
});

test('extractJson throws when content has no JSON', () => {
  assert.throws(() => extractJson('not json at all'));
});

test('AnalysisResponseSchema accepts a minimal response', () => {
  const parsed = AnalysisResponseSchema.parse({ summary: 'tests failed' });
  assert.equal(parsed.summary, 'tests failed');
  assert.equal(parsed.likely_cause, undefined);
  assert.equal(parsed.fix_hint, undefined);
});

test('AnalysisResponseSchema accepts the full response shape', () => {
  const parsed = AnalysisResponseSchema.parse({
    summary: 'tests failed',
    likely_cause: 'mock not initialised',
    fix_hint: 'add @Mock annotation',
  });
  assert.equal(parsed.likely_cause, 'mock not initialised');
  assert.equal(parsed.fix_hint, 'add @Mock annotation');
});

test('AnalysisResponseSchema rejects missing summary', () => {
  assert.throws(() => AnalysisResponseSchema.parse({ likely_cause: 'x' }));
});

test('PRSummaryResponseSchema accepts minimal response', () => {
  const parsed = PRSummaryResponseSchema.parse({ summary: 'refactor http layer' });
  assert.equal(parsed.summary, 'refactor http layer');
  assert.equal(parsed.key_files, undefined);
});

test('PRSummaryResponseSchema accepts full response with key_files', () => {
  const parsed = PRSummaryResponseSchema.parse({
    summary: 'refactor http layer',
    key_files: ['src/http.ts', 'src/services/jenkins.ts'],
    review_focus: 'check timeout behaviour',
  });
  assert.equal(parsed.key_files?.length, 2);
  assert.equal(parsed.review_focus, 'check timeout behaviour');
});

test('buildAnalysisPrompt embeds job, build number, and log', () => {
  const out = buildAnalysisPrompt('team/api', 42, 'NPE at line 47', false);
  assert.match(out, /Job: team\/api/);
  assert.match(out, /Build: #42/);
  assert.match(out, /NPE at line 47/);
  assert.doesNotMatch(out, /truncated/);
});

test('buildAnalysisPrompt mentions truncation when the log was clipped', () => {
  const out = buildAnalysisPrompt('team/api', 42, 'tail of log', true);
  assert.match(out, /truncated/);
});

test('buildPRPrompt embeds repo, PR id, title, and diff', () => {
  const out = buildPRPrompt('TEAM/api', 128, 'Fix retry logic', '+++ a/foo.ts', false);
  assert.match(out, /Repository: TEAM\/api/);
  assert.match(out, /Pull Request: #128/);
  assert.match(out, /Fix retry logic/);
  assert.match(out, /\+\+\+ a\/foo\.ts/);
});

test('resolveCustomHeaders returns an empty object when no headers are configured', () => {
  assert.deepEqual(resolveCustomHeaders(undefined), {});
  assert.deepEqual(resolveCustomHeaders({}), {});
});

test('resolveCustomHeaders substitutes ${ENV_VAR} placeholders', () => {
  process.env.FLARE_TEST_TOKEN = 'abc123';
  try {
    const out = resolveCustomHeaders({ 'x-api-key': '${FLARE_TEST_TOKEN}' });
    assert.deepEqual(out, { 'x-api-key': 'abc123' });
  } finally {
    delete process.env.FLARE_TEST_TOKEN;
  }
});

test('resolveCustomHeaders passes through static values unchanged', () => {
  const out = resolveCustomHeaders({ 'x-tenant-id': 'team-x', accept: 'application/json' });
  assert.deepEqual(out, { 'x-tenant-id': 'team-x', accept: 'application/json' });
});

test('resolveCustomHeaders throws with the header name when an env var is missing', () => {
  delete process.env.FLARE_TEST_MISSING;
  assert.throws(
    () => resolveCustomHeaders({ 'x-api-key': '${FLARE_TEST_MISSING}' }),
    /llm\.custom_headers\.x-api-key.*FLARE_TEST_MISSING/,
  );
});

test('resolveCustomHeaders supports multiple substitutions in one value', () => {
  process.env.FLARE_TEST_A = 'foo';
  process.env.FLARE_TEST_B = 'bar';
  try {
    const out = resolveCustomHeaders({ 'x-combo': '${FLARE_TEST_A}-${FLARE_TEST_B}' });
    assert.deepEqual(out, { 'x-combo': 'foo-bar' });
  } finally {
    delete process.env.FLARE_TEST_A;
    delete process.env.FLARE_TEST_B;
  }
});
