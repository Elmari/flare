#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';

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
  .action(async () => {
    try {
      const { loadConfig } = await import('./config.js');
      const { runDashboard } = await import('./ui/dashboard.js');
      const config = loadConfig();
      runDashboard(config);
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

program.parseAsync(process.argv);
