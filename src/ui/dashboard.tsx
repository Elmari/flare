import React, { useCallback, useEffect, useState } from 'react';
import { render, Text, Box, useApp, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { fetchLatestJenkinsStatus, type JenkinsStatus } from '../services/jenkins.js';
import { fetchBitbucketPRs, type BitbucketPRStatus } from '../services/bitbucket.js';
import type { Config } from '../config.js';

interface Props {
  config: Config;
}

type Panel = 'jenkins' | 'bitbucket';

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

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
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
          ↑↓ select  ·  Tab switch  ·  o/Enter open  ·  r refresh  ·  q quit
        </Text>
      </Box>
    </Box>
  );
};

export function runDashboard(config: Config) {
  render(<Dashboard config={config} />);
}
