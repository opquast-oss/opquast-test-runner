import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './serve.mjs';
import { REPO } from './sources.mjs';

let server;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'golden-serve-'));
  writeFileSync(join(dir, 'page.html'), '<!doctype html><p>hi</p>');
  writeFileSync(join(dir, 'style.css'), 'p{color:red}');
  // Byte 0xE9 is "é" in iso-8859-1 and invalid on its own in utf-8: if the server re-encodes
  // anything, this file comes back different.
  writeFileSync(join(dir, 'latin.html'), Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]));
  writeFileSync(join(dir, 'latin.html.headers'), JSON.stringify({ 'Content-Type': 'text/html; charset=iso-8859-1' }));
  server = await startServer();
  server.setRoot(dir);
});

after(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('serves a file with the legacy MIME table', async () => {
  const r = await fetch(server.url('page.html'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(await r.text(), '<!doctype html><p>hi</p>');

  const css = await fetch(server.url('style.css'));
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
});

test('.headers overrides Content-Type and the bytes are untouched', async () => {
  const r = await fetch(server.url('latin.html'));
  assert.equal(r.headers.get('content-type'), 'text/html; charset=iso-8859-1');
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...bytes], [0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]);
});

test('404 on the root and on a missing file, like the legacy handler', async () => {
  assert.equal((await fetch(server.origin + '/')).status, 404);
  assert.equal((await fetch(server.url('nope.html'))).status, 404);
});

test('unknown extensions fall back to plain text', async () => {
  writeFileSync(join(dir, 'thing.xyz'), 'data');
  const r = await fetch(server.url('thing.xyz'));
  assert.equal(r.headers.get('content-type'), 'text/plain; charset=UTF-8');
});

test('traversal outside the root is refused', async () => {
  // Not a legacy behaviour — httpd.js was fed jar: URIs. Added because escaping the fixture
  // directory would silently serve a foreign file into a baseline.
  const r = await fetch(`${server.origin}/${encodeURIComponent('../')}etc/passwd`);
  assert.equal(r.status, 404);
});

test('a real fixture directory serves its page and its neighbours', async () => {
  server.setRoot(join(REPO, 'test/fixtures/rules/ABBR_W_FILLED_TITLE_ATTR/true'));
  const page = await fetch(server.url('1.html'));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<abbr title="bla">/);
  // style.css and script.js are empty on purpose — they exist so the page's <link>/<script> do
  // not 404, which is a difference the engine can see.
  assert.equal((await fetch(server.url('style.css'))).status, 200);
  assert.equal((await fetch(server.url('script.js'))).status, 200);
  server.setRoot(dir);
});
