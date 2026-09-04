// Corpus sources for the golden-master harness.
//
// A source enumerates *cases*. A case is one fixture page evaluated against one criterion — the
// grain the legacy XPCOM suite used (test-rules.js and test-sets.js each loaded a page and
// evaluated a single criterion), and the grain the baseline is keyed on.
//
// This module is pure Node: no browser, no engine, no network. It can therefore run in the dev
// container, where Playwright cannot.
//
// Two fixture conventions, inherited from the add-on era:
//
//   rules family   fixtures/<fam>/<RULE_ID>/{true,false}/<page>.html
//                  The expected verdict is carried by the PATH: true → "c", false → "nc".
//                  The criterion is synthetic: one rule per criterion (test/rulesets.json).
//
//   sets family    fixtures/<fam>/<CRITERION_ID>/<page>.html
//                  The expected verdict is carried by the PAGE, as
//                  <meta http-equiv="X-results" content="C:0,NC:1,NA:0,I:0">, i.e. the tally of
//                  the four outcomes. Legacy semantics: only the keys present in the meta are
//                  compared (test-sets.js used Object.keys(x_results).every(...)).
//
// Neither convention is a recording of the engine. Both are expectations written by hand, years
// ago, never proven green. They are kept as a second, independent signal (see conformance.mjs);
// the baseline itself is what the engine actually does.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '../../..');
const FIXTURES = join(REPO, 'test/fixtures');

/**
 * The corpus registry.
 *
 * `rulesets` names where each family's criterion definitions come from — they are NOT
 * interchangeable, and getting this wrong silently evaluates the wrong thing:
 *
 *   test/rulesets.json        949 synthetic one-rule criteria, keyed by rule id. The only thing
 *                             that can drive the `rules` families.
 *   data/rulesets.json        1372 real criteria, with chaining. Drives the `sets` families.
 *   test/rulesets-stock.json  642 criteria retired from the active checklists.
 *   synthetic                 built on the fly from test/rules-stock.json (23 retired rules that
 *                             have fixtures but no criterion file of their own).
 *
 * `tier` is the roll-out stage of docs/engine-modernization-plan.md: S2/S3 are the blocking net,
 * S4 is recorded but never blocking.
 */
export const CORPORA = {
  rules: { family: 'rules', rulesets: 'test/rulesets.json', tier: 'S2' },
  sets: { family: 'sets', rulesets: 'data/rulesets.json', tier: 'S3' },
  'rules-debug': { family: 'rules', rulesets: 'test/rulesets.json', tier: 'S4' },
  'rules-stock': { family: 'rules', rulesets: 'synthetic:test/rules-stock.json', tier: 'S4' },
  'sets-debug': { family: 'sets', rulesets: 'data/rulesets.json', tier: 'S4' },
  'sets-stock': { family: 'sets', rulesets: 'test/rulesets-stock.json', tier: 'S4' },
  // Fixtures whose verdict depends on context the local harness cannot produce (real domain, DNS,
  // DTD validation). The pages are fine and worth recording; their hand-written expectation is
  // unreachable, so it is dropped rather than counted as a disagreement.
  'rules-impossible': {
    family: 'rules',
    rulesets: 'test/rulesets.json',
    tier: 'S4',
    dropExpectation: true,
  },
  'sets-impossible': {
    family: 'sets',
    rulesets: 'data/rulesets.json',
    tier: 'S4',
    dropExpectation: true,
  },
};

/**
 * `zombies` is deliberately absent from CORPORA.
 *
 * Its 23 directories are criteria that were removed from the referential (that is what
 * test/legacy-xpcom/scripts/zombies.py moved there). Measured: 0 of the 23 exist in
 * data/rulesets.json, and 0 in test/rulesets-stock.json — their definitions survive nowhere. A
 * criterion with no definition cannot be evaluated, so these 115 pages are not "peripheral", they
 * are unrunnable. They stay on disk as history.
 */
export const EXCLUDED = {
  zombies: 'criterion definitions removed from every ruleset file — nothing to evaluate',
};

