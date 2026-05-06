import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHealth, relativeAge } from '../src/health.js';

const MIN = 60_000;

test('classifyHealth: undefined heartbeat is unknown', () => {
  assert.deepEqual(classifyHealth(undefined, 1_000_000, 5 * MIN), { state: 'unknown' });
});

test('classifyHealth: recent heartbeat is fresh', () => {
  const now = 10_000_000;
  const result = classifyHealth(now - 30_000, now, 5 * MIN);
  assert.equal(result.state, 'fresh');
  assert.equal((result as { ageMs: number }).ageMs, 30_000);
});

test('classifyHealth: heartbeat older than threshold is stale', () => {
  const now = 10_000_000;
  const result = classifyHealth(now - 10 * MIN, now, 5 * MIN);
  assert.equal(result.state, 'stale');
  assert.equal((result as { ageMs: number }).ageMs, 10 * MIN);
});

test('classifyHealth: clock skew (heartbeat in the future) clamps age to 0', () => {
  const now = 10_000_000;
  const result = classifyHealth(now + 5_000, now, 5 * MIN);
  assert.equal(result.state, 'fresh');
  assert.equal((result as { ageMs: number }).ageMs, 0);
});

test('relativeAge: under one minute renders as seconds (min 1s)', () => {
  assert.equal(relativeAge(0), '1s ago');
  assert.equal(relativeAge(15_000), '15s ago');
  assert.equal(relativeAge(59_000), '59s ago');
});

test('relativeAge: under one hour renders as minutes', () => {
  assert.equal(relativeAge(60_000), '1 min ago');
  assert.equal(relativeAge(47 * MIN), '47 min ago');
});

test('relativeAge: under one day renders as hours', () => {
  assert.equal(relativeAge(60 * MIN), '1h ago');
  assert.equal(relativeAge(5 * 60 * MIN), '5h ago');
});

test('relativeAge: a day or more renders as days', () => {
  assert.equal(relativeAge(24 * 60 * MIN), '1d ago');
  assert.equal(relativeAge(3 * 24 * 60 * MIN), '3d ago');
});
