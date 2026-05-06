import 'dotenv/config';
import { startWatcher } from './watcher.js';

startWatcher().catch(err => {
  console.error(err);
  process.exit(1);
});
