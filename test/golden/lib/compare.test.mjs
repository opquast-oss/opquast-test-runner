import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, formatReport } from './compare.mjs';

const rec = (over = {}) => ({ k: 'rules/FOO/true/1.html#FOO', r: 'c', rl: ['c'], n: 0, d: 'aaa', x: 'c', in: 'i1', ...over });

test('an identical run is ok and says so', () => {
  const r = compare([rec()], [rec()]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.regressions, []);
  assert.match(formatReport(r), /identical to the baseline/);
});

test('a verdict that moves on unchanged inputs is a regression', () => {
  const r = compare([rec()], [rec({ r: 'nc', rl: ['nc'] })]);
  assert.equal(r.ok, false);
  assert.equal(r.regressions.length, 1);
  assert.equal(r.regressions[0].what, 'verdict');
  assert.match(formatReport(r), /verdict c → nc/);
});

test('a detail count that moves is a regression, named as such', () => {
  const r = compare([rec()], [rec({ n: 2, d: 'bbb' })]);
  assert.equal(r.regressions[0].what, 'detail count');
  assert.match(formatReport(r), /details 0 → 2/);
});

test('details that change at constant count are still a regression', () => {
  // This is exactly what the extension's existing golden cannot see: it keeps only the count.
  const r = compare([rec({ n: 1 })], [rec({ n: 1, d: 'zzz' })]);
  assert.equal(r.ok, false);
  assert.equal(r.regressions[0].what, 'details');
});

test('a moved verdict on CHANGED inputs is not a regression', () => {
  const r = compare([rec()], [rec({ r: 'nc', in: 'i2' })]);
  assert.equal(r.ok, true, 'the gate must not cry regression when the fixture moved');
  assert.equal(r.inputChanged.length, 1);
  assert.equal(r.inputChanged[0].verdictMoved, true);
  assert.match(formatReport(r), /INPUTS changed/);
});

test('a case that vanished fails the gate', () => {
  const r = compare([rec()], []);
  assert.equal(r.ok, false);
  assert.deepEqual(r.removed, ['rules/FOO/true/1.html#FOO']);
  assert.match(formatReport(r), /produced nothing in this run/);
});

test('a new case is reported but does not fail', () => {
  const r = compare([], [rec()]);
  assert.equal(r.ok, true);
  assert.equal(r.added.length, 1);
  assert.match(formatReport(r), /not in the baseline/);
});

test('a changed hand-written expectation is reported separately', () => {
  const r = compare([rec()], [rec({ x: 'nc' })]);
  assert.equal(r.ok, true);
  assert.equal(r.expectationChanged.length, 1);
});

test('environment drift is reported and never fails on its own', () => {
  const r = compare([rec()], [rec()], {
    baselineEnv: { chromium: '150', world: 'isolated' },
    currentEnv: { chromium: '151', world: 'isolated' },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.envDrift, [{ field: 'chromium', from: '150', to: '151' }]);
  assert.match(formatReport(r), /chromium: "150" → "151"/);
});

test('case counts are not treated as environment drift', () => {
  const r = compare([rec()], [rec()], {
    baselineEnv: { cases: 297, failures: 0 },
    currentEnv: { cases: 12, failures: 3 },
  });
  assert.deepEqual(r.envDrift, []);
});

test('the report shows what moved inside the details', () => {
  const r = compare([rec({ n: 1 })], [rec({ n: 1, d: 'zzz' })]);
  const key = 'rules/FOO/true/1.html#FOO';
  const text = formatReport(r, {
    baselineDetails: new Map([[key, { k: key, details: [{ tag: 'p' }] }]]),
    currentDetails: new Map([[key, { k: key, details: [{ tag: 'div' }] }]]),
  });
  assert.match(text, /- \{"tag":"p"\}/);
  assert.match(text, /\+ \{"tag":"div"\}/);
});
