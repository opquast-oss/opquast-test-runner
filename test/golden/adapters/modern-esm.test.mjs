import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responsesFromHar } from './modern-esm.mjs';
import { getHarObject } from '../lib/har.mjs';

const WIN = {
  url: 'http://127.0.0.1:9010/index.html',
  contentType: 'text/html',
  characterSet: 'UTF-8',
  referrer: '',
};

test('every HAR entry becomes a response the modern shim can serve', () => {
  const har = getHarObject(WIN, '<html></html>', {
    all: { '/anime.gif': { status: 404, statusText: 'NOT FOUND' } },
    page: null,
  });
  const r = responsesFromHar(har);
  assert.deepEqual(Object.keys(r).sort(), [
    'http://127.0.0.1:9010/anime.gif',
    'http://127.0.0.1:9010/index.html',
  ]);
  assert.equal(r['http://127.0.0.1:9010/index.html'].data, '<html></html>');
  assert.equal(r['http://127.0.0.1:9010/anime.gif'].status, 404);
});

test('content_type stays null, as the legacy entryToResponse returned it', () => {
  // Filling it in here would hide a difference the golden exists to reveal: the legacy path left
  // it null and let the engine read the type through getHeader().
  const har = getHarObject(WIN, '<html></html>', null);
  assert.equal(responsesFromHar(har)['http://127.0.0.1:9010/index.html'].content_type, null);
});

test('headers survive as the array getHeader() expects', () => {
  const har = getHarObject(WIN, '<html></html>', {
    all: null,
    page: { '/index.html': { headers: [{ name: 'Content-Type', value: 'text/html' }] } },
  });
  const r = responsesFromHar(har)['http://127.0.0.1:9010/index.html'];
  assert.deepEqual(r.headers, [{ name: 'Content-Type', value: 'text/html' }]);
});

test('an entry with no body yields an empty string, not undefined', () => {
  const har = getHarObject(WIN, '<html></html>', {
    all: { '/missing.js': { status: 404 } },
    page: null,
  });
  assert.equal(responsesFromHar(har)['http://127.0.0.1:9010/missing.js'].data, '');
});
