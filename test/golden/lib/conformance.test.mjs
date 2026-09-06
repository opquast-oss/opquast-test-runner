import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, agrees, review, blame } from './conformance.mjs';

test('a rules expectation is a single verdict', () => {
  assert.equal(agrees({ k: 'a#A', r: 'c', x: 'c' }), true);
  assert.equal(agrees({ k: 'a#A', r: 'nc', x: 'c' }), false);
});

test('a sets expectation constrains only the keys it states', () => {
  // Legacy semantics: test-sets.js used Object.keys(x_results).every(...), so a meta that omits a
  // key says nothing about it. Comparing all four would invent failures.
  const rec = { k: 'a#1', rl: ['c', 'na'], x: { C: 1 } };
  assert.equal(agrees(rec), true);
  assert.equal(agrees({ ...rec, x: { C: 1, NA: 1 } }), true);
  assert.equal(agrees({ ...rec, x: { C: 1, NA: 0 } }), false);
});

test('a case with no expectation is not counted either way', () => {
  assert.equal(agrees({ k: 'a#A', r: 'c', x: null }), null);
  const r = review([{ k: 'a#A', r: 'c', x: null }]);
  assert.equal(r.checked, 0);
});

test('an ERROR never agrees, whatever was expected', () => {
  assert.equal(agrees({ k: 'a#A', r: 'ERROR', x: 'c' }), false);
});

test('tally counts a results_list into the X-results shape', () => {
  assert.deepEqual(tally(['c', 'na', 'na', 'i']), { C: 1, NC: 0, NA: 2, I: 1 });
  assert.deepEqual(tally(null), { C: 0, NC: 0, NA: 0, I: 0 });
});

test('the register is a floor: known disagreements pass, new ones do not', () => {
  const bad = { k: 'a#A', r: 'nc', x: 'c' };
  assert.equal(review([bad], {}).ok, false, 'an unregistered disagreement must fail');
  assert.equal(review([bad], { 'a#A': { category: 'browser' } }).ok, true);
});

test('a registered case that now agrees is reported as resolved', () => {
  const r = review([{ k: 'a#A', r: 'c', x: 'c' }], { 'a#A': { category: 'browser' } });
  assert.deepEqual(r.resolved, ['a#A']);
  assert.equal(r.ok, true);
});

test('blame names the chained rule that gave up, not the whole criterion', () => {
  const rulesets = { 1: { ALPHA: {}, BETA: {}, GAMMA: {} } };
  assert.deepEqual(blame({ k: 'sets/1/p.html#1', rl: ['c', 'i', 'c'], x: { C: 3 } }, rulesets), ['BETA']);
});
