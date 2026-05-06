import { z } from 'zod';
import { bearer, request } from './http.js';
import { readEnvSecret, type Config } from './config.js';
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
  review_focus: z.string().optional(),
});
export type PRSummaryResponse = z.infer<typeof PRSummaryResponseSchema>;

export type AnalysisResult<T> =
  | { ok: true; response: T }
  | { ok: false; raw: string; error: string };

const ChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ).min(1),
});

interface LlmCallArgs {
  config: Config;
  systemPrompt: string;
  userPrompt: string;
}

async function chatComplete({ config, systemPrompt, userPrompt }: LlmCallArgs): Promise<string> {
  const llm = config.llm;
  if (!llm) throw new Error('LLM is not configured (missing `llm` block in config.yaml).');

  const apiKey = readEnvSecret(llm.api_key_env);
  const url = `${llm.endpoint.replace(/\/$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...bearer(apiKey),
    ...(llm.custom_headers ?? {}),
  };

  const body = JSON.stringify({
    model: llm.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const data = await request<unknown>(url, { method: 'POST', headers, body, timeoutMs: 60_000 });
  const parsed = ChatResponseSchema.parse(data);
  return parsed.choices[0].message.content;
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
  const truncated = log.truncated;
  const userPrompt = buildAnalysisPrompt(build.job, build.number, log.text, truncated);

  const raw = await chatComplete({
    config,
    systemPrompt: BUILD_SYSTEM_PROMPT,
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

  const raw = await chatComplete({
    config,
    systemPrompt: PR_SYSTEM_PROMPT,
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
