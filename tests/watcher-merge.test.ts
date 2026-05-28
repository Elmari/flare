import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePollResults } from '../src/watcher.js';
import type { JenkinsStatus } from '../src/services/jenkins.js';
import type { BitbucketPRStatus } from '../src/services/bitbucket.js';

function jenkinsSample(n: number): JenkinsStatus {
  return {
    job: 'team/job/main',
    number: n,
    result: 'SUCCESS',
    url: `http://j/${n}`,
    recent: ['SUCCESS'],
    timestamp: n * 1000,
  };
}

function bitbucketSample(id: number): BitbucketPRStatus {
  return {
    id,
    title: 'fix things',
    repo: 'PRJ/repo',
    state: 'OPEN',
    updatedDate: id * 1000,
    url: `http://b/${id}`,
    author: 'jane',
    iAmAuthor: true,
    approvalStatus: 'UNAPPROVED',
  };
}

const FRESH_J = [jenkinsSample(42)];
const FRESH_B = [bitbucketSample(7)];
const LAST_GOOD_J = [jenkinsSample(1)];
const LAST_GOOD_B = [bitbucketSample(2)];
const NOW = 1_700_000_000_000;
const PREV_J_FETCHED = NOW - 10 * 60_000; // 10 minutes ago
const PREV_B_FETCHED = NOW - 7 * 60_000; //  7 minutes ago

const fallbackWithHistory = {
  jenkins: LAST_GOOD_J,
  bitbucket: LAST_GOOD_B,
  jenkinsFetchedAt: PREV_J_FETCHED,
  bitbucketFetchedAt: PREV_B_FETCHED,
};

test('mergePollResults: both fulfilled → fresh values, both fetchedAt = now, no errors', () => {
  const merged = mergePollResults(
    { status: 'fulfilled', value: FRESH_J },
    { status: 'fulfilled', value: FRESH_B },
    fallbackWithHistory,
    NOW,
  );
  assert.equal(merged.jenkins, FRESH_J);
  assert.equal(merged.bitbucket, FRESH_B);
  assert.equal(merged.jenkinsFetchedAt, NOW);
  assert.equal(merged.bitbucketFetchedAt, NOW);
  assert.equal(merged.jenkinsError, undefined);
  assert.equal(merged.bitbucketError, undefined);
});

test('mergePollResults: jenkins rejected → reuse list AND prior jenkinsFetchedAt; bitbucket bumps to now', () => {
  const err = new Error('jenkins down');
  const merged = mergePollResults(
    { status: 'rejected', reason: err },
    { status: 'fulfilled', value: FRESH_B },
    fallbackWithHistory,
    NOW,
  );
  assert.equal(merged.jenkins, LAST_GOOD_J);
  assert.equal(merged.bitbucket, FRESH_B);
  assert.equal(merged.jenkinsFetchedAt, PREV_J_FETCHED);
  assert.equal(merged.bitbucketFetchedAt, NOW);
  assert.equal(merged.jenkinsError, err);
  assert.equal(merged.bitbucketError, undefined);
});

test('mergePollResults: bitbucket rejected → fresh jenkins, reuse list AND prior bitbucketFetchedAt', () => {
  const err = new Error('bitbucket auth');
  const merged = mergePollResults(
    { status: 'fulfilled', value: FRESH_J },
    { status: 'rejected', reason: err },
    fallbackWithHistory,
    NOW,
  );
  assert.equal(merged.jenkins, FRESH_J);
  assert.equal(merged.bitbucket, LAST_GOOD_B);
  assert.equal(merged.jenkinsFetchedAt, NOW);
  assert.equal(merged.bitbucketFetchedAt, PREV_B_FETCHED);
  assert.equal(merged.jenkinsError, undefined);
  assert.equal(merged.bitbucketError, err);
});

test('mergePollResults: both rejected → both fall back AND keep prior fetchedAt timestamps', () => {
  const jErr = new Error('jenkins');
  const bErr = new Error('bitbucket');
  const merged = mergePollResults(
    { status: 'rejected', reason: jErr },
    { status: 'rejected', reason: bErr },
    fallbackWithHistory,
    NOW,
  );
  assert.equal(merged.jenkins, LAST_GOOD_J);
  assert.equal(merged.bitbucket, LAST_GOOD_B);
  assert.equal(merged.jenkinsFetchedAt, PREV_J_FETCHED);
  assert.equal(merged.bitbucketFetchedAt, PREV_B_FETCHED);
  assert.equal(merged.jenkinsError, jErr);
  assert.equal(merged.bitbucketError, bErr);
});

test('mergePollResults: first-cycle double failure → empty arrays AND undefined fetchedAt', () => {
  const merged = mergePollResults(
    { status: 'rejected', reason: new Error('first poll') },
    { status: 'rejected', reason: new Error('first poll') },
    { jenkins: [], bitbucket: [] },
    NOW,
  );
  assert.deepEqual(merged.jenkins, []);
  assert.deepEqual(merged.bitbucket, []);
  assert.equal(merged.jenkinsFetchedAt, undefined);
  assert.equal(merged.bitbucketFetchedAt, undefined);
});

test('mergePollResults: fetchedAt lifecycle — success then failure freezes that source while the other bumps', () => {
  // First cycle: both succeed.
  let merged = mergePollResults(
    { status: 'fulfilled', value: FRESH_J },
    { status: 'fulfilled', value: FRESH_B },
    { jenkins: [], bitbucket: [] },
    NOW,
  );
  assert.equal(merged.jenkinsFetchedAt, NOW);
  assert.equal(merged.bitbucketFetchedAt, NOW);

  // Second cycle 5 minutes later: jenkins now fails. jenkinsFetchedAt must
  // stick at the first cycle's NOW; bitbucketFetchedAt advances.
  const NOW2 = NOW + 5 * 60_000;
  merged = mergePollResults(
    { status: 'rejected', reason: new Error('blip') },
    { status: 'fulfilled', value: FRESH_B },
    { jenkins: merged.jenkins, bitbucket: merged.bitbucket, jenkinsFetchedAt: merged.jenkinsFetchedAt, bitbucketFetchedAt: merged.bitbucketFetchedAt },
    NOW2,
  );
  assert.equal(merged.jenkinsFetchedAt, NOW, 'jenkinsFetchedAt should freeze across failures');
  assert.equal(merged.bitbucketFetchedAt, NOW2, 'bitbucketFetchedAt should advance on success');
});
