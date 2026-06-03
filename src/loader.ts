/**
 * Engine loader — executes legacy libs in a controlled context.
 *
 * The legacy engine (oqs-utils, cssParser, oqs-validator, oqs-tests) expects
 * various globals (jQuery, Q, XHR, sidecar, logger, etc.). This loader:
 *
 * 1. Creates a sandboxed scope with all required "globals"
 * 2. Executes the legacy code in that scope
 * 3. Extracts the public functions (analyze, synthesize_results)
 *
 * For browser use: the legacy files are loaded as scripts into the page
 * (same approach as the extension). For library use: we bundle them and
 * execute via Function constructor.
 */

import { createEngineContext, type EngineContext, type CreateContextOptions } from './context.js';

// Legacy lib sources will be inlined at build time
// For now, we define the loader interface; actual bundling comes in M3

export interface LoadedEngine {
  context: EngineContext;
  analyze: (criteria: Record<string, unknown>) => Promise<unknown[]>;
  synthesize_results: (results: unknown[]) => unknown[];
}

/**
 * Load the engine in browser context.
 *
 * This assumes jQuery is available and the legacy libs have been loaded
 * as <script> tags (same as extension approach). It then wires up the
 * context and returns the engine functions.
 *
 * @param jQuery - jQuery instance (must be 1.9+)
 * @param options - Context configuration
 */
export function loadEngineFromGlobals(
  jQuery: unknown,
  options: CreateContextOptions = {},
): LoadedEngine {
  const g = globalThis as Record<string, unknown>;

  // Verify jQuery is available
  if (!jQuery || typeof (jQuery as { fn?: unknown }).fn !== 'object') {
    throw new Error('@opquast/test-runner: jQuery 1.9+ is required');
  }

  // Create context and inject into globals
  const context = createEngineContext(options);

  // Set up globals the engine expects
  g.Q = context.Q;
  g.XHR = context.XHR;
  g.dnsLookup = context.dnsLookup;
  g.logger = context.logger;
  g.debug_validator = context.debug_validator;
  g.show_errors = context.show_errors;

  // Extract functions from globals (set by the legacy libs)
  const analyze = g.analyze as LoadedEngine['analyze'] | undefined;
  const synthesize_results = g.synthesize_results as LoadedEngine['synthesize_results'] | undefined;

  if (typeof analyze !== 'function') {
    throw new Error(
      '@opquast/test-runner: analyze() not found. Ensure oqs-validator.js is loaded.',
    );
  }
  if (typeof synthesize_results !== 'function') {
    throw new Error(
      '@opquast/test-runner: synthesize_results() not found. Ensure oqs-validator.js is loaded.',
    );
  }

  // Store references in context
  context.analyze = analyze;
  context.synthesize_results = synthesize_results;

  // extractPageInfo is added to jQuery by oqs-utils
  const $: Record<string, unknown> = jQuery as Record<string, unknown>;
  if (typeof $.extractPageInfo === 'function') {
    context.extractPageInfo = $.extractPageInfo as () => unknown;
  }

  return {
    context,
    analyze,
    synthesize_results,
  };
}

/**
 * Prepare the context for an analysis run.
 *
 * Sets sidecar, tests, criteria on both the context and globals.
 */
export function prepareAnalysis(
  context: EngineContext,
  sidecar: EngineContext['sidecar'],
  tests: Record<string, string>,
  criteria: Record<string, unknown>,
): void {
  const g = globalThis as Record<string, unknown>;

  // Update context
  context.sidecar = sidecar;
  context.tests = tests;
  context.criteria = criteria;

  // Update globals (legacy code reads from these)
  g.sidecar = sidecar;
  g.tests = tests;
  g.criteria = criteria;
}

/**
 * Build sidecar.events from DOM (same logic as run-in-page.ts).
 */
export function buildEventsFromDom(
  document: Document,
  mode: 'full' | 'inline' | 'none' = 'inline',
): unknown[] {
  if (mode === 'none') return [];

  const byNode = new Map<Element, Set<string>>();
  const add = (el: Element, type: string) => {
    let set = byNode.get(el);
    if (!set) byNode.set(el, (set = new Set()));
    set.add(type);
  };

  // 'full' mode: read data-oqs-ev attributes (from MAIN-world shim)
  if (mode === 'full') {
    document.querySelectorAll('[data-oqs-ev]').forEach((el) => {
      for (const t of (el.getAttribute('data-oqs-ev') || '').split(',')) {
        if (t) add(el, t);
      }
      el.removeAttribute('data-oqs-ev');
    });
  }

  // Both modes: read inline on* handlers
  document.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const match = /^on(\w+)$/i.exec(attr.name);
      if (match) add(el, match[1]!.toLowerCase());
    }
  });

  return [...byNode.entries()].map(([node, types]) => ({
    node,
    events: [...types].map((type) => ({ type })),
  }));
}

/**
 * Build a synthetic resource entry for the main document.
 */
export function buildSyntheticResource(document: Document, location: Location): unknown {
  const plainText = new XMLSerializer().serializeToString(document);
  return {
    date: document.lastModified,
    modified: document.lastModified,
    expires: null,
    content_type: document.contentType,
    charset: document.characterSet,
    size: plainText.length,
    headers: {},
    uri: location.href,
    referrer: '',
    method: 'GET',
    status: 200,
    status_text: '200 OK',
  };
}
