/**
 * @opquast/test-runner
 *
 * Opquast web quality test engine.
 * Evaluates rules against a DOM and sidecar data (events, resources, pageInfo).
 *
 * @example
 * ```ts
 * import { createEngine } from '@opquast/test-runner';
 *
 * const engine = createEngine({ jQuery, logger, services });
 * const results = await engine.analyze({ document, sidecar, rules, rulesets, criteria });
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Logger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface XhrResponse {
  status: number;
  data: string;
  getHeader(name: string): string | null;
}

export interface Services {
  /** Fetch a URL and return response data. Default: returns empty response. */
  xhr?: (url: string) => Promise<XhrResponse>;
  /** Resolve a hostname to IP. Default: returns null. */
  dnsResolve?: (host: string) => Promise<string | null>;
}

export interface EngineConfig {
  debug?: boolean;
  showErrors?: boolean;
}

export interface Sidecar {
  events: unknown[];
  resources: unknown[];
  pageInfo: Record<string, unknown>;
  plainText?: string;
}

export interface AnalyzeOptions {
  document: Document;
  sidecar: Sidecar;
  rules: Record<string, string>;
  rulesets: Record<string, unknown>;
  criteria: string[];
}

export interface TestResult {
  id: string;
  result: 'c' | 'nc' | 'i' | 'na' | 'nt';
  results_list?: unknown[];
  comment?: string;
  details?: unknown;
  time?: number;
}

export interface CreateEngineOptions {
  /** jQuery instance (required — the engine depends on jQuery 1.9+). */
  jQuery: unknown;
  /** Logger interface. Default: no-op. */
  logger?: Logger;
  /** External services (xhr, dns). Default: inert stubs. */
  services?: Services;
  /** Engine configuration flags. */
  config?: EngineConfig;
}

export interface Engine {
  analyze(options: AnalyzeOptions): Promise<TestResult[]>;
}

// ---------------------------------------------------------------------------
// No-op defaults
// ---------------------------------------------------------------------------

const noopLogger: Logger = {
  log() {},
  warn() {},
  error() {},
};

const noopServices: Required<Services> = {
  xhr: async () => ({ status: 0, data: '', getHeader: () => null }),
  dnsResolve: async () => null,
};

// ---------------------------------------------------------------------------
// Engine factory (M2 will implement the full decoupling)
// ---------------------------------------------------------------------------

/**
 * Create an Opquast test engine instance.
 *
 * The engine is stateless — each `analyze()` call is independent.
 * Dependencies (jQuery, logger, services) are captured at creation time.
 *
 * @example
 * ```ts
 * const engine = createEngine({ jQuery: window.jQuery });
 * const results = await engine.analyze({ document, sidecar, rules, rulesets, criteria });
 * ```
 */
export function createEngine(options: CreateEngineOptions): Engine {
  const { jQuery, logger = noopLogger, services = {}, config = {} } = options;

  if (!jQuery) {
    throw new Error('@opquast/test-runner: jQuery is required');
  }

  const _services: Required<Services> = {
    xhr: services.xhr ?? noopServices.xhr,
    dnsResolve: services.dnsResolve ?? noopServices.dnsResolve,
  };

  return {
    async analyze(_options: AnalyzeOptions): Promise<TestResult[]> {
      // M2 TODO: Implement the full decoupling.
      // For now, this is a placeholder that will be wired to the legacy engine.
      //
      // The implementation will:
      // 1. Set up the module-scoped context (sidecar, logger, services, Q shim)
      // 2. Load the legacy libs (oqs-utils, oqs-validator, oqs-tests)
      // 3. Call window.analyze() or the equivalent entry point
      // 4. Return synthesized results
      //
      // This preserves the "engine + sidecar" abstraction already proven in the extension.
      void jQuery;
      void logger;
      void _services;
      void config;

      throw new Error(
        '@opquast/test-runner: analyze() not yet implemented — see M2 in engine-modernization-plan.md',
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { default as rules } from './rules.js';
export { default as rulesets } from './rulesets.js';
