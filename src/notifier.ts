import notifier from 'node-notifier';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ICON_PATH = join(__dirname, '..', 'assets', 'flare.png');

let timeoutSeconds = 10;

export function setNotificationTimeout(seconds: number): void {
  timeoutSeconds = Math.max(1, seconds);
}

export function notify(title: string, message: string, onClick?: () => void): void {
  notifier.notify(
    {
      title,
      message,
      icon: ICON_PATH,
      contentImage: ICON_PATH,
      sound: true,
      wait: true,
      timeout: timeoutSeconds,
    },
    (err, response, metadata) => {
      if (response === 'activate' && onClick) {
        onClick();
      }
    },
  );
}
