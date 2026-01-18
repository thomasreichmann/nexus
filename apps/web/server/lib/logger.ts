import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

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
