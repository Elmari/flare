import { execSync } from 'node:child_process';

export function isOnBattery(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const output = execSync('pmset -g batt').toString();
    return output.includes("Now drawing from 'Battery Power'");
  } catch {
    return false;
  }
}
