#!/usr/bin/env node
// Record a baseline for one tier.
//
//   node test/golden/record.mjs --tier S1 --world main     --out baseline/S1-main
//   node test/golden/record.mjs --tier S1 --world isolated --out baseline/S1-isolated
//
// Needs a browser: `npm install -D playwright && npx playwright install chromium`. It cannot run
// in the opq-devcontainer, whose node_modules is a macOS install on a shared bind mount.
//
// The output is sorted JSONL, so two runs can simply be diffed. That is the pilot's only exit
// criterion: two consecutive runs identical, byte for byte. Until that holds, nothing else in the
// plan is worth building.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO, selectTier, loadRulesets } from './lib/sources.mjs';
import { startServer } from './lib/serve.mjs';
import { getHarObject, har2res } from './lib/har.mjs';
import { runCase, EVENT_SHIM, WORLDS } from './lib/page-adapter.mjs';
import { normalizeCase, inputHash, toJsonl, shardOf } from './lib/normalize.mjs';
import { loadLibs } from './adapters/legacy-globals.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const TIER = arg('tier', 'S1');
const WORLD = arg('world', 'main');
const JQUERY = arg('jquery', undefined);
const LIMIT = Number(arg('limit', '0')) || 0;
const OFFSET = Number(arg('offset', '0')) || 0;
// Default output is a scratch directory, not baseline/: while we are measuring, a run is an
// experiment. The authoritative baseline is written deliberately, with --out baseline/<tier>.
const OUT = join(REPO, 'test/golden', arg('out', `.golden-out/${TIER}-${WORLD}`));

if (!WORLDS.includes(WORLD)) {
  console.error(`--world must be one of ${WORLDS.join(', ')}`);
  process.exit(2);
}

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright is not installed here. See the header of this file.');
  process.exit(2);
});

const libs = loadLibs({ jquery: JQUERY });
const rules = JSON.parse(readFileSync(join(REPO, 'data/rules.json'), 'utf8'));
let cases = selectTier(TIER).slice(OFFSET);
if (LIMIT) cases = cases.slice(0, LIMIT);

console.error(`${TIER}/${WORLD}: ${cases.length} cases, jQuery ${libs[0].path}`);

const server = await startServer();
// --disable-dev-shm-usage is not optional in a container: Docker gives /dev/shm 64 MB by default,
// Chromium puts its renderer buffers there, and a few pages in the BROWSER dies — not the page —
// with "Target page, context or browser has been closed". The flag moves those buffers to /tmp.
// Harmless elsewhere, so it stays unconditional rather than becoming a thing to remember about one
// machine.
const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext();

// Cut the network. 257 fixtures reference an external host (w3.org DTDs, googleapis, macromedia);
// letting them through would make the baseline depend on the internet. Recorded in env.json so the
// choice is visible rather than assumed.
await context.route('**/*', (route) => {
  let host;
  try {
    host = new URL(route.request().url()).hostname;
  } catch {
    return route.abort();
  }
  return host === '127.0.0.1' ? route.continue() : route.abort();
});
// GOLDEN_NO_EVENT_SHIM=1 skips the DOM0 handler instrumentation. It rewrites ~100 accessors on
// the element prototypes, which makes it the first thing to rule out when the browser dies rather
// than the page. Without it, sidecar.events only sees inline on* attributes.
if (!process.env.GOLDEN_NO_EVENT_SHIM) await context.addInitScript(EVENT_SHIM);
else console.error('  (event shim disabled)');

const rulesetCache = new Map();
const records = [];
const failures = [];

