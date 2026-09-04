#!/usr/bin/env node
// The blocking gate: run a tier and compare it to its committed baseline.
//
//   node test/golden/check.mjs --tier S1                    → compares to baseline/S1
//   node test/golden/check.mjs --tier S1 --baseline .golden-out/run1
//
// Exit 0 when nothing regressed, 1 when something did, 2 when it could not run at all.
//
// The gate has NO opinion on whether a verdict is correct. It says only that the engine started
// answering something else. Correctness against the fixtures' hand-written expectations is a
// separate, non-blocking pass — mixing the two would make the gate argue about the referential
// every time it turned red.

import { join } from 'node:path';
import { REPO } from './lib/sources.mjs';
import { WORLDS } from './lib/page-adapter.mjs';
import { runTier } from './lib/run-tier.mjs';
import { readBaseline, splitRun } from './lib/store.mjs';
import { compare, formatReport } from './lib/compare.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const TIER = arg('tier', 'S1');
const WORLD = arg('world', 'isolated');
const BASE = join(REPO, 'test/golden', arg('baseline', `baseline/${TIER}`));

if (!WORLDS.includes(WORLD)) {
  console.error(`--world must be one of ${WORLDS.join(', ')}`);
  process.exit(2);
}

const baseline = readBaseline(BASE);
if (!baseline) {
  console.error(`no baseline at ${BASE}`);
  console.error(`Record one first:  node test/golden/record.mjs --tier ${TIER} --out baseline/${TIER}`);
  process.exit(2);
}

const { records, env, failures, died, requested } = await runTier({
  tier: TIER,
  world: WORLD,
  adapter: arg('adapter', 'legacy'),
  jquery: arg('jquery', undefined),
  limit: Number(arg('limit', '0')) || 0,
  offset: Number(arg('offset', '0')) || 0,
  onProgress: (i, n) => {
    if (i === 0) console.error(`${TIER}/${WORLD}: ${n} cases against ${arg('baseline', `baseline/${TIER}`)}`);
    if (i % 25 === 0) console.error(`  ${i}/${n}`);
  },
});

if (died) {
  // A dead browser is not a green run with fewer cases. Say so and fail.
  console.error(`\nbrowser died before ${died.key} (${died.at}/${requested}) — the run is incomplete`);
  process.exit(2);
}

const run = splitRun(records);
const result = compare(baseline.level1, run.level1, {
  baselineEnv: baseline.env,
  currentEnv: env,
});

console.error('');
console.log(
  formatReport(result, { baselineDetails: baseline.details, currentDetails: run.details }),
);

if (failures.length) {
  console.log(`\n${failures.length} case(s) threw during this run:`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f.key}: ${f.error}`);
}

if (!result.ok) {
  console.log(
    '\nIf this change is intended, regenerate the baseline and commit the diff:\n' +
      `  node test/golden/record.mjs --tier ${TIER} --out baseline/${TIER}`,
  );
}

process.exit(result.ok ? 0 : 1);
