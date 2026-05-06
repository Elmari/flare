import React, { useEffect, useState } from 'react';
import { render, Text, Box, useInput } from 'ink';
import { fetchLatestJenkinsStatus, JenkinsStatus } from '../services/jenkins.js';
import { fetchBitbucketPRs, BitbucketPRStatus } from '../services/bitbucket.js';
import type { Config } from '../config.js';

interface Props {
  config: Config;
}

const Dashboard: React.FC<Props> = ({ config }) => {
  const [jenkins, setJenkins] = useState<JenkinsStatus[]>([]);
  const [prs, setPrs] = useState<BitbucketPRStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [j, p] = await Promise.all([
          fetchLatestJenkinsStatus(config),
          fetchBitbucketPRs(config),
        ]);
        setJenkins(j);
        setPrs(p);
      } catch (err) {
        // handle error
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [config]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      process.exit(0);
    }
  });

  if (loading) {
    return <Text color="cyan">Loading status...</Text>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">⏪ FLARE Dashboard</Text>
      </Box>

      <Box flexDirection="row">
        <Box flexDirection="column" width="50%" borderStyle="round" paddingX={1}>
          <Text bold underline>Jenkins Builds</Text>
          {jenkins.length === 0 && <Text dimColor>No builds found.</Text>}
          {jenkins.map(s => (
            <Box key={s.job}>
              <Text color={s.result === 'SUCCESS' ? 'green' : s.result === 'FAILURE' ? 'red' : 'yellow'}>
                {s.result === 'SUCCESS' ? '✓' : '✗'}
              </Text>
              <Text> {s.job} #{s.number}</Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" width="50%" borderStyle="round" paddingX={1} marginLeft={1}>
          <Text bold underline>Bitbucket PRs</Text>
          {prs.length === 0 && <Text dimColor>No open PRs.</Text>}
          {prs.map(pr => (
            <Box key={pr.id}>
              <Text color="cyan">{pr.repo} #{pr.id}</Text>
              <Text> {pr.title.slice(0, 30)}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press 'q' to quit</Text>
      </Box>
    </Box>
  );
};

export function runDashboard(config: Config) {
  render(<Dashboard config={config} />);
}
