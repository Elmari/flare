import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseMyBuild, isMyBuild, type Identity } from '../src/services/jenkins.js';
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

test('isMyBuild: webhook trigger where my commit is the latest in changeSet returns true', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ userName: 'Bitbucket' }] }],
    changeSet: {
      items: [
        { authorEmail: 'bob@firma.de', timestamp: 1000 },
        { authorEmail: 'alice@firma.de', timestamp: 2000 },
      ],
    },
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: my commit present but a newer commit by someone else means not my build', () => {
  // Renovate scenario: a freshly indexed branch's first build can include
  // unrelated old commits by the user (since fork point) plus the bot's
  // most recent commit. The build represents the bot's work, not mine.
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Branch indexing' }] }],
    changeSets: [
      {
        items: [
          { authorEmail: 'alice@firma.de', timestamp: 1000 },
          { authorEmail: 'renovate@bot.com', timestamp: 5000 },
        ],
      },
    ],
  };
  assert.equal(isMyBuild(b, me), false);
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

test('isMyBuild: Pipeline-style changeSets[] (plural) is recognised', () => {
  // Pipeline / multibranch jobs expose changeSets[] (plural). Earlier
  // versions only checked the singular changeSet and missed all
  // push-triggered builds on Pipeline jobs.
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Branch indexing' }] }],
    changeSets: [
      { items: [{ authorEmail: 'bob@firma.de', timestamp: 1000 }] },
      { items: [{ authorEmail: 'alice@firma.de', timestamp: 2000 }] },
    ],
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: shortDescription substring match on username (e.g. "Aborted by alice")', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Aborted by alice' }] }],
  };
  assert.equal(isMyBuild(b, me), true);
});

test('isMyBuild: causes with no identifying fields are ignored', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Triggered by SCM polling' }] }],
  };
  assert.equal(isMyBuild(b, me), false);
});

test('diagnoseMyBuild: bitbucket branch author fallback matches when changeSet is empty', () => {
  // Simulates the initial branch-indexing build: empty changeSet, no useful
  // cause. Bitbucket tells us the branch's latest committer is me → match.
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Branch indexing' }] }],
  };
  const d = diagnoseMyBuild(b, me, 'alice@firma.de');
  assert.equal(d.match, true);
  assert.match(d.reason, /bitbucket branch author/);
});

test('diagnoseMyBuild: bitbucket branch author fallback does not match someone else', () => {
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ shortDescription: 'Branch indexing' }] }],
  };
  const d = diagnoseMyBuild(b, me, 'bob@firma.de');
  assert.equal(d.match, false);
});

test('diagnoseMyBuild: cause match wins over bitbucket fallback (latter not even consulted)', () => {
  // Sanity: if Jenkins data already identifies me, the reason should reflect
  // that, not the Bitbucket fallback.
  const b: JenkinsBuild = {
    ...baseBuild,
    actions: [{ causes: [{ userId: 'alice' }] }],
  };
  const d = diagnoseMyBuild(b, me, 'someone-else@firma.de');
  assert.equal(d.match, true);
  assert.match(d.reason, /userId=alice/);
});
