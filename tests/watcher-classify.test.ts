import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyJenkinsTransition } from '../src/watcher.js';

test('classify: no prev state -> none (initial bookkeeping)', () => {
  assert.equal(
    classifyJenkinsTransition(undefined, { number: 5, result: 'SUCCESS' }),
    'none',
  );
});

test('classify: same number and result -> none', () => {
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'SUCCESS', lastFinalResult: 'SUCCESS' },
      { number: 5, result: 'SUCCESS' },
    ),
    'none',
  );
});

test('classify: new build FAILURE -> failed', () => {
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'SUCCESS', lastFinalResult: 'SUCCESS' },
      { number: 6, result: 'FAILURE' },
    ),
    'failed',
  );
});

test('classify: FAILURE -> SUCCESS directly -> fixed', () => {
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'FAILURE', lastFinalResult: 'FAILURE' },
      { number: 6, result: 'SUCCESS' },
    ),
    'fixed',
  );
});

test('classify: FAILURE -> RUNNING -> SUCCESS still detects fixed via lastFinalResult', () => {
  // Simulates the bug scenario: between the red and green poll there was a
  // RUNNING poll. prev.result is now RUNNING, but lastFinalResult preserves
  // FAILURE so the transition is still classified as fixed.
  const prev = { number: 6, result: 'RUNNING' as const, lastFinalResult: 'FAILURE' as const };
  assert.equal(
    classifyJenkinsTransition(prev, { number: 6, result: 'SUCCESS' }),
    'fixed',
  );
});

test('classify: new build UNSTABLE -> unstable', () => {
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'SUCCESS', lastFinalResult: 'SUCCESS' },
      { number: 6, result: 'UNSTABLE' },
    ),
    'unstable',
  );
});

test('classify: FAILURE -> UNSTABLE (new build) -> unstable, not failed', () => {
  // A red build that turns yellow on the next run is still a yellow build,
  // not a fresh failure — we want the yellow notification, not the red one.
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'FAILURE', lastFinalResult: 'FAILURE' },
      { number: 6, result: 'UNSTABLE' },
    ),
    'unstable',
  );
});

test('classify: UNSTABLE -> SUCCESS -> fixed', () => {
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'UNSTABLE', lastFinalResult: 'UNSTABLE' },
      { number: 6, result: 'SUCCESS' },
    ),
    'fixed',
  );
});

test('classify: SUCCESS -> SUCCESS (new build, no prior failure) -> passed', () => {
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'SUCCESS', lastFinalResult: 'SUCCESS' },
      { number: 6, result: 'SUCCESS' },
    ),
    'passed',
  );
});

test('classify: result still RUNNING -> none', () => {
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'SUCCESS', lastFinalResult: 'SUCCESS' },
      { number: 6, result: 'RUNNING' },
    ),
    'none',
  );
});

test('classify: legacy prev without lastFinalResult falls back to prev.result', () => {
  // Persisted state from old versions: lastFinalResult is undefined. In that
  // case the classifier uses prev.result directly, preserving previous behavior.
  assert.equal(
    classifyJenkinsTransition(
      { number: 5, result: 'FAILURE' },
      { number: 6, result: 'SUCCESS' },
    ),
    'fixed',
  );
});
