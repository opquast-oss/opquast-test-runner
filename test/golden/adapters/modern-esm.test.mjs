import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modernRun } from './modern-esm.mjs';

const args = {
  resources: [{ uri: 'http://fixture/x.html' }],
  pageInfo: { lang: 'fr' },
  plainText: '<html></html>',
  rules: { FOO: 'xpath@html://p' },
  criteria: { FOO: { FOO: { ontrue: { result: 'c' } } } },
};

test('the modern engine is handed the harness XHR, captured before it is replaced', () => {
  // The reason this matters: createEngineContext used to ignore services.xhr entirely, and
  // createXhrShim answers `status: 0, data: ''` for any URL it was not pre-handed. Stylesheets
  // came back blank and 75 CSS verdicts flipped from c to nc.
  const src = modernRun(args);
  assert.match(src, /const legacyXhr = g\.XHR;/);
  assert.match(src, /services: \{ xhr: \(url\) => legacyXhr\.get\(url\) \}/);
  assert.ok(src.indexOf('const legacyXhr') < src.indexOf('createEngine'), 'capture must precede createEngine');
});

test('responses is not passed — one shim answering, not two', () => {
  assert.doesNotMatch(modernRun(args), /responses:/);
});

test('the same sidecar the legacy path builds is passed through', () => {
  const src = modernRun(args);
  assert.match(src, /events: g\.extractEvents\(\)/);
  assert.match(src, /"uri":"http:\/\/fixture\/x\.html"/);
  assert.match(src, /"lang":"fr"/);
  assert.match(src, /plainText: "<html><\/html>"/);
});

test('criteria are named explicitly rather than left to default over the rulesets', () => {
  assert.match(modernRun(args), /criteria: \["FOO"\]/);
});
