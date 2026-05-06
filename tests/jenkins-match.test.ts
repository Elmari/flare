import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMyBuild, type Identity } from '../src/services/jenkins.js';
import type { JenkinsBuild } from '../src/services/jenkins.schema.js';

const baseBuild: JenkinsBuild = {
  number: 1,
  url: 'https://jenkins.example.com/job/x/1/',
  result: 'SUCCESS',
  timestamp: 0,
};

const me: Identity = { username: 'alice', emails: ['alice@firma.de'] };

test('isMyBuild: empty build returns false', () => {
  assert.equal(isMyBuild(baseBuild, me), false);
});

test('isMyBuild: triggered directly by username', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ userId: 'alice', userName: 'Alice' }] }],
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: SSO sets userId to email — emails are valid cause tokens', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ userId: 'alice@firma.de' }] }],
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: webhook trigger with no matching commits returns false', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ userName: 'Bitbucket' }] }],
    changeSet: { items: [{ authorEmail: 'bob@firma.de' }] },
  };
  assert.equal(isMyBuild(b, me), false);
});

test('isMyBuild: webhook trigger with my commit in changeSet returns true', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ userName: 'Bitbucket' }] }],
    changeSet: {
      items: [{ authorEmail: 'bob@firma.de' }, { authorEmail: 'alice@firma.de' }],
    },
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: shortDescription substring match on email is allowed (free-text field)', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Started by user alice@firma.de' }] }],
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: matching is case-insensitive', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ userId: 'ALICE' }] }],
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: short username does not cause false positives via name substring', () => {
  // Earlier implementation matched authorName.includes(username), which would falsely
  // match any author whose name contains the username as substring.
  const shortMe: Identity = { username: 'em', emails: ['em@firma.de'] };
  const b: JenkinsBuild = {
    ...baseBuild,
    changeSet: { items: [{ authorEmail: 'demir@firma.de' }] },
  };
  assert.equal(isMyBuild(b, shortMe), false);
});

test('isMyBuild: changeSet email match requires exact equality, not substring', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    changeSet: { items: [{ authorEmail: 'alice@firma.de.attacker.com' }] },
  };
  assert.equal(isMyBuild(b, me), false);
});

test('isMyBuild: causes with no identifying fields are ignored', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Triggered by SCM polling' }] }],
  };
  assert.equal(isMyBuild(b, me), false);
});
