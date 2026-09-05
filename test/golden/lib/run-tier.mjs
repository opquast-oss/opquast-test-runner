// Drive one tier through a browser and return its records.
//
// Shared by record.mjs (writes a baseline) and check.mjs (compares against one), so the two can
// never drift apart — a gate that ran the corpus differently from the recorder would compare two
// things that were never the same measurement.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO, selectTier, loadRulesets } from './sources.mjs';
import { startServer } from './serve.mjs';
import { getHarObject, har2res } from './har.mjs';
import { runCase, EVENT_SHIM, legacyRun } from './page-adapter.mjs';
import { normalizeCase, inputHash } from './normalize.mjs';
import * as legacyAdapter from '../adapters/legacy-globals.mjs';
import * as modernAdapter from '../adapters/modern-esm.mjs';

/**
 * The engine under test. Both adapters are handed identical fixtures, HAR and criteria, so the
 * engine is the only thing that differs between two runs of the same tier.
 */
const ADAPTERS = {
  legacy: { mod: legacyAdapter, buildRun: legacyRun },
  modern: { mod: modernAdapter, buildRun: (args) => modernAdapter.modernRun(args) },
};

export async function runTier({
  tier = 'S1',
  world = 'isolated',
  adapter = 'legacy',
  jquery,
  rev,
  limit = 0,
  offset = 0,
  onProgress = () => {},
} = {}) {
  const { chromium } = await import('playwright');

  const chosen = ADAPTERS[adapter];
  if (!chosen) throw new Error(`unknown adapter: ${adapter} (${Object.keys(ADAPTERS).join(', ')})`);
  const libs = chosen.mod.loadLibs({ jquery, rev });
  const rulesRaw = readFileSync(join(REPO, 'data/rules.json'));
  const rules = JSON.parse(rulesRaw.toString('utf8'));
  const rulesSha = createHash('sha256').update(rulesRaw).digest('hex').slice(0, 16);
  let cases = selectTier(tier).slice(offset);
  if (limit) cases = cases.slice(0, limit);

  const server = await startServer();
  // --disable-dev-shm-usage is not optional in a container: Docker gives /dev/shm 64 MB by
  // default, Chromium keeps renderer buffers there, and a few pages in the BROWSER dies — not the
  // page — with "Target page, context or browser has been closed".
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();

  if (!process.env.GOLDEN_NO_EVENT_SHIM) await context.addInitScript(EVENT_SHIM);

  const rulesetCache = new Map();
  const records = [];
  const failures = [];
  let died = null;

  for (const [i, c] of cases.entries()) {
    onProgress(i, cases.length);
    if (browser.isConnected() === false) {
      died = { key: c.key, at: i };
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
      died = { key: c.key, at: i, error: e.message };
      break;
    }

    // Routing is per-page because one of its two jobs is stateful.
    //
    // 1. Cut the network: 257 fixtures reference an external host (w3.org DTDs, googleapis,
    //    macromedia), and letting those through would make the baseline depend on the internet.
    // 2. Block any navigation once the document has loaded. This is the legacy harness's
    //    `accessibility.blockautorefresh`, which it set for exactly the same reason: the
    //    META_REFRESH_WO_DELAY fixtures carry a zero-delay <meta refresh> and reload out from
    //    under the engine. Without it they do not merely fail — the reload loop wedges the run
    //    (observed: 41 minutes of wall clock for 47 seconds of CPU, and orphaned renderers).
    // Count main-frame navigations rather than flag "loaded": a zero-delay <meta refresh> fires
    // DURING goto, before any post-goto flag could be raised. The first navigation is the fixture;
    // every one after it is the page reloading itself.
    let navigations = 0;
    await page.route('**/*', (route) => {
      const req = route.request();
      let host;
      try {
        host = new URL(req.url()).hostname;
      } catch {
        return route.abort();
      }
      if (host !== '127.0.0.1') return route.abort();
      try {
        if (req.isNavigationRequest() && req.frame() === page.mainFrame() && ++navigations > 1) {
          return route.abort();
        }
      } catch {
        /* a request whose frame is already gone: the host check above stands */
      }
      return route.continue();
    });

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
      // The `in` hash covers the INPUTS — never the engine. Hashing the lib digests here would
      // classify every engine edit as "inputs changed", and the gate would never report a single
      // regression: it would be green by construction. The lib digests live in env.json instead,
      // where a change shows up as environment drift that explains a red run.
      const payload = { har, resources, criteria, rules: rulesSha, page: c.page };

      const { results } = await runCase(page, world, {
        libs,
        har,
        resources,
        plainText: source,
        rules,
        criteria,
        buildRun: chosen.buildRun,
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
      await page.close().catch(() => {});
    }
    records.push(record);
  }

  const env = {
    tier,
    world,
    cases: records.length,
    failures: failures.length,
    adapter,
    engineRev: rev ?? null,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    playwright: JSON.parse(readFileSync(join(REPO, 'node_modules/playwright/package.json'), 'utf8'))
      .version,
    chromium: browser.version?.() ?? null,
    libs: Object.fromEntries(libs.map((l) => [l.path, l.sha256])),
    rules: rulesSha,
    egressPolicy: 'block-non-loopback',
    eventModel: process.env.GOLDEN_NO_EVENT_SHIM
      ? 'DISABLED (GOLDEN_NO_EVENT_SHIM)'
      : 'inline on* attributes + DOM0 setter shim (addEventListener out of scope, as legacy)',
  };

  await context.close();
  await browser.close();
  await server.close();

  return { records, env, failures, died, requested: cases.length };
}
