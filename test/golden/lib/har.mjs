// HAR construction for the golden-master harness.
//
// A direct port of the legacy add-on's `fakeHarEntry` / `getHarObject` (test/legacy-xpcom/tools.js)
// and `har2res` (utils/har-tools.jsm, removed in M0 — recoverable with
// `git show 438f133a:utils/har-tools.jsm`). Those two functions are the executable specification
// of what the engine receives besides the DOM, so this is a transcription, not a redesign.
//
// The key thing to understand: the HAR is FABRICATED, never observed. The 367 override files under
// test/fixtures describe HTTP responses for resources that do not exist on disk — a 404 status, a
// gzip content-encoding, an animated-GIF flag. They feed `sidecar.resources` and the lookup table
// of `XHR.query`, and they never reach the network. That is what makes the corpus hermetic.

/**
 * Frozen instant for every synthetic entry.
 *
 * The legacy used `new Date().toISOString()`. Keeping that would make the baseline irreproducible
 * for a reason that has nothing to do with the engine — har2res derives start_time / stop_time
 * from it, and those land in the resources the rules read.
 */
export const EPOCH = '2000-01-01T00:00:00.000Z';

/** One synthetic HAR entry. Shape reproduced field for field from the legacy `fakeHarEntry`. */
export function fakeHarEntry(windowInfo, url) {
  let mimeType = '';
  let charset = '';

  if (url === undefined) {
    url = windowInfo.url;
    mimeType = windowInfo.contentType;
    charset = windowInfo.characterSet;
  }

  const parsed = new URL(url);
  return {
    _url: url,
    _path: parsed.pathname + parsed.search,
    pageref: url,
    startedDateTime: EPOCH,
    time: 0,
    request: {
      method: 'GET',
      url,
      httpVersion: 'HTTP/1.1',
      cookied: [], // sic — the legacy typo, kept: the shape is what the engine was written against
      headers: [],
      queryString: [],
      postData: {},
      headerSize: -1,
      bodySize: -1,
    },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      content: { size: 0, compression: undefined, mimeType, text: '' },
      redirectURL: '',
      headersSize: -1,
      bodySize: 0,
      _contentType: mimeType,
      _contentCharset: charset,
      _referrer: windowInfo.referrer,
      _imageInfo: undefined,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  };
}

/**
 * Build the HAR for one fixture page.
 *
 * `source` is the RAW page bytes as a latin1 string — the legacy read it with `readBinaryURI` and
 * put it straight into `content.text`, which then becomes `sidecar.plainText`. Two rules
 * (HTML_W_CR, HTML_W_REDUDANT_SPACES) read that text, so serialising the DOM instead — which is
 * what the extension's harnesses do today — gives them a different verdict.
 *
 * `overrides` keeps `_all.json` and `<page>.json` apart on purpose. The legacy rewrites the `"*"`
 * key onto the page's own path for `_all.json` ONLY. Two fixtures put `"*"` in a `<page>.json`
 * instead (sets/503/4-503_3.json, sets/21516/13-1-1-21516_3.json, both meaning to set a `refresh`
 * header on the page); under the legacy rules that key is resolved as a relative URL and becomes a
 * bogus extra entry, so those two fixtures never tested what they meant to. Reproduced as-is: the
 * baseline records what the engine did, and the anomaly belongs in the conformance registry, not
 * in a silent fix here.
 */
export function getHarObject(windowInfo, source, overrides) {
  const entries = [fakeHarEntry(windowInfo)];
  entries[0].response.content.text = source;
  entries[0].response.content.size = source.length;
  entries[0].response.bodySize = source.length;

  let all = overrides?.all ? { ...overrides.all } : undefined;
  let one = overrides?.page ? { ...overrides.page } : undefined;

  if (all && all['*']) {
    all[entries[0]._path] = all['*'];
    delete all['*'];
  }
  if (all) one = one ? { ...all, ...one } : all;

  if (one && typeof one === 'object') {
    for (const k of Object.keys(one)) {
      if (k === entries[0]._path) {
        entries[0].response = { ...entries[0].response, ...one[k] };
        continue;
      }
      const entry = fakeHarEntry(windowInfo, new URL(k, entries[0]._url).toString());
      entry.response = { ...entry.response, ...one[k] };
      entries.push(entry);
    }
  }

  entries.forEach((v, i) => {
    v._id = i;
  });
  return { entries };
}

function getDate(headers, name) {
  if (headers[name] === undefined) return null;
  return isNaN(Date.parse(headers[name])) ? null : headers[name];
}

/**
 * HAR entries → the legacy `resources` array the engine reads as `sidecar.resources`.
 *
 * Port of har-tools.jsm. Three behaviours are load-bearing and easy to lose: leading redirects are
 * dropped, duplicate URLs are dropped (first wins), and header names are lower-cased with repeats
 * joined by a comma.
 */
export function har2res(har) {
  const out = [];
  let startTime = null;
  const seenURLs = [];

  for (const entry of har.entries) {
    if (startTime === null) startTime = Date.parse(entry.startedDateTime);

    // Drop leading redirections
    if (seenURLs.length === 0 && Math.trunc(entry.response.status / 100) === 3) continue;
    // Drop duplicates
    if (seenURLs.indexOf(entry._url) !== -1) continue;
    seenURLs.push(entry._url);

    const rStart = Date.parse(entry.startedDateTime) - startTime;
    const rTrans = entry.timings.wait + entry.timings.receive;

    const headers = {};
    for (const h of entry.response.headers) {
      const name = String(h.name).toLowerCase();
      headers[name] = name in headers ? `${headers[name]},${h.value}` : h.value;
    }

    const res = {
      uri: entry._url,
      referrer: entry.response._referrer,
      method: entry.request.method,
      status: entry.response.status,
      status_text: entry.response.statusText,
      date: getDate(headers, 'date'),
      modified: getDate(headers, 'last-modified'),
      expires: getDate(headers, 'expires'),
      content_type: entry.response._contentType,
      charset: entry.response._contentCharset,
      size: entry.response.content.size,
      headers,
      start_time: rStart,
      stop_time: rStart + rTrans,
      transfer_time: rTrans,
    };

    // `!== null` and not `!== undefined`: fakeHarEntry leaves _imageInfo undefined, so the legacy
    // always assigned the key. Kept — the engine reads the property either way, and diverging here
    // would be an unforced difference.
    if (entry.response._imageInfo !== null) res.image_info = entry.response._imageInfo;

    out.push(res);
  }
  return out;
}
