// In-page execution contract for the golden-master harness.
//
// Transcribed from the legacy frame-script (`git show 438f133a:frame-script.js`), which is the
// authoritative description of what the engine is handed. Order matters and is not obvious:
//
//   1. jQuery
//   2. globals: Q, dnsLookup, extractEvents, XHR (HAR-backed, absolutising, GET-cached)
//   3. oqs-utils.js
//   4. pageInfo = $.extractPageInfo()          ← BEFORE the validator and the tests
//   5. cssParser.js, oqs-validator.js, oqs-tests.js
//   6. sidecar = { resources, events, pageInfo, plainText }
//   7. analyze(criteria).then(synthesize_results)
//
// Everything is evaluated through CDP Runtime.evaluate, in both worlds, so that the execution
// world is the ONLY difference between the two modes. Using page.evaluate for one and CDP for the
// other would add a second variable and make the comparison meaningless.

/**
 * The world the engine runs in.
 *
 *   'main'      the page's own global. What the extension's existing harnesses do today.
 *   'isolated'  a real isolated world sharing the DOM (CDP Page.createIsolatedWorld). This is the
 *               model production actually uses — a content script — and the closest equivalent to
 *               the legacy Cu.Sandbox({ sandboxPrototype: window }).
 *
 * They are expected to agree. Whether they do is a measurement, not an assumption: if they differ,
 * every verdict the extension's harnesses ever produced was taken in the wrong world.
 */
export const WORLDS = ['main', 'isolated'];

/**
 * Marks DOM0 handlers so the engine can see them.
 *
 * The legacy used nsIEventListenerService.getListenerInfoFor() filtered by
 * `node['on' + type] !== null`, i.e. inline on* attributes AND script assignments
 * (el.onclick = fn) — but not addEventListener. There is no Blink equivalent, so this init script
 * instruments the onXxx setters in the MAIN world before any page script runs, and records what it
 * sees on the element itself. The DOM is shared, so the isolated world reads the same marks.
 *
 * addEventListener-only handlers stay out of scope, exactly as they were for the legacy.
 */
export const EVENT_SHIM = `(() => {
  const ATTR = 'data-oqs-ev';
  // The accessor must be replaced ON THE PROTOTYPE THAT OWNS IT. In Blink the on* handlers come
  // from the GlobalEventHandlers mixin, installed on HTMLElement.prototype — not on
  // Element.prototype. Reading the descriptor from HTMLElement.prototype but defining on
  // Element.prototype (the first version of this shim) leaves HTMLElement.prototype's own accessor
  // in front of it in the chain, so the wrapper never fires for a single HTML element: a shim that
  // looks installed and records nothing.
  const owners = [Element.prototype, HTMLElement.prototype, window.SVGElement && SVGElement.prototype].filter(Boolean);
  const names = Object.getOwnPropertyNames(window).filter((n) => /^on[a-z]+$/.test(n));
  for (const name of names) {
    const type = name.slice(2);
    for (const owner of owners) {
      const desc = Object.getOwnPropertyDescriptor(owner, name);
      if (!desc || !desc.set) continue;
      Object.defineProperty(owner, name, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(v) {
          try {
            if (v !== null && v !== undefined) {
              const seen = (this.getAttribute(ATTR) || '').split(',').filter(Boolean);
              if (!seen.includes(type)) this.setAttribute(ATTR, seen.concat(type).join(','));
            }
          } catch {}
          return desc.set.call(this, v);
        },
      });
    }
  }
})();`;

/**
 * Rebuild `sidecar.events` in the page: inline on* attributes plus whatever the shim marked.
 * Returns the legacy shape, `[{ node: Element, events: [{ type }] }]`, in DOM order.
 */
const EVENTS_SOURCE = `(function () {
  const ATTR = 'data-oqs-ev';
  const out = [];
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT, null, false);
  let node = walker.currentNode;
  do {
    if (!node || node.nodeType !== 1) continue;
    const types = new Set();
    for (const a of node.attributes || []) {
      if (/^on[a-z]+$/i.test(a.name)) types.add(a.name.slice(2).toLowerCase());
    }
    const marked = node.getAttribute && node.getAttribute(ATTR);
    if (marked) for (const t of marked.split(',')) if (t) types.add(t);
    if (types.size) out.push({ node, events: [...types].map((type) => ({ type })) });
  } while ((node = walker.nextNode()));
  // The mark is ours, not the page's: leave no trace for the rules to trip over.
  for (const el of document.querySelectorAll('[' + ATTR + ']')) el.removeAttribute(ATTR);
  return out;
})()`;

