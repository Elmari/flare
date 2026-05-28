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
const fallback = { jenkins: LAST_GOOD_J, bitbucket: LAST_GOOD_B };

test('mergePollResults: both fulfilled → fresh values, no errors', () => {
  const merged = mergePollResults(
    { status: 'fulfilled', value: FRESH_J },
    { status: 'fulfilled', value: FRESH_B },
    fallback,
  );
  assert.equal(merged.jenkins, FRESH_J);
  assert.equal(merged.bitbucket, FRESH_B);
  assert.equal(merged.jenkinsError, undefined);
  assert.equal(merged.bitbucketError, undefined);
});

test('mergePollResults: jenkins rejected → reuse last good jenkins, fresh bitbucket', () => {
  const err = new Error('jenkins down');
  const merged = mergePollResults(
    { status: 'rejected', reason: err },
    { status: 'fulfilled', value: FRESH_B },
    fallback,
  );
  assert.equal(merged.jenkins, LAST_GOOD_J);
  assert.equal(merged.bitbucket, FRESH_B);
  assert.equal(merged.jenkinsError, err);
  assert.equal(merged.bitbucketError, undefined);
});

test('mergePollResults: bitbucket rejected → fresh jenkins, reuse last good bitbucket', () => {
  const err = new Error('bitbucket auth');
  const merged = mergePollResults(
    { status: 'fulfilled', value: FRESH_J },
    { status: 'rejected', reason: err },
    fallback,
  );
  assert.equal(merged.jenkins, FRESH_J);
  assert.equal(merged.bitbucket, LAST_GOOD_B);
  assert.equal(merged.jenkinsError, undefined);
  assert.equal(merged.bitbucketError, err);
});

test('mergePollResults: both rejected → both fall back, both errors surfaced', () => {
  const jErr = new Error('jenkins');
  const bErr = new Error('bitbucket');
  const merged = mergePollResults(
    { status: 'rejected', reason: jErr },
    { status: 'rejected', reason: bErr },
    fallback,
  );
  assert.equal(merged.jenkins, LAST_GOOD_J);
  assert.equal(merged.bitbucket, LAST_GOOD_B);
  assert.equal(merged.jenkinsError, jErr);
  assert.equal(merged.bitbucketError, bErr);
});

test('mergePollResults: first-cycle double failure → empty arrays (no prior cache)', () => {
  const merged = mergePollResults(
    { status: 'rejected', reason: new Error('first poll') },
    { status: 'rejected', reason: new Error('first poll') },
    { jenkins: [], bitbucket: [] },
  );
  assert.deepEqual(merged.jenkins, []);
  assert.deepEqual(merged.bitbucket, []);
});
