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
 * The run expression: build the engine, hand it the same inputs, normalise the output.
 *
 * `services.xhr` is handed the XHR the harness already installed for the legacy path — captured
 * before createEngine() replaces the global — so the modern engine gets exactly the legacy
 * capability: HAR entries first, a real same-origin request otherwise, absolutised through
 * $.URL() and cached per GET. Reimplementing a lookalike here would make any difference between
 * the two adapters unattributable.
 *
 * `responses` is deliberately NOT passed: the HAR lookup already lives inside that XHR, and
 * passing both would mean two shims answering the same question.
 */
export function modernRun({ resources, pageInfo, plainText, rules, criteria }) {
  return `(async function () {
    const g = globalThis;
    const legacyXhr = g.XHR;
    const engine = OpquastTestRunner.createEngine({
      jQuery: g.jQuery || g.$,
      services: { xhr: (url) => legacyXhr.get(url) },
    });
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
    });
    return JSON.parse(JSON.stringify(results));
  })()`;
}

export const id = 'modern-esm';
