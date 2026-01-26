import pino from 'pino';

export const isDev = process.env.NODE_ENV === 'development';

export type ErrorVerbosity = 'minimal' | 'standard' | 'full';

export const errorVerbosity: ErrorVerbosity = isDev ? 'full' : 'standard';

const transport = isDev
    ? {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true },
      }
    : undefined;

export const logger = pino({
    level: isDev ? 'debug' : 'info',
    transport,
});