const X_RESULTS = /<meta\s+http-equiv=["']X-results["']\s+content=["']([^"']+)["']/i;

/** Parse `C:0,NC:1,NA:0,I:0` into `{ C: 0, NC: 1, NA: 0, I: 0 }`, keeping only the stated keys. */
function parseXResults(html) {
  const m = X_RESULTS.exec(html);
  if (!m) return null;
  const out = {};
  for (const pair of m[1].split(',')) {
    const [k, v] = pair.split(':');
    if (k && v !== undefined) out[k.trim().toUpperCase()] = Number(v.trim());
  }
  return Object.keys(out).length ? out : null;
}

/** Non-empty regular files in `dir`, sorted. Empty fixtures are content that was never committed. */
function filesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => {
      const st = statSync(join(dir, n));
      return st.isFile() && st.size > 0;
    })
    .sort();
}

function dirsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory())
    .sort();
}

/**
 * HAR overrides for one page: `_all.json` applies to every page of the directory, `<page>.json`
 * to that page only. These are NOT expected verdicts — they are fabricated HTTP responses for
 * resources that do not exist on disk (a 404 status, a gzip encoding, an animated GIF flag).
 * har.mjs turns them into HAR entries; they never reach the network.
 */
function overridesFor(dir, page) {
  const read = (name) => {
    const p = join(dir, name);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  };
  const all = read('_all.json');
  const pageJson = read(`${basename(page, '.html')}.json`);
  // Kept apart, not merged: the legacy rewrites the "*" key onto the page's own path for
  // _all.json only. Merging here would silently change the meaning of the two fixtures that put
  // "*" in a <page>.json. See har.mjs::getHarObject.
  return all || pageJson ? { all, page: pageJson } : null;
}

