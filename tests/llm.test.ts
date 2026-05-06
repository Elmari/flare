import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AnalysisResponseSchema,
  PRSummaryResponseSchema,
  buildAnalysisPrompt,
  buildPRPrompt,
  extractJson,
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
