// The engine as M3 will ship it: @opquast/test-runner's createEngine().
//
// Same fixtures, same HAR, same criteria as adapters/legacy-globals.mjs — the engine is the only
// thing that differs. That is the whole point: today src/loader.ts still reads analyze() off
// globalThis, so both adapters execute literally the same code and the two runs must match
// exactly. The value of this adapter is prospective: it is the tripwire for the moment M3 actually
// moves the libs into a module scope, when "must match exactly" stops being trivially true.
//
// It loads the IIFE build (dist/opquast-test-runner.global.js) rather than the ESM entry, so the
// engine is evaluated as a page script exactly like the legacy libs are. Importing a module graph
// instead would add a second variable — module resolution, CORS, a second server — to a comparison
// whose whole worth is having only one.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO } from '../lib/sources.mjs';
import { loadLibs as loadLegacyLibs } from './legacy-globals.mjs';

const BUNDLE = 'dist/opquast-test-runner.global.js';

/**
 * The legacy libs, plus the built engine.
 *
 * createEngine() does not replace the legacy libs — it wires them: loadEngineFromGlobals() reads
 * analyze/synthesize_results straight off the global object. So they are still loaded first, in
 * the same order, and the bundle goes last.
 */
export function loadLibs({ jquery } = {}) {
  const path = join(REPO, BUNDLE);
  if (!existsSync(path)) {
    throw new Error(
      `${BUNDLE} not found — run \`npm run build\` first (tsup needs a native esbuild binary, so ` +
        'this builds on the host or in CI, not in the dev container).',
    );
  }
  const source = readFileSync(path, 'utf8');
  return [
    ...loadLegacyLibs({ jquery }),
    {
      name: 'modern-bundle',
      path: BUNDLE,
      source,
      sha256: createHash('sha256').update(source).digest('hex').slice(0, 16),
    },
  ];
}

/**
 * Translate the fabricated HAR into the `responses` map createEngine expects.
 *
 * Necessary, not decorative: loadEngineFromGlobals() **overwrites** `globalThis.XHR` with its own
 * shim, which is inert by default. Without this the HAR-backed XHR installed for the legacy path
 * would be silently discarded and every rule that reads an HTTP resource would see status 0.
 *
 * `content_type` is left null to match the legacy `entryToResponse`, which also returned null and
 * let the engine read the type through getHeader(). Compensating for that here would be
 * pre-emptively hiding a difference the golden exists to reveal.
 */
export function responsesFromHar(har) {
  const out = {};
  for (const entry of har.entries || []) {
    out[entry._url] = {
      status: entry.response.status,
      statusText: entry.response.statusText,
      headers: entry.response.headers || [],
      content_type: null,
      data: entry.response.content?.text ?? '',
    };
  }
  return out;
}

/** The run expression: build the engine, hand it the same sidecar, normalise the output. */
export function modernRun({ har, resources, pageInfo, plainText, rules, criteria }) {
  return `(async function () {
    const g = globalThis;
    const engine = OpquastTestRunner.createEngine({ jQuery: g.jQuery || g.$ });
    const results = await engine.analyze({
      document: g.document,
      sidecar: {
        events: g.extractEvents(),
        resources: ${JSON.stringify(resources)},
        pageInfo: ${JSON.stringify(pageInfo)},
        plainText: ${JSON.stringify(plainText)},
      },
      rules: ${JSON.stringify(rules)},
      rulesets: ${JSON.stringify(criteria)},
      criteria: ${JSON.stringify(Object.keys(criteria))},
      responses: ${JSON.stringify(responsesFromHar(har))},
    });
    return JSON.parse(JSON.stringify(results));
  })()`;
}

export const id = 'modern-esm';
