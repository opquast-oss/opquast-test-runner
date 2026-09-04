// The HAR port is a transcription of the legacy harness, so these tests are mostly
// regression-locks on behaviour that is easy to "improve" by accident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHarEntry, getHarObject, har2res, EPOCH } from './har.mjs';

const WIN = {
  url: 'http://127.0.0.1:9010/index.html',
  contentType: 'text/html',
  characterSet: 'UTF-8',
  referrer: '',
};
const SOURCE = '<!doctype html><html><body>x</body></html>';

test('bare page: one entry carrying the raw source', () => {
  const har = getHarObject(WIN, SOURCE, null);
  assert.equal(har.entries.length, 1);
  const e = har.entries[0];
  assert.equal(e._url, WIN.url);
  assert.equal(e._path, '/index.html');
  assert.equal(e.response.content.text, SOURCE);
  assert.equal(e.response.content.size, SOURCE.length);
  assert.equal(e.response.bodySize, SOURCE.length);
  assert.equal(e.startedDateTime, EPOCH, 'the instant must be frozen or baselines cannot repeat');
  assert.equal(e._id, 0);
});

test('_all.json "*" is rewritten onto the page and does not create an entry', () => {
  const har = getHarObject(WIN, SOURCE, {
    all: { '*': { status: 404, statusText: 'NOT FOUND' } },
    page: null,
  });
  assert.equal(har.entries.length, 1);
  assert.equal(har.entries[0].response.status, 404);
  assert.equal(har.entries[0].response.statusText, 'NOT FOUND');
});

test('a relative override key becomes an extra entry, resolved against the page', () => {
  const har = getHarObject(WIN, SOURCE, {
    all: { '/anime.gif': { _imageInfo: { animated: true } } },
    page: null,
  });
  assert.equal(har.entries.length, 2);
  assert.equal(har.entries[1]._url, 'http://127.0.0.1:9010/anime.gif');
  assert.deepEqual(har.entries[1].response._imageInfo, { animated: true });
  assert.equal(har.entries[1]._id, 1);
  assert.equal(har.entries[1].response.content.text, '', 'fabricated: nothing is read from disk');
});

test('<page>.json keyed on the page path overrides the page response', () => {
  const har = getHarObject(WIN, SOURCE, {
    all: null,
    page: { '/index.html': { headers: [{ name: 'refresh', value: '3600' }] } },
  });
  assert.equal(har.entries.length, 1);
  assert.deepEqual(har.entries[0].response.headers, [{ name: 'refresh', value: '3600' }]);
});

test('<page>.json "*" stays a relative key — the legacy anomaly, reproduced', () => {
  // sets/503/4-503_3.json and sets/21516/13-1-1-21516_3.json both do this, meaning to set a
  // refresh header on the page. The legacy only rewrites "*" for _all.json, so the key is
  // resolved as a URL instead and the page keeps its own headers. Locked in deliberately: the
  // baseline records what the engine did, not what the fixture author intended.
  const har = getHarObject(WIN, SOURCE, {
    all: null,
    page: { '*': { headers: [{ name: 'refresh', value: '3600' }] } },
  });
  assert.equal(har.entries.length, 2);
  assert.equal(har.entries[0].response.headers.length, 0, 'the page is NOT overridden');
  assert.equal(har.entries[1]._url, 'http://127.0.0.1:9010/*');
});

test('_all.json and <page>.json merge with the page file winning', () => {
  const har = getHarObject(WIN, SOURCE, {
    all: { '/a.js': { status: 500 } },
    page: { '/a.js': { status: 503 }, '/b.js': { status: 404 } },
  });
  const byUrl = Object.fromEntries(har.entries.map((e) => [e._url, e.response.status]));
  assert.equal(byUrl['http://127.0.0.1:9010/a.js'], 503);
  assert.equal(byUrl['http://127.0.0.1:9010/b.js'], 404);
});

test('har2res lower-cases header names and joins repeats with a comma', () => {
  const e = fakeHarEntry(WIN);
  e.response.headers = [
    { name: 'Content-Type', value: 'text/html' },
    { name: 'Set-Cookie', value: 'a=1' },
    { name: 'set-cookie', value: 'b=2' },
  ];
  const [res] = har2res({ entries: [e] });
  assert.equal(res.headers['content-type'], 'text/html');
  assert.equal(res.headers['set-cookie'], 'a=1,b=2');
});

test('har2res drops leading redirects and duplicate URLs', () => {
  const redirect = fakeHarEntry(WIN, 'http://127.0.0.1:9010/old.html');
  redirect.response.status = 301;
  const page = fakeHarEntry(WIN);
  const dupe = fakeHarEntry(WIN);
  const res = har2res({ entries: [redirect, page, dupe] });
  assert.equal(res.length, 1);
  assert.equal(res[0].uri, WIN.url);
});

test('har2res reads dates from headers, null when absent or unparseable', () => {
  const e = fakeHarEntry(WIN);
  e.response.headers = [
    { name: 'Date', value: 'Wed, 21 Oct 2015 07:28:00 GMT' },
    { name: 'Expires', value: 'not a date' },
  ];
  const [res] = har2res({ entries: [e] });
  assert.equal(res.date, 'Wed, 21 Oct 2015 07:28:00 GMT');
  assert.equal(res.expires, null);
  assert.equal(res.modified, null);
});

test('har2res timings are derived from the frozen instant, so they are stable', () => {
  const [res] = har2res({ entries: [fakeHarEntry(WIN)] });
  assert.equal(res.start_time, 0);
  assert.equal(res.stop_time, 0);
  assert.equal(res.transfer_time, 0);
});
