import { z } from 'zod';
import { request } from './http.js';
import type { Config } from './config.js';
import { fetchBuildLog, type JenkinsStatus } from './services/jenkins.js';
import { fetchPRDiff, type BitbucketPRStatus } from './services/bitbucket.js';

export const AnalysisResponseSchema = z.object({
  summary: z.string(),
  likely_cause: z.string().optional(),
  fix_hint: z.string().optional(),
});
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

export const PRSummaryResponseSchema = z.object({
  summary: z.string(),
  key_files: z.array(z.string()).optional(),
  assessment: z.string().optional(),
  review_focus: z.string().optional(),
});
export type PRSummaryResponse = z.infer<typeof PRSummaryResponseSchema>;

export type AnalysisResult<T> =
  | { ok: true; response: T }
  | { ok: false; raw: string; error: string };

const ENV_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function resolveCustomHeaders(custom?: Record<string, string>): Record<string, string> {
  if (!custom) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(custom)) {
    out[name] = value.replace(ENV_VAR_RE, (_match, varName: string) => {
      const v = process.env[varName];
      if (v === undefined || v === '') {
        throw new Error(`llm.custom_headers.${name}: env var ${varName} is not set`);
      }
      return v;
    });
  }
  return out;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

interface GeminiCallArgs {
  config: Config;
  systemInstruction: string;
  userPrompt: string;
}

async function callGemini({ config, systemInstruction, userPrompt }: GeminiCallArgs): Promise<string> {
  const llm = config.llm;
  if (!llm) throw new Error('LLM is not configured (missing `llm` block in config.yaml).');

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...resolveCustomHeaders(llm.custom_headers),
  };

  const res = await request<GeminiResponse>(llm.endpoint, {
    method: 'POST',
    headers,
    body,
    timeoutMs: 60_000,
  });

  if (res.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${res.promptFeedback.blockReason}`);
  }

  const candidate = res.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  if (!text.trim()) {
    const reason = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : '';
    throw new Error(`Gemini returned an empty response${reason}`);
  }

  return text;
}

export function extractJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    // ignore — try fenced code block fallback
  }
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }
  throw new Error('LLM response did not contain valid JSON');
}

const BUILD_SYSTEM_PROMPT = `You are a senior engineer triaging a failed CI build.
Read the truncated console log and respond with a JSON object matching this shape:
{
  "summary": "one or two sentences naming the actual error",
  "likely_cause": "best guess at the root cause, omit if unclear",
  "fix_hint": "concrete fix only when obvious from the log (lint, missing import, config typo); omit otherwise"
}
Respond with JSON only. No prose, no code fences.`;

const PR_SYSTEM_PROMPT = `You are a senior reviewer scanning a pull request diff.
Respond with a JSON object matching this shape:
{
  "summary": "two or three sentences describing what changed and why it likely matters",
  "key_files": ["file/paths/that/carry/the/main/change"],
  "assessment": "what your opinion / assessment / review is of this changes. Focus solely on the code changes you see",
  "review_focus": "what a human reviewer should pay attention to (correctness risk, missing tests, etc.); omit if nothing stands out"
}
Respond with JSON only. No prose, no code fences.`;

export function buildAnalysisPrompt(jobPath: string, buildNumber: number, log: string, truncated: boolean): string {
  const header = `Job: ${jobPath}\nBuild: #${buildNumber}\n` +
    (truncated ? '(log truncated to the most recent portion)\n' : '') +
    '\n--- console output ---\n';
  return header + log;
}

export function buildPRPrompt(repo: string, prId: number, title: string, diff: string, truncated: boolean): string {
  const header = `Repository: ${repo}\nPull Request: #${prId} — ${title}\n` +
    (truncated ? '(diff truncated)\n' : '') +
    '\n--- unified diff ---\n';
  return header + diff;
}

export async function analyzeBuildFailure(
  config: Config,
  build: JenkinsStatus,
): Promise<AnalysisResult<AnalysisResponse>> {
  const maxBytes = (config.llm?.max_log_kb ?? 30) * 1024;
  const log = await fetchBuildLog(config, build.url, maxBytes);
  const userPrompt = buildAnalysisPrompt(build.job, build.number, log.text, log.truncated);

  const raw = await callGemini({
    config,
    systemInstruction: BUILD_SYSTEM_PROMPT,
    userPrompt,
  });

  try {
    const json = extractJson(raw);
    const response = AnalysisResponseSchema.parse(json);
    return { ok: true, response };
  } catch (err) {
    return { ok: false, raw, error: (err as Error).message };
  }
}

export async function summarizePR(
  config: Config,
  pr: BitbucketPRStatus,
): Promise<AnalysisResult<PRSummaryResponse>> {
  const maxBytes = (config.llm?.max_diff_kb ?? 50) * 1024;
  const diff = await fetchPRDiff(config, pr.repo, pr.id, maxBytes);
  const userPrompt = buildPRPrompt(pr.repo, pr.id, pr.title, diff.text, diff.truncated);

  const raw = await callGemini({
    config,
    systemInstruction: PR_SYSTEM_PROMPT,
    userPrompt,
  });

  try {
    const json = extractJson(raw);
    const response = PRSummaryResponseSchema.parse(json);
    return { ok: true, response };
  } catch (err) {
    return { ok: false, raw, error: (err as Error).message };
  }
}
