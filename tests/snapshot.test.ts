import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SNAPSHOT_SCHEMA_VERSION,
  writeSnapshotTo,
  type WatcherSnapshot,
} from '../src/snapshot.js';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flare-snapshot-'));
  return path.join(dir, 'snapshot.json');
}

function sample(now: number): WatcherSnapshot {
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    last_poll_at: now,
    jenkins: [
      { job: 'team/job/branch', number: 42, result: 'SUCCESS', url: 'http://j/42', recent: ['SUCCESS'] },
    ],
    bitbucket: [
      {
        id: 7,
        title: 'fix things',
        repo: 'PRJ/repo',
        state: 'OPEN',
        updatedDate: now - 1000,
        url: 'http://b/7',
        author: 'jane',
        iAmAuthor: true,
        approvalStatus: 'UNAPPROVED',
      },
    ],
  };
}

test('writeSnapshotTo persists a JSON snapshot that round-trips', () => {
  const target = tmpFile();
  const snapshot = sample(1_700_000_000_000);

  writeSnapshotTo(target, snapshot);

  const raw = fs.readFileSync(target, 'utf8');
  const parsed = JSON.parse(raw) as WatcherSnapshot;
  assert.deepEqual(parsed, snapshot);
});

test('writeSnapshotTo replaces an existing snapshot atomically (no .tmp left behind)', () => {
  const target = tmpFile();
  writeSnapshotTo(target, sample(1));
  writeSnapshotTo(target, sample(2));

  const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as WatcherSnapshot;
  assert.equal(parsed.last_poll_at, 2);
  assert.equal(fs.existsSync(`${target}.tmp`), false);
});

test('writeSnapshotTo creates the parent directory if it does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flare-snapshot-'));
  const target = path.join(dir, 'nested', 'deeper', 'snapshot.json');

  writeSnapshotTo(target, sample(1));

  assert.equal(fs.existsSync(target), true);
});