/** Open a CDP session and, for 'isolated', create the world. Call after every navigation. */
export async function openWorld(page, world) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (world === 'main') return { cdp, contextId: undefined };

  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: 'opq-golden',
    grantUniveralAccess: true,
  });
  return { cdp, contextId: executionContextId };
}

/** Evaluate a source in the target world. Declarations become that world's globals. */
async function evaluate(session, expression, { awaitPromise = false } = {}) {
  const { result, exceptionDetails } = await session.cdp.send('Runtime.evaluate', {
    expression,
    contextId: session.contextId,
    awaitPromise,
    returnByValue: true,
    // The legacy sandbox had system privileges; the engine reads cross-frame in a few rules.
    includeCommandLineAPI: false,
  });
  if (exceptionDetails) {
    const e = exceptionDetails.exception || {};
    throw new Error(`in-page: ${e.description || e.value || exceptionDetails.text}`);
  }
  return result?.value;
}

/**
 * Install the globals the engine reads but never declares.
 *
 * The XHR shim is the delicate one. Two layers in the legacy, both reproduced:
 *   - inner: a GET whose URL matches a HAR entry resolves from that entry, provided the entry has
 *     a body (or `partial` was asked). `content_type` is null on this path — the engine gets the
 *     type from getHeader(), which is case-insensitive and joins repeats with a comma.
 *   - outer: absolutises through $.URL() and caches GET promises per URL.
 * Anything not in the HAR falls through to a real XMLHttpRequest, as it did under httpd.js. With
 * egress blocked, that means same-origin fixtures answer and everything else fails — which is
 * recorded in env.json rather than hidden.
 */
function globalsSource(har) {
  return `(function () {
  const g = globalThis;
  const har = ${JSON.stringify(har)};

  g.Q = {
    defer() {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
    resolve: (v) => Promise.resolve(v),
    reject: (e) => Promise.reject(e),
    promised: (Ctor) => (...args) =>
      Promise.all(args).then((values) => new Ctor(...values)),
  };

  if (typeof g.console.exception !== 'function') g.console.exception = g.console.error.bind(g.console);

  // Firefox-only in the legacy (nsIDNSService). One rule reads it; it no-ops cleanly on null.
  g.dnsLookup = () => Promise.resolve(null);

  g.extractEvents = () => ${EVENTS_SOURCE};

  const entryToResponse = (entry, partial) => {
    const r = {
      status: entry.response.status,
      statusText: entry.response.statusText,
      headers: entry.response.headers,
      content_type: null,
      data: partial ? '' : entry.response.content.text,
      xml: null,
    };
    r.getHeader = function (name) {
      const v = [];
      this.headers.forEach((h) => {
        if (String(h.name).toLowerCase() === String(name).toLowerCase()) v.push(h.value);
      });
      return v.length === 0 ? null : v.join(',');
    };
    return r;
  };

  const live = {
    query(url, method, data, headers, partial) {
      return new Promise((resolve) => {
        const xr = new XMLHttpRequest();
        const done = () => {
          const raw = (xr.getAllResponseHeaders() || '').trim().split(/\\r?\\n/).filter(Boolean);
          const r = {
            status: xr.status,
            statusText: xr.statusText,
            headers: raw.map((line) => {
              const i = line.indexOf(':');
              return { name: line.slice(0, i), value: line.slice(i + 1).trim() };
            }),
            content_type: null,
            data: xr.responseText,
            xml: null,
          };
          r.getHeader = function (name) {
            const v = [];
            this.headers.forEach((h) => {
              if (String(h.name).toLowerCase() === String(name).toLowerCase()) v.push(h.value);
            });
            return v.length === 0 ? null : v.join(',');
          };
          const ct = r.getHeader('content-type');
          if (ct) r.content_type = ct.split(';')[0];
          resolve(r);
        };
        try {
          xr.open(method || 'GET', url, true);
          xr.onreadystatechange = function () {
            if (partial && xr.readyState === 2) { xr.abort(); done(); return; }
            if (xr.readyState === 4) done();
          };
          xr.onerror = () => resolve({
            status: 0, statusText: '', headers: [], content_type: null, data: '', xml: null,
            getHeader: () => null,
          });
          xr.send(data || null);
        } catch (e) {
          resolve({
            status: 0, statusText: '', headers: [], content_type: null, data: '', xml: null,
            getHeader: () => null,
          });
        }
      });
    },
  };

  const harBacked = Object.create(live);
  harBacked.query = function (url, method, data, headers, partial) {
    if ((method === undefined || method === 'GET') && har.entries !== undefined) {
      let entry = null;
      har.entries.forEach((v) => { if (v._url == url) entry = v; });
      if (entry && (entry.response.content.text || partial)) {
        return Promise.resolve(entryToResponse(entry, partial));
      }
    }
    return live.query.call(this, url, method, data, headers, partial);
  };

  g.XHR = Object.create(harBacked);
  g.XHR.cache = {};
  g.XHR.query = function (url, method, data, headers, partial) {
    url = $.URL(url);
    if (this.cache[url] !== undefined) return this.cache[url];
    const p = harBacked.query.call(this, url, method, data, headers, partial);
    if (method === undefined || method === 'GET') this.cache[url] = p;
    return p;
  };
  g.XHR.get = function (url, partial) { return this.query(url, 'GET', null, {}, partial); };
})();`;
}

