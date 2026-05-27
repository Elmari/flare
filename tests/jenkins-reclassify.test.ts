import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reclassifyByStages, type BuildResult } from '../src/services/jenkins.js';
import type { WorkflowStage } from '../src/services/jenkins.schema.js';

const stage = (status: WorkflowStage['status'], name = 'Stage'): WorkflowStage => ({
  name,
  status,
});

test('reclassify: FAILURE with only UNSTABLE + SUCCESS stages -> UNSTABLE', () => {
  // The user's case: Jenkins marks the whole build red because of an unstable
  // stage, even though nothing actually failed hard.
  const stages = [stage('SUCCESS', 'Build'), stage('UNSTABLE', 'Test'), stage('SUCCESS', 'Deploy')];
  assert.equal(reclassifyByStages('FAILURE', stages), 'UNSTABLE');
});

test('reclassify: FAILURE with at least one FAILED stage stays FAILURE', () => {
  const stages = [stage('SUCCESS', 'Build'), stage('FAILED', 'Test'), stage('UNSTABLE', 'Lint')];
  assert.equal(reclassifyByStages('FAILURE', stages), 'FAILURE');
});

test('reclassify: FAILURE with all SUCCESS stages stays FAILURE', () => {
  // No unstable signal -> no reason to downgrade. The build is red for some
  // reason outside the stage view (post-build action, plugin failure, etc.).
  const stages = [stage('SUCCESS', 'Build'), stage('SUCCESS', 'Test')];
  assert.equal(reclassifyByStages('FAILURE', stages), 'FAILURE');
});

test('reclassify: non-FAILURE results pass through untouched', () => {
  const stages = [stage('UNSTABLE')];
  for (const r of ['SUCCESS', 'UNSTABLE', 'ABORTED', 'RUNNING'] as BuildResult[]) {
    assert.equal(reclassifyByStages(r, stages), r);
  }
});

test('reclassify: null stages (wfapi unavailable) -> result unchanged', () => {
  assert.equal(reclassifyByStages('FAILURE', null), 'FAILURE');
});

test('reclassify: empty stages -> result unchanged', () => {
  assert.equal(reclassifyByStages('FAILURE', []), 'FAILURE');
});

test('reclassify: FAILURE with NOT_EXECUTED + UNSTABLE stages -> UNSTABLE', () => {
  // NOT_EXECUTED is neither red nor a stable signal; what matters is that
  // nothing is FAILED and at least one stage is UNSTABLE.
  const stages = [stage('NOT_EXECUTED', 'SkippedBranch'), stage('UNSTABLE', 'Test')];
  assert.equal(reclassifyByStages('FAILURE', stages), 'UNSTABLE');
});
