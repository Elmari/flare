#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

loadDotenv({ quiet: true });
loadDotenv({ path: join(homedir(), '.config', 'flare', '.env'), quiet: true });

const program = new Command();
program
  .name('flare')
  .description('Proactive developer dashboard')
  .version('0.1.0');

program
  .command('config')
  .description('config helpers')
  .command('init')
  .description('write a sample config file')
  .action(async () => {
    try {
      const { writeSampleConfig } = await import('./config.js');
      const p = writeSampleConfig();
      console.log(`Wrote sample config to ${p}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current PR and Build status (TUI)')
  .option('--no-fullscreen', 'render inline instead of taking over the terminal')
  .action(async (opts: { fullscreen: boolean }) => {
    try {
      const { loadConfig } = await import('./config.js');
      const { runDashboard } = await import('./ui/dashboard.js');
      const config = loadConfig();
      runDashboard(config, { fullscreen: opts.fullscreen });
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

const debug = program.command('debug').description('Diagnose data fetching for a source');

debug
  .command('jenkins <job-path>')
  .description('Show how flare interprets a Jenkins job (selection, identity match, age cutoff)')
  .action(async (jobPath: string) => {
    try {
      const { loadConfig } = await import('./config.js');
      const { diagnoseJenkinsJob } = await import('./diagnose.js');
      const config = loadConfig();
      const out = await diagnoseJenkinsJob(config, jobPath);
      console.log(out);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Start the background watcher manually')
  .action(async () => {
    const { startWatcher } = await import('./watcher.js');
    await startWatcher();
  });

program
  .command('install-agent')
  .description('Install a macOS LaunchAgent that runs `flare watch` on login')
  .action(async () => {
    try {
      const { installAgent } = await import('./agent.js');
      installAgent();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('reload-agent')
  .description('Restart the macOS LaunchAgent (pick up a new build or config)')
  .action(async () => {
    try {
      const { reloadAgent } = await import('./agent.js');
      reloadAgent();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('uninstall-agent')
  .description('Unload and remove the macOS LaunchAgent')
  .action(async () => {
    try {
      const { uninstallAgent } = await import('./agent.js');
      uninstallAgent();
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
