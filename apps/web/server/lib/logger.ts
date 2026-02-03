import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

// Install source-mapped stack traces in development
import './logger/patches/install';

export const isDev = process.env.NODE_ENV === 'development';

export type ErrorVerbosity = 'minimal' | 'standard' | 'full';

export const errorVerbosity: ErrorVerbosity = isDev ? 'full' : 'standard';

const DEV_LOG_PATH = path.join(process.cwd(), '.dev.log');

// Prevent HMR from re-truncating the file
const globalKey = Symbol.for('nexus.devLogTruncated');
const g = globalThis as typeof globalThis & { [globalKey]?: boolean };

if (isDev && !g[globalKey]) {
    g[globalKey] = true;
    try {
        fs.writeFileSync(DEV_LOG_PATH, '');
    } catch {
        // File creation happens when pino opens it
    }
}

const transport = isDev
    ? pino.transport({
          targets: [
              {
                  target: 'pino-pretty',
                  options: { colorize: true, singleLine: true },
                  level: 'debug',
              },
              {
                  target: 'pino/file',
                  options: { destination: DEV_LOG_PATH },
                  level: 'debug',
              },
          ],
      })
    : undefined;

export const logger = pino(
    {
        level: isDev ? 'debug' : 'info',
    },
    transport
);