/** Response headers the local server must replay verbatim — this is where the charset lives. */
function headersFor(dir, page) {
  const p = join(dir, `${page}.headers`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/**
 * Enumerate one corpus.
 *
 * `dir` is the directory the local server will serve as its ROOT — the page's own folder, so that
 * relative neighbours (style.css, script.js) and the 150 fixtures using <iframe> resolve exactly
 * as they did under the legacy httpd.
 */
export function enumerate(name) {
  const spec = CORPORA[name];
  if (!spec) throw new Error(`unknown corpus: ${name}`);
  const root = join(FIXTURES, name);
  const cases = [];

  for (const id of dirsIn(root)) {
    const branches = spec.family === 'rules' ? ['true', 'false'] : [null];
    for (const branch of branches) {
      const dir = branch ? join(root, id, branch) : join(root, id);
      for (const page of filesIn(dir).filter((f) => f.endsWith('.html'))) {
        let expectation = null;
        if (!spec.dropExpectation) {
          if (spec.family === 'rules') {
            expectation = { kind: 'path', value: branch === 'true' ? 'c' : 'nc' };
          } else {
            // latin1: the meta is ASCII, and some fixtures are iso-8859-1. Decoding as utf8 would
            // throw away bytes we have not yet decided how to interpret.
            const value = parseXResults(readFileSync(join(dir, page), 'latin1'));
            if (value) expectation = { kind: 'xresults', value };
          }
        }
        cases.push({
          corpus: name,
          key: `${name}/${id}/${branch ? `${branch}/` : ''}${page}#${id}`,
          dir: dir.slice(REPO.length + 1),
          page,
          criteria: [id],
          rulesets: spec.rulesets,
          overrides: overridesFor(dir, page),
          headers: headersFor(dir, page),
          expectation,
        });
      }
    }
  }
  return cases;
}

/** Every runnable case, in a stable order. */
export function enumerateAll() {
  return Object.keys(CORPORA).flatMap(enumerate);
}

/**
 * Load the criterion definitions a corpus is evaluated against.
 *
 * `synthetic:<rules file>` builds the one-rule-per-criterion shape of test/rulesets.json on the
 * fly, for the retired rules that have fixtures but no criterion file.
 */
export function loadRulesets(spec) {
  if (spec.startsWith('synthetic:')) {
    const rules = JSON.parse(readFileSync(join(REPO, spec.slice('synthetic:'.length)), 'utf8'));
    return Object.fromEntries(
      Object.keys(rules).map((id) => [
        id,
        { [id]: { ontrue: { result: 'c' }, onfalse: { result: 'nc' } } },
      ]),
    );
  }
  return JSON.parse(readFileSync(join(REPO, spec), 'utf8'));
}

/**
 * Every case must name a criterion its ruleset file actually defines. An orphan is silent
 * otherwise: the engine would be handed an empty criterion set and report nothing, which reads as
 * "no regression" rather than "not tested".
 */
export function findOrphans(cases) {
  const cache = new Map();
  const orphans = [];
  for (const c of cases) {
    if (!cache.has(c.rulesets)) cache.set(c.rulesets, loadRulesets(c.rulesets));
    const defs = cache.get(c.rulesets);
    for (const id of c.criteria) if (!(id in defs)) orphans.push({ key: c.key, id, in: c.rulesets });
  }
  return orphans;
}

/**
 * Canonical serialisation of the whole corpus. Deterministic: the enumeration walks sorted
 * directory listings, so the same tree always yields the same bytes — which is what makes the
 * digest below meaningful.
 */
export function manifest() {
  return JSON.stringify({
    generatedBy: 'test/golden/lib/sources.mjs',
    excluded: EXCLUDED,
    cases: enumerateAll(),
  });
}

/**
 * The digest is what gets committed, not the manifest.
 *
 * Measured: the full manifest is 4.08 MB, in a repository whose entire packed history is 5.00 MiB.
 * It is fully derivable from the fixtures in under a second, so versioning it would double the
 * repo to re-state what the tree already says. The digest keeps the property that actually
 * matters — any drift in the corpus shows up as a reviewable diff — for about a kilobyte.
 */
export function digest() {
  const perCorpus = {};
  for (const name of Object.keys(CORPORA)) {
    const cases = enumerate(name);
    perCorpus[name] = {
      tier: CORPORA[name].tier,
      criteria: new Set(cases.map((c) => c.criteria[0])).size,
      cases: cases.length,
      withExpectation: cases.filter((c) => c.expectation).length,
      withOverrides: cases.filter((c) => c.overrides).length,
      withHeaders: cases.filter((c) => c.headers).length,
    };
  }
  return {
    generatedBy: 'test/golden/lib/sources.mjs --digest',
    excluded: EXCLUDED,
    total: Object.values(perCorpus).reduce((n, c) => n + c.cases, 0),
    sha256: createHash('sha256').update(manifest()).digest('hex'),
    corpora: perCorpus,
  };
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = {};
  for (const name of Object.keys(CORPORA)) all[name] = enumerate(name);

  if (process.argv.includes('--manifest')) {
    process.stdout.write(manifest() + '\n');
  } else if (process.argv.includes('--digest')) {
    process.stdout.write(JSON.stringify(digest(), null, 2) + '\n');
  } else if (process.argv.includes('--verify')) {
    const committed = JSON.parse(readFileSync(join(HERE, '../corpus/digest.json'), 'utf8'));
    const current = digest();
    if (committed.sha256 === current.sha256) {
      console.log(`corpus unchanged — ${current.total} cases, sha256 ${current.sha256.slice(0, 12)}`);
    } else {
      console.error('corpus drift: the fixtures no longer match the committed digest.');
      console.error(`  committed  ${committed.total} cases  ${committed.sha256}`);
      console.error(`  current    ${current.total} cases  ${current.sha256}`);
      console.error('Review the change, then refresh with --digest > test/golden/corpus/digest.json');
      process.exit(1);
    }
  } else {
    let total = 0;
    console.log('corpus              tier   dirs   cases   expect   overrides   headers');
    for (const [name, cases] of Object.entries(all)) {
      const dirs = new Set(cases.map((c) => c.criteria[0])).size;
      total += cases.length;
      console.log(
        [
          name.padEnd(19),
          CORPORA[name].tier.padEnd(6),
          String(dirs).padStart(4),
          String(cases.length).padStart(7),
          String(cases.filter((c) => c.expectation).length).padStart(8),
          String(cases.filter((c) => c.overrides).length).padStart(11),
          String(cases.filter((c) => c.headers).length).padStart(9),
        ].join(' '),
      );
    }
    console.log(`${''.padEnd(19)} ${''.padEnd(6)} ${''.padStart(4)} ${String(total).padStart(7)}`);
    for (const [name, why] of Object.entries(EXCLUDED)) console.log(`\nexcluded: ${name} — ${why}`);

    const orphans = findOrphans(Object.values(all).flat());
    if (orphans.length) {
      console.error(`\n${orphans.length} orphaned case(s) — criterion absent from its ruleset file:`);
      for (const o of orphans.slice(0, 20)) console.error(`  ${o.key} → ${o.id} not in ${o.in}`);
      process.exit(1);
    }
    console.log('\norphans: none — every case names a criterion its ruleset file defines');
  }
}
