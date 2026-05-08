import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotifyReviewRequested } from '../src/watcher.js';

const reviewer = (approvalStatus: 'APPROVED' | 'NEEDS_WORK' | 'UNAPPROVED') => ({
  iAmAuthor: false,
  approvalStatus,
});

test('review-requested: not yet initialized -> no notification (avoids first-run spam)', () => {
  assert.equal(shouldNotifyReviewRequested(reviewer('UNAPPROVED'), false, true), false);
});

test('review-requested: I am the author -> no notification', () => {
  assert.equal(
    shouldNotifyReviewRequested({ iAmAuthor: true, approvalStatus: 'UNAPPROVED' }, true, true),
    false,
  );
});

test('review-requested: setting disabled -> no notification', () => {
  assert.equal(shouldNotifyReviewRequested(reviewer('UNAPPROVED'), true, false), false);
});

test('review-requested: never-seen PR awaiting my review -> notify', () => {
  assert.equal(shouldNotifyReviewRequested(reviewer('UNAPPROVED'), true, true), true);
});

test('review-requested: never-seen PR I already approved -> no notification', () => {
  // Regression: previously fired on watcher startup if the PR was approved
  // out-of-band (in Bitbucket UI) before the watcher first polled it.
  assert.equal(shouldNotifyReviewRequested(reviewer('APPROVED'), true, true), false);
});

test('review-requested: never-seen PR I already marked NEEDS_WORK -> no notification', () => {
  assert.equal(shouldNotifyReviewRequested(reviewer('NEEDS_WORK'), true, true), false);
});
