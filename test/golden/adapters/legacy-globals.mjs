// The engine as it exists today, loaded the way the legacy loaded it.
//
// This is "oracle A" of docs/engine-modernization-plan.md: not the historical Firefox add-on
// (unrunnable — Add-on SDK, XPCOM, a XPI-reading test harness), but data/lib/*.js at HEAD. That is
// what the extension actually executes in production, so it is the behaviour worth anchoring to.
//
// The counterpart, adapters/modern-esm.mjs, will load dist/index.js instead. Both implement the
// same interface so that record.mjs never knows which engine it is driving.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO } from '../lib/sources.mjs';

/**
 * Load order, from the legacy test-runner.js and frame-script.js.
 *
 * jQuery first, then oqs-utils (which defines $.extractPageInfo), then the parser, the validator
 * — which defines analyze/synthesize_results — and finally the rules themselves.
 */
export const LIB_ORDER = [
  ['jquery', 'data/lib/jquery-1.9.1.min.js'],
  ['oqs-utils', 'data/lib/oqs-utils.js'],
  ['cssParser', 'data/lib/cssParser.js'],
  ['oqs-validator', 'data/lib/oqs-validator.js'],
  ['oqs-tests', 'data/lib/oqs-tests.js'],
];

/**
 * jQuery is an explicit axis, not a fixed part of the engine.
 *
 * data/lib carries 1.9.1, but the extension's build substitutes 3.7.1 + Migrate
 * (opquast-devtools/scripts/sync-assets.mjs, VENDOR_LIBS) — so production has been running the
 * engine against a jQuery this repository has never tested it with, since 2026-07-20, on the
 * strength of an 8-criterion golden. Recording both is step 9 of the plan.
 *
 * Until those files are vendored here, `--jquery <path>` takes an absolute or repo-relative path;
 * the extension's copies live at data/vendor/ in the product repo. CI will need them vendored.
 */
export function resolveJquery(spec) {
  if (!spec || spec === '1.9.1') return [['jquery', 'data/lib/jquery-1.9.1.min.js']];
  if (spec.includes('/')) {
    const migrate = spec.replace(/jquery-([\d.]+)\.min\.js$/, 'jquery-migrate-3.5.2.min.js');
    return migrate !== spec && safeExists(migrate)
      ? [
          ['jquery', spec],
          ['jquery-migrate', migrate],
        ]
      : [['jquery', spec]];
  }
  throw new Error(`--jquery expects "1.9.1" or a path, got: ${spec}`);
}

function safeExists(p) {
  try {
    readFileSync(p.startsWith('/') ? p : join(REPO, p));
    return true;
  } catch {
    return false;
  }
}

function read(rel) {
  return readFileSync(rel.startsWith('/') ? rel : join(REPO, rel), 'utf8');
}

/** `{ name, source }` in load order, plus the digest of each file for env.json. */
export function loadLibs({ jquery } = {}) {
  const order = [...resolveJquery(jquery), ...LIB_ORDER.filter(([n]) => n !== 'jquery')];
  return order.map(([name, rel]) => {
    const source = read(rel);
    return {
      name,
      path: rel,
      source,
      sha256: createHash('sha256').update(source).digest('hex').slice(0, 16),
    };
  });
}

export const id = 'legacy-globals';
