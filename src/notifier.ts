import notifier from 'node-notifier';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function notify(title: string, message: string, onClick?: () => void): void {
  notifier.notify(
    {
      title,
      message,
      sound: true, // Play a sound
      wait: true,  // Wait for User Action
      timeout: 10, // Close after 10s if no action
    },
    (err, response, metadata) => {
      if (response === 'activate' && onClick) {
        onClick();
      }
    }
  );
}
