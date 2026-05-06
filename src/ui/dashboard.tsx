import React, { useCallback, useEffect, useRef, useState } from 'react';
import { render, Text, Box, useApp, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { fetchLatestJenkinsStatus, type JenkinsStatus } from '../services/jenkins.js';
import { fetchBitbucketPRs, type BitbucketPRStatus } from '../services/bitbucket.js';
import {
  analyzeBuildFailure,
  summarizePR,
  type AnalysisResponse,
  type AnalysisResult,
  type PRSummaryResponse,
} from '../llm.js';
import type { Config } from '../config.js';

interface Props {
  config: Config;
}

type Panel = 'jenkins' | 'bitbucket';

type DetailContent =
  | { kind: 'build'; data: AnalysisResponse }
  | { kind: 'pr'; data: PRSummaryResponse }
  | { kind: 'raw'; raw: string; error: string };

interface DetailState {
  title: string;
  url: string;
  loading: boolean;
  error: string | null;
  content: DetailContent | null;
}

function openInBrowser(url: string): void {
  if (!url) return;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function buildResultColor(r: JenkinsStatus['result']): string {
  if (r === 'SUCCESS') return 'green';
  if (r === 'FAILURE') return 'red';
  if (r === 'UNSTABLE') return 'yellow';
  if (r === 'ABORTED') return 'gray';
  return 'cyan';
}

function buildResultGlyph(r: JenkinsStatus['result']): string {
  if (r === 'SUCCESS') return '✓';
  if (r === 'FAILURE') return '✗';
  if (r === 'UNSTABLE') return '!';
  if (r === 'ABORTED') return '⊘';
  return '↻';
}

function prStatusBadge(s: BitbucketPRStatus['approvalStatus']): { glyph: string; color: string } {
  if (s === 'APPROVED') return { glyph: '✓', color: 'green' };
  if (s === 'NEEDS_WORK') return { glyph: '⚠', color: 'yellow' };
  return { glyph: '·', color: 'gray' };
}

const Dashboard: React.FC<Props> = ({ config }) => {
  const { exit } = useApp();
  const [jenkins, setJenkins] = useState<JenkinsStatus[]>([]);
  const [prs, setPrs] = useState<BitbucketPRStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [panel, setPanel] = useState<Panel>('jenkins');
  const [jenkinsIdx, setJenkinsIdx] = useState(0);
  const [bitbucketIdx, setBitbucketIdx] = useState(0);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const analysisCache = useRef<Map<string, DetailContent>>(new Map());

  const llmEnabled = Boolean(config.llm);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [j, p] = await Promise.all([
        fetchLatestJenkinsStatus(config),
        fetchBitbucketPRs(config),
      ]);
      setJenkins(j);
      setPrs(p);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [config]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, config.settings.dashboard_refresh_seconds * 1000);
    return () => clearInterval(interval);
  }, [refresh, config.settings.dashboard_refresh_seconds]);

  useEffect(() => {
    if (jenkinsIdx > 0 && jenkinsIdx >= jenkins.length) {
      setJenkinsIdx(Math.max(0, jenkins.length - 1));
    }
  }, [jenkins.length, jenkinsIdx]);
  useEffect(() => {
    if (bitbucketIdx > 0 && bitbucketIdx >= prs.length) {
      setBitbucketIdx(Math.max(0, prs.length - 1));
    }
  }, [prs.length, bitbucketIdx]);

  const startAnalysis = useCallback(async () => {
    if (!llmEnabled) return;

    if (panel === 'jenkins') {
      const build = jenkins[jenkinsIdx];
      if (!build) return;
      const cacheKey = `build:${build.job}:${build.number}`;
      const title = `Build analysis · ${build.job} #${build.number}`;
      const cached = analysisCache.current.get(cacheKey);
      if (cached) {
        setDetail({ title, url: build.url, loading: false, error: null, content: cached });
        return;
      }
      setDetail({ title, url: build.url, loading: true, error: null, content: null });
      try {
        const result: AnalysisResult<AnalysisResponse> = await analyzeBuildFailure(config, build);
        const content: DetailContent = result.ok
          ? { kind: 'build', data: result.response }
          : { kind: 'raw', raw: result.raw, error: result.error };
        analysisCache.current.set(cacheKey, content);
        setDetail({ title, url: build.url, loading: false, error: null, content });
      } catch (err) {
        setDetail({
          title,
          url: build.url,
          loading: false,
          error: (err as Error).message,
          content: null,
        });
      }
      return;
    }

    const pr = prs[bitbucketIdx];
    if (!pr) return;
    const cacheKey = `pr:${pr.id}:${pr.updatedDate}`;
    const title = `PR summary · ${pr.repo} #${pr.id}`;
    const cached = analysisCache.current.get(cacheKey);
    if (cached) {
      setDetail({ title, url: pr.url, loading: false, error: null, content: cached });
      return;
    }
    setDetail({ title, url: pr.url, loading: true, error: null, content: null });
    try {
      const result: AnalysisResult<PRSummaryResponse> = await summarizePR(config, pr);
      const content: DetailContent = result.ok
        ? { kind: 'pr', data: result.response }
        : { kind: 'raw', raw: result.raw, error: result.error };
      analysisCache.current.set(cacheKey, content);
      setDetail({ title, url: pr.url, loading: false, error: null, content });
    } catch (err) {
      setDetail({
        title,
        url: pr.url,
        loading: false,
        error: (err as Error).message,
        content: null,
      });
    }
  }, [config, panel, jenkins, jenkinsIdx, prs, bitbucketIdx, llmEnabled]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
      return;
    }
    if (key.escape) {
      if (detail) {
        setDetail(null);
        return;
      }
      exit();
      return;
    }
    if (detail) {
      if (input === 'a') {
        setDetail(null);
        return;
      }
      if (input === 'o') {
        if (detail.url) openInBrowser(detail.url);
      }
      return;
    }
    if (key.tab) {
      setPanel((p) => (p === 'jenkins' ? 'bitbucket' : 'jenkins'));
      return;
    }
    if (input === 'r') {
      refresh();
      return;
    }
    if (input === 'a') {
      startAnalysis();
      return;
    }
    if (key.upArrow) {
      if (panel === 'jenkins') setJenkinsIdx((i) => Math.max(0, i - 1));
      else setBitbucketIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      if (panel === 'jenkins') setJenkinsIdx((i) => Math.min(jenkins.length - 1, i + 1));
      else setBitbucketIdx((i) => Math.min(prs.length - 1, i + 1));
      return;
    }
    if (input === 'o' || key.return) {
      const url = panel === 'jenkins' ? jenkins[jenkinsIdx]?.url : prs[bitbucketIdx]?.url;
      if (url) openInBrowser(url);
    }
  });

  if (loading && !lastRefresh) {
    return <Text color="cyan">Loading status…</Text>;
  }

  if (detail) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{detail.title}</Text>
        </Box>
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          {detail.loading && (
            <Text color="cyan">Analyzing… (this can take a few seconds)</Text>
          )}
          {detail.error && (
            <Box flexDirection="column">
              <Text color="red">Error: {detail.error}</Text>
              <Text dimColor>Check llm.endpoint, llm.api_key_env, and network access.</Text>
            </Box>
          )}
          {detail.content?.kind === 'build' && (
            <BuildAnalysisView data={detail.content.data} />
          )}
          {detail.content?.kind === 'pr' && (
            <PRSummaryView data={detail.content.data} />
          )}
          {detail.content?.kind === 'raw' && (
            <RawAnalysisView raw={detail.content.raw} error={detail.content.error} />
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc/a back  ·  o open in browser  ·  q quit</Text>
        </Box>
      </Box>
    );
  }

  const failingBuilds = jenkins.filter((s) => s.result === 'FAILURE').length;
  const needsWorkPRs = prs.filter((p) => p.approvalStatus === 'NEEDS_WORK').length;
  const summaryParts: { text: string; color: string }[] = [];
  if (failingBuilds > 0) summaryParts.push({ text: `${failingBuilds} failing builds`, color: 'red' });
  if (needsWorkPRs > 0) summaryParts.push({ text: `${needsWorkPRs} PRs need work`, color: 'yellow' });
  const allClear = !error && summaryParts.length === 0;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">⏪ FLARE Dashboard</Text>
        {lastRefresh && (
          <Text dimColor>  ·  refreshed {lastRefresh.toLocaleTimeString()}</Text>
        )}
        {refreshing && <Text color="cyan">  ·  refreshing…</Text>}
      </Box>

      <Box marginBottom={1}>
        {allClear && <Text color="green">All clear ✓</Text>}
        {summaryParts.map((part, i) => (
          <React.Fragment key={part.text}>
            {i > 0 && <Text dimColor>  ·  </Text>}
            <Text color={part.color}>{part.text}</Text>
          </React.Fragment>
        ))}
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      <Box flexDirection="row">
        <Box
          flexDirection="column"
          width="50%"
          borderStyle="round"
          borderColor={panel === 'jenkins' ? 'magenta' : 'gray'}
          paddingX={1}
        >
          <Text bold underline>Jenkins Builds</Text>
          {jenkins.length === 0 && <Text dimColor>No builds found.</Text>}
          {jenkins.map((s, i) => {
            const isSelected = panel === 'jenkins' && i === jenkinsIdx;
            return (
              <Box key={s.job}>
                <Text color={isSelected ? 'magenta' : undefined}>{isSelected ? '▸ ' : '  '}</Text>
                <Text color={buildResultColor(s.result)}>{buildResultGlyph(s.result)} </Text>
                <Box flexGrow={1}>
                  <Text wrap="truncate-end">{s.job}</Text>
                </Box>
                <Text dimColor> #{s.number}</Text>
              </Box>
            );
          })}
        </Box>

        <Box
          flexDirection="column"
          width="50%"
          borderStyle="round"
          borderColor={panel === 'bitbucket' ? 'magenta' : 'gray'}
          paddingX={1}
          marginLeft={1}
        >
          <Text bold underline>Bitbucket PRs</Text>
          {prs.length === 0 && <Text dimColor>No open PRs.</Text>}
          {prs.map((pr, i) => {
            const isSelected = panel === 'bitbucket' && i === bitbucketIdx;
            const badge = prStatusBadge(pr.approvalStatus);
            return (
              <Box key={pr.id}>
                <Text color={isSelected ? 'magenta' : undefined}>{isSelected ? '▸ ' : '  '}</Text>
                <Text color={badge.color}>{badge.glyph}</Text>
                <Text color="cyan"> {pr.repo} #{pr.id} </Text>
                <Box flexGrow={1}>
                  <Text wrap="truncate-end">{pr.title}</Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ select  ·  Tab switch  ·  o/Enter open  ·{' '}
        </Text>
        {llmEnabled
          ? <Text dimColor>a analyze  ·  </Text>
          : <Text dimColor color="gray">a analyze (llm not configured)  ·  </Text>}
        <Text dimColor>r refresh  ·  q quit</Text>
      </Box>
    </Box>
  );
};

const BuildAnalysisView: React.FC<{ data: AnalysisResponse }> = ({ data }) => (
  <Box flexDirection="column">
    <Text bold>Summary</Text>
    <Text>{data.summary}</Text>
    {data.likely_cause && (
      <>
        <Box marginTop={1}><Text bold>Likely cause</Text></Box>
        <Text>{data.likely_cause}</Text>
      </>
    )}
    {data.fix_hint && (
      <>
        <Box marginTop={1}><Text bold color="green">Fix hint</Text></Box>
        <Text>{data.fix_hint}</Text>
      </>
    )}
  </Box>
);

const PRSummaryView: React.FC<{ data: PRSummaryResponse }> = ({ data }) => (
  <Box flexDirection="column">
    <Text bold>Summary</Text>
    <Text>{data.summary}</Text>
    {data.key_files && data.key_files.length > 0 && (
      <>
        <Box marginTop={1}><Text bold>Key files</Text></Box>
        {data.key_files.map((f) => <Text key={f}>· {f}</Text>)}
      </>
    )}
    {data.review_focus && (
      <>
        <Box marginTop={1}><Text bold color="yellow">Review focus</Text></Box>
        <Text>{data.review_focus}</Text>
      </>
    )}
  </Box>
);

const RawAnalysisView: React.FC<{ raw: string; error: string }> = ({ raw, error }) => (
  <Box flexDirection="column">
    <Text color="yellow">Could not parse structured response ({error}). Raw output:</Text>
    <Box marginTop={1}><Text>{raw}</Text></Box>
  </Box>
);

export function runDashboard(config: Config) {
  render(<Dashboard config={config} />);
}
