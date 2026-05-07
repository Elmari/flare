import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startWatcher } from './watcher.js';

loadDotenv({ quiet: true });
loadDotenv({ path: join(homedir(), '.config', 'flare', '.env'), quiet: true });

startWatcher().catch(err => {
  console.error(err);
  process.exit(1);
});
