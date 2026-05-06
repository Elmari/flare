import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldNotify,
  markNotified,
  pruneNotified,
  type NotifiedState,
} from '../src/dedup.js';

const HOUR = 60 * 60 * 1000;

test('shouldNotify returns true when key has never been seen', () => {
  const notified: NotifiedState = {};
  assert.equal(shouldNotify('pr:1:NEEDS_WORK', notified, 1_000_000), true);
});

test('shouldNotify returns false within cooldown window', () => {
  const now = 10_000_000;
  const notified: NotifiedState = { 'pr:1:NEEDS_WORK': now - HOUR };
  assert.equal(shouldNotify('pr:1:NEEDS_WORK', notified, now, 4 * HOUR), false);
});

test('shouldNotify returns true once cooldown has elapsed', () => {
  const now = 10_000_000;
  const notified: NotifiedState = { 'pr:1:NEEDS_WORK': now - 5 * HOUR };
  assert.equal(shouldNotify('pr:1:NEEDS_WORK', notified, now, 4 * HOUR), true);
});

test('markNotified records the timestamp under the given key', () => {
  const notified: NotifiedState = {};
  markNotified('build:job-x:5:FAILURE', notified, 12345);
  assert.equal(notified['build:job-x:5:FAILURE'], 12345);
});

test('flap suppression: NEEDS_WORK -> UNAPPROVED -> NEEDS_WORK does not re-notify within cooldown', () => {
  const notified: NotifiedState = {};
  const cooldown = 4 * HOUR;

  const t0 = 1_000_000;
  assert.equal(shouldNotify('pr:42:NEEDS_WORK', notified, t0, cooldown), true);
  markNotified('pr:42:NEEDS_WORK', notified, t0);

  // 1 hour later, status flips back. Same key -> blocked.
  const t1 = t0 + HOUR;
  assert.equal(shouldNotify('pr:42:NEEDS_WORK', notified, t1, cooldown), false);

  // 5 hours after the original notify, cooldown passed -> allowed again.
  const t2 = t0 + 5 * HOUR;
  assert.equal(shouldNotify('pr:42:NEEDS_WORK', notified, t2, cooldown), true);
});

test('pruneNotified drops entries older than retention window', () => {
  const now = 10_000_000;
  const retention = 7 * 24 * HOUR;
  const notified: NotifiedState = {
    fresh: now - HOUR,
    stale: now - retention - HOUR,
    edge: now - retention,
  };

  const pruned = pruneNotified(notified, now, retention);
  assert.equal(pruned.fresh, now - HOUR);
  assert.equal(pruned.edge, now - retention);
  assert.equal(pruned.stale, undefined);
});

test('pruneNotified returns a new object and does not mutate the input', () => {
  const original: NotifiedState = { keep: 1000, drop: 1 };
  const before = { ...original };
  pruneNotified(original, 10_000, 5_000);
  assert.deepEqual(original, before);
});