for (const [i, c] of cases.entries()) {
  if (i % 25 === 0) console.error(`  ${i}/${cases.length}`);
  if (browser.isConnected() === false) {
    console.error(`\nbrowser died before ${c.key} (${i}/${cases.length})`);
    break;
  }
  const dir = join(REPO, c.dir);
  server.setRoot(dir);

  if (!rulesetCache.has(c.rulesets)) rulesetCache.set(c.rulesets, loadRulesets(c.rulesets));
  const defs = rulesetCache.get(c.rulesets);
  const criteria = Object.fromEntries(c.criteria.map((id) => [id, defs[id]]));

  // Raw bytes: the legacy fed the file's source straight into content.text, which becomes
  // sidecar.plainText. Serialising the DOM instead — what the extension's harnesses do — changes
  // the verdict of the two rules that read it.
  const source = readFileSync(join(dir, c.page), 'latin1');

  let page;
  try {
    page = await context.newPage();
  } catch (e) {
    console.error(`\nbrowser died opening ${c.key} (${i}/${cases.length}): ${e.message}`);
    break;
  }
  let record;
  try {
    await page.goto(server.url(c.page), { waitUntil: 'domcontentloaded', timeout: 30000 });
    const windowInfo = await page.evaluate(() => ({
      url: location.href,
      contentType: document.contentType,
      characterSet: document.characterSet,
      referrer: document.referrer,
    }));

    const har = getHarObject(windowInfo, source, c.overrides);
    const resources = har2res(har);
    const payload = { libs: libs.map((l) => l.sha256), har, resources, criteria, page: c.page };

    const { results } = await runCase(page, WORLD, {
      libs,
      har,
      resources,
      plainText: source,
      rules,
      criteria,
    });

    record = normalizeCase({
      key: c.key,
      results,
      expectation: c.expectation,
      inputHash: inputHash(payload, server.origin),
      origin: server.origin,
    });
  } catch (e) {
    // A thrown case is data, not a crash: it is recorded as such so the diff shows it moving.
    failures.push({ key: c.key, error: String(e.message || e).slice(0, 300) });
    record = normalizeCase({
      key: c.key,
      results: [{ result: 'ERROR', results_list: null, details: [String(e.message || e)] }],
      expectation: c.expectation,
      inputHash: 'error',
      origin: server.origin,
    });
  } finally {
    await page.close();
  }
  records.push(record);
}

await context.close();
await browser.close();
await server.close();

// ---- write -----------------------------------------------------------------

const shards = new Map();
const detailShards = new Map();
for (const r of records) {
  const s = shardOf(r.level1.k);
  if (!shards.has(s)) shards.set(s, []);
  if (!detailShards.has(s)) detailShards.set(s, []);
  shards.get(s).push(r.level1);
  detailShards.get(s).push(r.level2);
}

mkdirSync(join(OUT, 'details'), { recursive: true });
for (const [s, rows] of [...shards].sort()) writeFileSync(join(OUT, `${s}.jsonl`), toJsonl(rows));
for (const [s, rows] of [...detailShards].sort())
  writeFileSync(join(OUT, 'details', `${s}.jsonl`), toJsonl(rows));

const env = {
  tier: TIER,
  world: WORLD,
  cases: records.length,
  failures: failures.length,
  adapter: 'legacy-globals',
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  playwright: JSON.parse(readFileSync(join(REPO, 'node_modules/playwright/package.json'), 'utf8'))
    .version,
  chromium: browser.version?.() ?? null,
  libs: Object.fromEntries(libs.map((l) => [l.path, l.sha256])),
  rules: createHash('sha256')
    .update(readFileSync(join(REPO, 'data/rules.json')))
    .digest('hex')
    .slice(0, 16),
  egressPolicy: 'block-non-loopback',
  eventModel: 'inline on* attributes + DOM0 setter shim (addEventListener out of scope, as legacy)',
};
writeFileSync(join(OUT, 'env.json'), JSON.stringify(env, null, 2) + '\n');

const level1Sha = createHash('sha256')
  .update([...shards].sort().map(([s, rows]) => s + toJsonl(rows)).join(''))
  .digest('hex');

console.error(`\n${records.length} cases → ${OUT}`);
console.error(`level-1 sha256: ${level1Sha}`);
if (failures.length) {
  console.error(`\n${failures.length} case(s) threw:`);
  for (const f of failures.slice(0, 10)) console.error(`  ${f.key}: ${f.error}`);
}

// Size of the level-2 tier, the open question of the plan's step 4b.
let bytes = 0;
for (const [s, rows] of detailShards) bytes += Buffer.byteLength(toJsonl(rows));
console.error(
  `level-2 details: ${(bytes / 1024).toFixed(0)} kB for ${records.length} cases ` +
    `(${((bytes / records.length / 1024) * 6145).toFixed(0)} kB extrapolated to the full net)`,
);
