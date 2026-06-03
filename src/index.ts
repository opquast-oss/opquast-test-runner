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
 * // After loading legacy libs (jquery, oqs-utils, cssParser, oqs-validator, oqs-tests)
 * const engine = createEngine({ jQuery: window.jQuery });
 * const results = await engine.analyze({ document, sidecar, rules, rulesets, criteria });
 * ```
 */

import {
  loadEngineFromGlobals,
  prepareAnalysis,
  buildEventsFromDom,
  buildSyntheticResource,
  type LoadedEngine,
} from './loader.js';
import { type CreateContextOptions, type XhrResponseData } from './context.js';

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
  /** DOM document to analyze. */
  document: Document;
  /** Pre-built sidecar data. If not provided, will be built from document. */
  sidecar?: Partial<Sidecar>;
  /** Rules definitions (rules.json). */
  rules: Record<string, string>;
  /** Rulesets definitions (rulesets.json subset). */
  rulesets: Record<string, unknown>;
  /** Criterion IDs to evaluate. Defaults to all keys in rulesets. */
  criteria?: string[];
  /** Event reconstruction mode: 'full' | 'inline' | 'none'. Default: 'inline'. */
  eventsMode?: 'full' | 'inline' | 'none';
  /** Pre-fetched HTTP responses for XHR shim. */
  responses?: Record<string, XhrResponseData>;
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
  /**
   * Analyze a document against the specified rules and criteria.
   *
   * @returns Array of test results with id, result status, and details.
   */
  analyze(options: AnalyzeOptions): Promise<TestResult[]>;

  /**
   * Access to the underlying loaded engine (for advanced use).
   */
  readonly loaded: LoadedEngine;
}

// ---------------------------------------------------------------------------
// Engine factory
// ---------------------------------------------------------------------------

/**
 * Create an Opquast test engine instance.
 *
 * **Prerequisites**: The legacy engine libraries must be loaded before calling this:
 * - jquery-1.9.1.min.js
 * - oqs-utils.js
 * - cssParser.js
 * - oqs-validator.js
 * - oqs-tests.js
 *
 * These define global functions (analyze, synthesize_results, $.extractPageInfo)
 * that this factory wires together with the provided dependencies.
 *
 * @example
 * ```ts
 * // In browser after loading engine scripts:
 * const engine = createEngine({ jQuery: window.jQuery });
 *
 * const results = await engine.analyze({
 *   document: window.document,
 *   rules: rulesJson,
 *   rulesets: rulesetsSubset,
 * });
 * ```
 */
export function createEngine(options: CreateEngineOptions): Engine {
  const { jQuery, logger, services, config } = options;

  if (!jQuery) {
    throw new Error('@opquast/test-runner: jQuery is required');
  }

  // Load engine from globals and wire up context
  const contextOptions: CreateContextOptions = { logger, services, config };
  const loaded = loadEngineFromGlobals(jQuery, contextOptions);

  return {
    loaded,

    async analyze(opts: AnalyzeOptions): Promise<TestResult[]> {
      const {
        document,
        rules,
        rulesets,
        criteria = Object.keys(rulesets),
        eventsMode = 'inline',
        responses = {},
      } = opts;

      // Update XHR shim with provided responses
      if (Object.keys(responses).length > 0) {
        const g = globalThis as Record<string, unknown>;
        const { createXhrShim } = await import('./context.js');
        g.XHR = createXhrShim(responses);
      }

      // Build or merge sidecar
      const $ = jQuery as { extractPageInfo?: () => Record<string, unknown> };
      const pageInfo = $.extractPageInfo?.() ?? {};
      const plainText = new XMLSerializer().serializeToString(document);
      const events = opts.sidecar?.events ?? buildEventsFromDom(document, eventsMode);
      const resources =
        opts.sidecar?.resources && opts.sidecar.resources.length > 0
          ? opts.sidecar.resources
          : [buildSyntheticResource(document, document.location!)];

      const sidecar: Sidecar = {
        events,
        resources,
        pageInfo: opts.sidecar?.pageInfo ?? pageInfo,
        plainText: opts.sidecar?.plainText ?? plainText,
      };

      // Subset rulesets to requested criteria
      const criteriaSet: Record<string, unknown> = {};
      for (const id of criteria) {
        if (id in rulesets) criteriaSet[id] = rulesets[id];
      }

      // Prepare context and run analysis
      prepareAnalysis(loaded.context, sidecar, rules, criteriaSet);

      const rawResults = await loaded.analyze(criteriaSet);
      const synthesized = loaded.synthesize_results(rawResults);

      // Normalize output
      return (synthesized as TestResult[]).map((r) => ({
        id: String(r.id),
        result: r.result,
        results_list: r.results_list,
        comment: r.comment,
        details: r.details,
        time: r.time,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { default as rules } from './rules.js';
export { default as rulesets } from './rulesets.js';
export type { XhrResponseData } from './context.js';

// Utilities for consumers
export { buildEventsFromDom, buildSyntheticResource } from './loader.js';
