/**
 * Engine execution context.
 *
 * Creates the global-like environment the legacy engine expects:
 * Q, XHR, dnsLookup, logger, sidecar, tests, criteria, etc.
 *
 * This formalizes what run-in-page.ts does at runtime in the extension.
 */

import type { Logger, Services, EngineConfig, Sidecar } from './index.js';

/**
 * Q shim — subset of Mozilla SDK promise API used by the engine.
 */
export function createQShim() {
  const makeDefer = () => {
    let resolve!: (v?: unknown) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  return {
    defer: makeDefer,
    resolve: (v: unknown) => Promise.resolve(v),
    reject: (e: unknown) => Promise.reject(e),
    promised: (_Ctor: unknown) => (...ps: unknown[]) => Promise.all(ps),
  };
}

/**
 * XHR shim — backed by responses map or inert fallback.
 */
export interface XhrResponseData {
  status: number;
  statusText: string;
  headers: { name: string; value: string }[];
  content_type: string | null;
  data: string;
}

export function createXhrShim(
  responses: Record<string, XhrResponseData> = {},
  fallback?: (url: string) => Promise<{ status: number; data: string; getHeader(name: string): string | null }>,
) {
  const makeResponse = (r?: XhrResponseData) => {
    const headers = r?.headers || [];
    return {
      status: r?.status ?? 0,
      statusText: r?.statusText ?? '',
      headers,
      content_type: r?.content_type ?? null,
      data: r?.data ?? '',
      xml: null,
      getHeader(name: string) {
        const lc = name.toLowerCase();
        const vals = headers.filter((h) => h.name.toLowerCase() === lc).map((h) => h.value);
        return vals.length ? vals.join(',') : null;
      },
    };
  };

  // A URL that was not pre-loaded falls through to the caller's fetcher when one is supplied.
  // Without this the shim answers `status: 0, data: ''` for everything it was not handed, which
  // reads to the rules as "the resource exists and is empty" rather than "not fetched" — 75 CSS
  // verdicts flipped from c to nc on that alone, because the stylesheet came back blank.
  const serve = (url: string) => {
    const known = responses[url];
    if (known || !fallback) return Promise.resolve(makeResponse(known));
    return Promise.resolve(fallback(url)).then((r) =>
      r && typeof r === 'object' ? r : makeResponse(undefined),
    );
  };

  return {
    get: (url: string) => serve(url),
    query: (url: string) => serve(url),
  };
}

/**
 * Logger shim — wraps provided logger or uses no-op.
 */
export function createLoggerShim(logger?: Logger, config?: EngineConfig) {
  const debug = config?.debug ?? false;
  const showErrors = config?.showErrors ?? false;

  return {
    log_firebug: debug,
    log_alert: false,
    log_ajax: false,
    show_date: false,
    log(tag: string, message: unknown) {
      if (debug && logger) {
        logger.log(`[${tag}]`, message);
      }
    },
    logObject(tag: string, object: unknown) {
      if (debug && logger) {
        logger.log(`[${tag}]`, object);
      }
    },
    error(tag: string, error: unknown) {
      if (showErrors && logger) {
        logger.error(`[${tag}]`, error);
      }
    },
  };
}

/**
 * Full engine context — all globals the engine expects.
 */
export interface EngineContext {
  // Core dependencies
  Q: ReturnType<typeof createQShim>;
  XHR: ReturnType<typeof createXhrShim>;
  dnsLookup: (host: string) => Promise<string | null>;
  logger: ReturnType<typeof createLoggerShim>;

  // Runtime data (set before analyze)
  sidecar: Sidecar | null;
  tests: Record<string, string> | null;
  criteria: Record<string, unknown> | null;

  // Config flags
  debug_validator: boolean;
  show_errors: boolean;

  // Functions populated by legacy libs
  analyze: ((criteria: Record<string, unknown>) => Promise<unknown[]>) | null;
  synthesize_results: ((results: unknown[]) => unknown[]) | null;
  extractPageInfo: (() => unknown) | null;
}

export interface CreateContextOptions {
  logger?: Logger;
  services?: Services;
  config?: EngineConfig;
  responses?: Record<string, XhrResponseData>;
}

export function createEngineContext(options: CreateContextOptions = {}): EngineContext {
  const { logger, services = {}, config = {}, responses = {} } = options;

  return {
    Q: createQShim(),
    XHR: createXhrShim(responses, services.xhr),
    dnsLookup: services.dnsResolve ?? (() => Promise.resolve(null)),
    logger: createLoggerShim(logger, config),

    sidecar: null,
    tests: null,
    criteria: null,

    debug_validator: config.debug ?? false,
    show_errors: config.showErrors ?? false,

    analyze: null,
    synthesize_results: null,
    extractPageInfo: null,
  };
}
