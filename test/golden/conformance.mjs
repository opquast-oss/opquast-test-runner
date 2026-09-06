#!/usr/bin/env node
// Compare the committed baselines against the fixtures' hand-written expectations.
//
//   node test/golden/conformance.mjs            # every tier that has a baseline
//   node test/golden/conformance.mjs --tier S2
//
// Informative, never blocking on the disagreements themselves — only on NEW ones, so the register
// can shrink but not silently grow.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib/sources.mjs';
import { readBaseline } from './lib/store.mjs';
import { review, byCriterion, tally, blame, KNOWN_CAUSES } from './lib/conformance.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};

const TIERS = arg('tier', null) ? [arg('tier', null)] : ['S1', 'S2', 'S3'];
const REGISTER_PATH = join(REPO, 'test/golden/conformance.json');
const register = existsSync(REGISTER_PATH)
  ? JSON.parse(readFileSync(REGISTER_PATH, 'utf8')).cases ?? {}
  : {};

const records = [];
const seen = new Set();
for (const tier of TIERS) {
  const b = readBaseline(join(REPO, 'test/golden/baseline', tier));
  if (!b) continue;
  // S1 is a subset of S2; counting a case twice would inflate every number here.
  for (const r of b.level1) if (!seen.has(r.k)) (seen.add(r.k), records.push(r));
}

if (!records.length) {
  console.error('no baseline to review');
  process.exit(2);
}

const result = review(records, register);
const pct = ((result.agreeing / result.checked) * 100).toFixed(1);

console.log(`${result.checked} cases carry an expectation`);
console.log(`  agree     ${String(result.agreeing).padStart(5)}   ${pct}%`);
console.log(`  disagree  ${String(result.disagreeing.length).padStart(5)}   of which ${result.fresh.length} not in the register`);
if (result.resolved.length) {
  console.log(`  resolved  ${String(result.resolved.length).padStart(5)}   in the register but now agreeing — remove them`);
}

if (process.argv.includes('--list')) {
  console.log('\nby criterion, most disagreements first:');
  for (const [id, rows] of byCriterion(result.disagreeing).slice(0, 40)) {
    console.log(`  ${String(rows.length).padStart(4)}  ${id}`);
    for (const r of rows.slice(0, 2)) {
      const got = typeof r.x === 'string' ? r.r : JSON.stringify(tally(r.rl));
      console.log(`        ${r.k}\n          expected ${JSON.stringify(r.x)}  got ${got}`);
    }
  }
}

if (process.argv.includes('--write')) {
  const rulesets = JSON.parse(readFileSync(join(REPO, 'data/rulesets.json'), 'utf8'));
  const synthetic = JSON.parse(readFileSync(join(REPO, 'test/rulesets.json'), 'utf8'));
  const all = { ...synthetic, ...rulesets };
  const cases = {};
  for (const r of result.disagreeing) {
    if (register[r.k]) {
      cases[r.k] = register[r.k];
      continue;
    }
    const culprits = blame(r, all);
    const known = culprits.map((c) => KNOWN_CAUSES[c]).find(Boolean);
    cases[r.k] = {
      category: known?.category ?? 'unclassified',
      blame: culprits,
      note: known?.note ?? '',
    };
  }
  writeFileSync(
    REGISTER_PATH,
    JSON.stringify(
      {
        _why:
          'Cases where the engine contradicts the fixture author. Reviewed by hand, never generated ' +
          'blind: the expectations predate the port and nothing shows the suite was ever green, so a ' +
          'disagreement may be an engine bug OR a fixture that was always wrong. Categories: browser ' +
          '(Firefox → Chromium), events (nsIEventListenerService is not reproducible), network ' +
          '(needs a real domain or DNS), fixture (the expectation is wrong), engine (a real defect), ' +
          'unclassified (not yet looked at). The count is a floor: it may shrink, never silently grow.',
        cases,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nregister written: ${Object.keys(cases).length} entries`);
}

process.exit(result.ok ? 0 : 1);
