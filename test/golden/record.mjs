#!/usr/bin/env node
// Record a baseline for one tier.
//
//   node test/golden/record.mjs --tier S1                      → scratch run, isolated world
//   node test/golden/record.mjs --tier S2 --out baseline/S2    → the authoritative baseline
//
// Needs a browser: `npm install && npx playwright install chromium`, plus the system libraries
// (`sudo npx playwright install-deps chromium`) — see test/golden/README.md, their absence kills
// Chromium mid-page with a message that names nothing.

import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO } from './lib/sources.mjs';
import { WORLDS } from './lib/page-adapter.mjs';
import { runTier } from './lib/run-tier.mjs';
import { writeBaseline, level1Digest } from './lib/store.mjs';
import { toJsonl } from './lib/normalize.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const TIER = arg('tier', 'S1');
// The baseline is anchored on the world production runs. The extension injects the engine with
// browser.scripting.executeScript and no `world` option, i.e. ISOLATED — so that is what the net
// has to guard. The main world is recorded alongside as a comparison, not as the reference: it
// agrees with the legacy add-on's Cu.Sandbox and therefore reads "more correct", but guarding a
// behaviour nobody ships would make the gate green while production drifts. See DTOOLS-003.
const WORLD = arg('world', 'isolated');
// Default output is a scratch directory, not baseline/: while we are measuring, a run is an
// experiment. The authoritative baseline is written deliberately, with --out baseline/<tier>.
const OUT = join(REPO, 'test/golden', arg('out', `.golden-out/${TIER}-${WORLD}`));

if (!WORLDS.includes(WORLD)) {
  console.error(`--world must be one of ${WORLDS.join(', ')}`);
  process.exit(2);
}

const { records, env, failures, died, requested } = await runTier({
  tier: TIER,
  world: WORLD,
  adapter: arg('adapter', 'legacy'),
  jquery: arg('jquery', undefined),
  rev: arg('engine-rev', undefined),
  limit: Number(arg('limit', '0')) || 0,
  offset: Number(arg('offset', '0')) || 0,
  onProgress: (i, n) => {
    if (i === 0) console.error(`${TIER}/${WORLD}: ${n} cases`);
    if (i % 25 === 0) console.error(`  ${i}/${n}`);
  },
});

if (died) console.error(`\nbrowser died before ${died.key} (${died.at}/${requested})`);

writeBaseline(OUT, records, env);

console.error(`\n${records.length} cases → ${OUT}`);
console.error(`level-1 sha256: ${createHash('sha256').update(level1Digest(records)).digest('hex')}`);

if (failures.length) {
  console.error(`\n${failures.length} case(s) threw:`);
  for (const f of failures.slice(0, 10)) console.error(`  ${f.key}: ${f.error}`);
}

let bytes = 0;
for (const r of records) bytes += Buffer.byteLength(toJsonl([r.level2]));
console.error(
  `level-2 details: ${(bytes / 1024).toFixed(0)} kB for ${records.length} cases ` +
    `(${((bytes / Math.max(records.length, 1) / 1024) * 6145).toFixed(0)} kB extrapolated to the full net)`,
);

process.exit(died ? 1 : 0);
