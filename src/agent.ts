import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.flare.watcher';

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function logsDir(): string {
  return join(homedir(), 'Library', 'Logs', 'flare');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPlist(nodeBin: string, flareEntry: string): string {
  const logs = logsDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodeBin)}</string>
    <string>${escapeXml(flareEntry)}</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(logs, 'watcher.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(logs, 'watcher.err.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function bootout(silent: boolean): boolean {
  try {
    execSync(`launchctl bootout gui/$(id -u)/${LABEL}`, { stdio: silent ? 'ignore' : 'inherit' });
    return true;
  } catch {
    return false;
  }
}

export function installAgent(): void {
  if (process.platform !== 'darwin') {
    throw new Error('flare install-agent currently supports macOS only.');
  }

  const nodeBin = process.execPath;
  const flareEntry = fileURLToPath(new URL('./index.js', import.meta.url));
  if (!existsSync(flareEntry)) {
    throw new Error(
      `Could not find the flare entry at ${flareEntry}.\n` +
      '  Run `npm run build && npm link` first, then re-run `flare install-agent`.',
    );
  }

  const target = plistPath();
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(logsDir(), { recursive: true });

  if (existsSync(target)) {
    bootout(true);
  }

  writeFileSync(target, buildPlist(nodeBin, flareEntry), 'utf8');
  execSync(`launchctl bootstrap gui/$(id -u) ${shellQuote(target)}`, { stdio: 'inherit' });

  const envPath = join(homedir(), '.config', 'flare', '.env');
  console.log(`✓ Installed LaunchAgent at ${target}`);
  console.log(`  Logs: ${logsDir()}/watcher.{out,err}.log`);
  console.log(`  Watcher will start on next login and run in the background.`);
  if (!existsSync(envPath)) {
    console.log('');
    console.log(`! Heads up: no ${envPath}`);
    console.log(`  LaunchAgents do not see your shell .env. Copy your tokens there:`);
    console.log(`    cp .env ${envPath}`);
  }
  console.log('');
  console.log(`  To remove: flare uninstall-agent`);
}

export function reloadAgent(): void {
  if (process.platform !== 'darwin') {
    throw new Error('flare reload-agent currently supports macOS only.');
  }

  const target = plistPath();
  if (!existsSync(target)) {
    throw new Error(
      `No LaunchAgent plist at ${target}.\n` +
      '  Run `flare install-agent` first.',
    );
  }

  bootout(true);
  execSync(`launchctl bootstrap gui/$(id -u) ${shellQuote(target)}`, { stdio: 'inherit' });
  console.log(`✓ Reloaded LaunchAgent (${target})`);
  console.log(`  Logs: ${logsDir()}/watcher.{out,err}.log`);
}

export function uninstallAgent(): void {
  if (process.platform !== 'darwin') {
    throw new Error('flare uninstall-agent currently supports macOS only.');
  }

  const target = plistPath();
  const wasLoaded = bootout(true);

  if (existsSync(target)) {
    unlinkSync(target);
    console.log(`✓ Removed plist at ${target}`);
  } else {
    console.log(`No plist found at ${target}.`);
  }

  if (wasLoaded) {
    console.log('✓ Unloaded the LaunchAgent.');
  }
}
