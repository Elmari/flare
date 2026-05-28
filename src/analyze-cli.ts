import fs from 'node:fs';
import { loadConfig } from './config.js';
import { snapshotPath } from './snapshot.js';
import {
  analyzeBuildFailure,
  summarizePR,
  type AnalysisResponse,
  type AnalysisResult,
  type PRSummaryResponse,
} from './llm.js';
import type { JenkinsStatus } from './services/jenkins.js';
import type { BitbucketPRStatus } from './services/bitbucket.js';

interface SnapshotShape {
  jenkins?: JenkinsStatus[];
  bitbucket?: BitbucketPRStatus[];
}

function readSnapshot(): SnapshotShape {
  const p = snapshotPath();
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    throw new Error(`No snapshot at ${p} — is \`flare watch\` running?`);
  }
  try {
    return JSON.parse(raw) as SnapshotShape;
  } catch (err) {
    throw new Error(`Snapshot is not valid JSON: ${(err as Error).message}`);
  }
}

function ensureLlm(): void {
  const cfg = loadConfig();
  if (!cfg.llm) {
    throw new Error(
      'LLM is not configured. Add an `llm:` block to ~/.config/flare/config.yaml.',
    );
  }
}

function printBuildResult(result: AnalysisResult<AnalysisResponse>): void {
  if (!result.ok) {
    console.log('Could not parse structured response:');
    console.log(`  ${result.error}`);
    console.log('');
    console.log('Raw output:');
    console.log(result.raw);
    return;
  }
  const r = result.response;
  console.log('Summary');
  console.log(r.summary);
  if (r.likely_cause) {
    console.log('');
    console.log('Likely cause');
    console.log(r.likely_cause);
  }
  if (r.fix_hint) {
    console.log('');
    console.log('Fix hint');
    console.log(r.fix_hint);
  }
}

function printPrResult(result: AnalysisResult<PRSummaryResponse>): void {
  if (!result.ok) {
    console.log('Could not parse structured response:');
    console.log(`  ${result.error}`);
    console.log('');
    console.log('Raw output:');
    console.log(result.raw);
    return;
  }
  const r = result.response;
  console.log('Summary');
  console.log(r.summary);
  if (r.key_files && r.key_files.length > 0) {
    console.log('');
    console.log('Key files');
    for (const f of r.key_files) console.log(`  · ${f}`);
  }
  if (r.assessment) {
    console.log('');
    console.log('Assessment');
    console.log(r.assessment);
  }
  if (r.review_focus) {
    console.log('');
    console.log('Review focus');
    console.log(r.review_focus);
  }
}

export async function analyzeBuildCli(jobPath: string): Promise<void> {
  ensureLlm();
  const cfg = loadConfig();
  const snap = readSnapshot();
  const builds = snap.jenkins ?? [];
  const build = builds.find((b) => b.job === jobPath);
  if (!build) {
    throw new Error(
      `Job not found in snapshot: ${jobPath}. Available: ${builds.map((b) => b.job).join(', ') || '(none)'}`,
    );
  }
  console.log(`Analyzing ${build.job} #${build.number} …`);
  console.log('');
  const result = await analyzeBuildFailure(cfg, build);
  printBuildResult(result);
}

export async function analyzePrCli(repo: string, prId: number): Promise<void> {
  ensureLlm();
  const cfg = loadConfig();
  const snap = readSnapshot();
  const prs = snap.bitbucket ?? [];
  const pr = prs.find((p) => p.repo === repo && p.id === prId);
  if (!pr) {
    throw new Error(
      `PR not found in snapshot: ${repo} #${prId}. Make sure \`flare watch\` is running and has fetched the PR.`,
    );
  }
  console.log(`Summarizing ${pr.repo} #${pr.id} — ${pr.title} …`);
  console.log('');
  const result = await summarizePR(cfg, pr);
  printPrResult(result);
}