/**
 * Run one case. `libs` is the ordered list of `{ name, source }` for the engine under test.
 *
 * The page must already be navigated; the isolated world is per-document, so `openWorld` has to
 * come after the navigation.
 */
export async function runCase(
  page,
  world,
  { libs, har, resources, plainText, rules, criteria, buildRun = legacyRun },
) {
  const session = await openWorld(page, world);

  // Evaluate whatever the adapter supplied, IN ITS ORDER. An earlier version walked a hard-coded
  // list of names, which silently skipped any lib an adapter added — the modern bundle loaded as
  // far as the harness was concerned and then failed with "OpquastTestRunner is not defined".
  const isJquery = (l) => l.name === 'jquery' || l.name === 'jquery-migrate';
  for (const lib of libs.filter(isJquery)) await evaluate(session, lib.source);

  // The globals go between jQuery and the rest: the XHR shim absolutises through $.URL().
  await evaluate(session, globalsSource(har));

  let pageInfo = {};
  for (const lib of libs.filter((l) => !isJquery(l))) {
    await evaluate(session, lib.source);
    // Captured right after oqs-utils defines it, before the validator and the tests load — the
    // legacy order, which is not incidental.
    if (lib.name === 'oqs-utils') {
      pageInfo = await evaluate(session, 'JSON.parse(JSON.stringify($.extractPageInfo()))');
    }
  }

  const results = await evaluate(
    session,
    buildRun({ har, resources, pageInfo, plainText, rules, criteria }),
    { awaitPromise: true },
  );
  await session.cdp.detach().catch(() => {});
  return { results, pageInfo };
}

/**
 * The legacy run: set the globals the engine reads, then analyze.
 *
 * This is the frame-script's `run` step, verbatim in effect — the sidecar assembled from the HAR,
 * the rules and criteria placed as globals, and analyze() piped into synthesize_results().
 */
export function legacyRun({ resources, pageInfo, plainText, rules, criteria }) {
  return `(function () {
    const g = globalThis;
    g.sidecar = {
      resources: ${JSON.stringify(resources)},
      events: g.extractEvents(),
      pageInfo: ${JSON.stringify(pageInfo)},
      plainText: ${JSON.stringify(plainText)},
    };
    g.tests = ${JSON.stringify(rules)};
    g.criteria = ${JSON.stringify(criteria)};
    return analyze(g.criteria)
      .then((r) => synthesize_results(r))
      .then((r) => JSON.parse(JSON.stringify(r)));
  })()`;
}
