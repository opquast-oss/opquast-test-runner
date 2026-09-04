// Static file server for the golden-master harness.
//
// A port of the legacy `startServer` / `setRoot` handler (test/legacy-xpcom/tools.js), which was
// built on Mozilla's httpd.js. Same MIME table, same `<path>.headers` sidecar, same 404 on the
// root, same raw-bytes response.
//
// Why a real server rather than page.setContent():
//   - fixtures reference relative neighbours (style.css, script.js) and 150 of them use <iframe>;
//   - 28 fixtures carry a .headers file whose whole point is the Content-Type charset, which no
//     setContent() call can express;
//   - rules read document.location, and $.URL() absolutises against it.
//
// The page's own directory is the server ROOT, exactly as the legacy did. That is what makes
// neighbours and frames resolve without any path rewriting.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** The legacy MIME table, verbatim. Anything not listed falls back to plain text. */
export const MIME_TYPES = {
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  pdf: 'application/pdf',
  rss: 'application/rss+xml',
  atom: 'application/atom+xml',
};

const DEFAULT_MIME = 'text/plain; charset=UTF-8';

function notFound(res) {
  res.writeHead(404, { 'Content-Type': DEFAULT_MIME });
  res.end('NOT FOUND');
}

/**
 * Start a server whose root can be re-pointed between cases.
 *
 * Returns `{ origin, setRoot, close }`. One server is reused for the whole run: binding a fresh
 * port per case would be thousands of sockets, and the origin is part of the recorded details
 * (normalised away later), so keeping it stable keeps diffs readable.
 */
export async function startServer({ host = '127.0.0.1', port = 0 } = {}) {
  let root = null;

  const server = createServer((req, res) => {
    if (root === null) return notFound(res);

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return notFound(res);
    }

    // The legacy 404s when the resolved URI equals the root, i.e. a request for "/". Fixtures are
    // always addressed by file name, so this is not a directory index.
    const rel = pathname.replace(/^\/+/, '');
    if (rel === '') return notFound(res);

    // Not in the legacy (httpd.js was fed jar: URIs, not a filesystem root), but a traversal here
    // would silently serve a file outside the fixture and poison a baseline.
    const file = resolve(root, rel);
    if (file !== resolve(root) && !file.startsWith(resolve(root) + sep)) return notFound(res);

    let body;
    try {
      body = readFileSync(file);
    } catch {
      return notFound(res);
    }

    const ext = file.split('.').slice(-1).join('');
    const headers = { 'Content-Type': MIME_TYPES[ext] ?? DEFAULT_MIME };

    // "<path>.headers", JSON. It may override Content-Type — that is how the iso-8859-1 fixtures
    // declare their charset, and setHeader replaced in the legacy too.
    try {
      const extra = JSON.parse(readFileSync(`${file}.headers`, 'utf8'));
      for (const [k, v] of Object.entries(extra)) headers[k] = v;
    } catch {
      /* no sidecar, or unreadable — the legacy swallowed this too */
    }

    res.writeHead(200, headers);
    // Raw bytes, never re-encoded: a fixture served as iso-8859-1 must arrive as the bytes on
    // disk, or its charset rules test the harness rather than the page.
    res.end(body);
  });

  await new Promise((ok, ko) => {
    server.once('error', ko);
    server.listen(port, host, ok);
  });

  const { port: bound } = server.address();
  return {
    origin: `http://${host}:${bound}`,
    url: (name) => `http://${host}:${bound}/${name}`,
    setRoot: (dir) => {
      root = dir;
    },
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/** Convenience for one-off use: serve `dir` and return the server. */
export async function serveDir(dir, opts) {
  const s = await startServer(opts);
  s.setRoot(join(dir));
  return s;
}
