import type { AnyRouter } from '@trpc/server';

/**
 * JSON Schema 7 type (subset of what Zod generates)
 */
export type JSONSchema = {
    type?: string | string[];
    properties?: Record<string, JSONSchema>;
    items?: JSONSchema | JSONSchema[];
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    anyOf?: JSONSchema[];
    oneOf?: JSONSchema[];
    allOf?: JSONSchema[];
    $ref?: string;
    $defs?: Record<string, JSONSchema>;
    description?: string;
    default?: unknown;
    [key: string]: unknown;
};

/**
 * Procedure type extracted from tRPC
 */
export type ProcedureType = 'query' | 'mutation' | 'subscription';

/**
 * Schema for a single procedure extracted from the router
 */
export interface ProcedureSchema {
    /** Full path of the procedure (e.g., "files.list") */
    path: string;
    /** Type of procedure */
    type: ProcedureType;
    /** JSON Schema for the input, generated from Zod */
    inputSchema: JSONSchema | null;
    /** JSON Schema for the output, if .output() was defined */
    outputSchema: JSONSchema | null;
    /** Description from .meta() or Zod .describe() */
    description?: string;
    /** Tags from .meta() for grouping */
    tags?: string[];
}

/**
 * Full schema for a router, including all procedures
 */
export interface RouterSchema {
    /** All procedures in the router */
    procedures: ProcedureSchema[];
    /** Version of the schema format */
    version: 1;
    /** Timestamp when schema was generated */
    generatedAt: string;
}

/**
 * Authentication configuration options
 */
export type AuthConfig =
    | {
          /** Use BetterAuth session from cookies */
          provider: 'better-auth';
      }
    | {
          /** Use custom headers for authentication */
          type: 'headers';
          headers: Record<string, string>;
      }
    | undefined;

/**
 * Configuration for createTRPCStudio
 */
export interface TRPCStudioConfig<TRouter extends AnyRouter> {
    /** The tRPC router to introspect */
    router: TRouter;
    /** URL of the tRPC endpoint */
    url: string;
    /** Authentication configuration */
    auth?: AuthConfig;
    /** Base path for studio assets (defaults to request path) */
    basePath?: string;
}
