import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      // Send logs to stderr (fd 2) so they don't collide with Ink's TUI
      // rendering on stdout when running `flare status`.
      destination: 2,
    },
  },
});
