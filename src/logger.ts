import pino from 'pino';

export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: ['token', 'signature', 'session', '*.token', '*.signature', '*.session'],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
