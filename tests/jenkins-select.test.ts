import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBuilds, type Identity } from '../src/services/jenkins.js';
import type { JenkinsBuild, JenkinsJobResponse } from '../src/services/jenkins.schema.js';

const me: Identity = { username: 'alice', emails: ['alice@firma.de'] };

function build(num: number, opts: Partial<JenkinsBuild> = {}): JenkinsBuild {
  return {
    number: num,
    url: `https://jenkins.example.com/build/${num}/`,
    result: 'SUCCESS',
    timestamp: 0,
    ...opts,
  };
}

const myBuild = (num: number) => build(num, {
  changeSet: { items: [{ authorEmail: 'alice@firma.de' }] },
});
const otherBuild = (num: number) => build(num, {
  changeSet: { items: [{ authorEmail: 'bob@firma.de' }] },
});

test('selectBuilds: leaf job with my build returns one entry without branch', () => {
  const response: JenkinsJobResponse = { builds: [myBuild(5), otherBuild(4)] };
  const result = selectBuilds(response, me, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].branch, '');
  assert.equal(result[0].build.number, 5);
  assert.deepEqual(result[0].recent, ['SUCCESS', 'SUCCESS']);
});

test('selectBuilds: leaf job with my_builds_only and only foreign builds returns empty', () => {
  const response: JenkinsJobResponse = { builds: [otherBuild(5), otherBuild(4)] };
  assert.deepEqual(selectBuilds(response, me, true), []);
});

test('selectBuilds: leaf job with my_builds_only=false returns the latest build', () => {
  const response: JenkinsJobResponse = { builds: [otherBuild(5), otherBuild(4)] };
  const result = selectBuilds(response, me, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].build.number, 5);
});

test('selectBuilds: multibranch returns one entry per branch where I have builds', () => {
  const response: JenkinsJobResponse = {
    jobs: [
      {
        name: 'main',
        url: 'https://jenkins.example.com/job/x/job/main/',
        builds: [myBuild(10), otherBuild(9)],
      },
      {
        name: 'feature-x',
        url: 'https://jenkins.example.com/job/x/job/feature-x/',
        builds: [otherBuild(3)],
      },
      {
        name: 'feature-y',
        url: 'https://jenkins.example.com/job/x/job/feature-y/',
        builds: [myBuild(7)],
      },
    ],
  };

  const result = selectBuilds(response, me, true);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((r) => ({ branch: r.branch, num: r.build.number })),
    [
      { branch: 'main', num: 10 },
      { branch: 'feature-y', num: 7 },
    ],
  );
});

test('selectBuilds: multibranch with my_builds_only=false returns the latest from each branch', () => {
  const response: JenkinsJobResponse = {
    jobs: [
      {
        name: 'main',
        url: 'https://jenkins.example.com/job/x/job/main/',
        builds: [otherBuild(10)],
      },
      {
        name: 'develop',
        url: 'https://jenkins.example.com/job/x/job/develop/',
        builds: [otherBuild(4)],
      },
    ],
  };
  const result = selectBuilds(response, me, false);
  assert.equal(result.length, 2);
  assert.equal(result[0].branch, 'main');
  assert.equal(result[1].branch, 'develop');
});

test('selectBuilds: multibranch branch with no builds is skipped', () => {
  const response: JenkinsJobResponse = {
    jobs: [
      {
        name: 'main',
        url: 'https://jenkins.example.com/job/x/job/main/',
        builds: [myBuild(1)],
      },
      {
        name: 'empty-branch',
        url: 'https://jenkins.example.com/job/x/job/empty-branch/',
      },
    ],
  };
  const result = selectBuilds(response, me, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].branch, 'main');
});

test('selectBuilds: response with neither builds nor jobs returns empty', () => {
  assert.deepEqual(selectBuilds({}, me, true), []);
});

test('selectBuilds: recent contains the last 5 build results in API order (newest first)', () => {
  const response: JenkinsJobResponse = {
    builds: [
      build(10, { result: 'FAILURE' }),
      build(9, { result: 'SUCCESS' }),
      build(8, { result: 'FAILURE' }),
      build(7, { result: 'SUCCESS' }),
      build(6, { result: 'SUCCESS' }),
      build(5, { result: 'SUCCESS' }), // outside the slice
    ],
  };
  const result = selectBuilds(response, me, false);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].recent, ['FAILURE', 'SUCCESS', 'FAILURE', 'SUCCESS', 'SUCCESS']);
});

test('selectBuilds: maps null result to RUNNING in the recent trend', () => {
  const response: JenkinsJobResponse = {
    builds: [build(10, { result: null }), build(9, { result: 'SUCCESS' })],
  };
  const result = selectBuilds(response, me, false);
  assert.deepEqual(result[0].recent, ['RUNNING', 'SUCCESS']);
});

test('selectBuilds: each multibranch entry carries its own branch trend', () => {
  const response: JenkinsJobResponse = {
    jobs: [
      {
        name: 'main',
        url: 'https://jenkins.example.com/job/x/job/main/',
        builds: [myBuild(5), build(4, { result: 'FAILURE' })],
      },
      {
        name: 'feature-y',
        url: 'https://jenkins.example.com/job/x/job/feature-y/',
        builds: [myBuild(2), myBuild(1)],
      },
    ],
  };
  const result = selectBuilds(response, me, true);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].recent, ['SUCCESS', 'FAILURE']);
  assert.deepEqual(result[1].recent, ['SUCCESS', 'SUCCESS']);
});

test('selectBuilds: leaf takes precedence when both builds and jobs are present', () => {
  // Defensive: if Jenkins ever returns both fields populated (shouldn't, but),
  // treat as leaf since builds is the canonical leaf signal.
  const response: JenkinsJobResponse = {
    builds: [myBuild(5)],
    jobs: [
      { name: 'main', url: 'https://jenkins.example.com/job/x/job/main/', builds: [myBuild(99)] },
    ],
  };
  const result = selectBuilds(response, me, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].branch, '');
  assert.equal(result[0].build.number, 5);
});
