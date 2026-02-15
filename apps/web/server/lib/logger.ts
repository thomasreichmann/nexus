import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import type { z } from 'zod';

// Install source-mapped stack traces in development
import './logger/patches/install';

import { env } from '@/lib/env';
import { logErrorVerbositySchema } from '@/lib/env/schema';

export const isDev = process.env.NODE_ENV === 'development';

export type ErrorVerbosity = z.infer<typeof logErrorVerbositySchema>;

export const errorVerbosity: ErrorVerbosity =
    env.LOG_ERROR_VERBOSITY ?? (isDev ? 'full' : 'standard');

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

// Custom transport wraps pino-pretty with a customPrettifier that expands
// escaped newlines in "message" fields (e.g. Zod validation summaries).
// It's a .mjs file so pino's worker thread can load it via native ESM.
const PRETTY_TRANSPORT = path.join(
    process.cwd(),
    'server/lib/logger/transports/pretty.mjs'
);

const transport = isDev
    ? pino.transport({
          targets: [
              {
                  target: PRETTY_TRANSPORT,
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
