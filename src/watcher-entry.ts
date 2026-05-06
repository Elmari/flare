import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startWatcher } from './watcher.js';

loadDotenv();
loadDotenv({ path: join(homedir(), '.config', 'flare', '.env') });

startWatcher().catch(err => {
  console.error(err);
  process.exit(1);
});
