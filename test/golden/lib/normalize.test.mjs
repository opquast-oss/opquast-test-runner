import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCase, inputHash, toJsonl, shardOf, fingerprint } from './normalize.mjs';

const ORIGIN = 'http://127.0.0.1:41234';

test('a verdict becomes one compact record', () => {
  const { level1 } = normalizeCase({
    key: 'rules/FOO/true/1.html#FOO',
    results: [{ result: 'c', results_list: ['c'], details: [{ tag: 'p', xpath: '/html/body/p' }] }],
    expectation: { kind: 'path', value: 'c' },
    inputHash: 'abcd',
    origin: ORIGIN,
  });
  assert.equal(level1.k, 'rules/FOO/true/1.html#FOO');
  assert.equal(level1.r, 'c');
  assert.deepEqual(level1.rl, ['c']);
  assert.equal(level1.n, 1);
  assert.equal(level1.x, 'c');
  assert.equal(level1.in, 'abcd');
  assert.match(level1.d, /^[0-9a-f]{16}$/);
});

test('the volatile `time` field never reaches the record', () => {
  const a = normalizeCase({
    key: 'k#1',
    results: [{ result: 'c', details: [{ tag: 'p', time: 12 }] }],
    inputHash: 'x',
    origin: ORIGIN,
  });
  const b = normalizeCase({
    key: 'k#1',
    results: [{ result: 'c', details: [{ tag: 'p', time: 9999 }] }],
    inputHash: 'x',
    origin: ORIGIN,
  });
  assert.equal(a.level1.d, b.level1.d, 'a timing difference must not read as a behaviour change');
  assert.equal(JSON.stringify(a.level2.details).includes('time'), false);
});

test('the random fixture port is scrubbed, the path is kept', () => {
  const { level2 } = normalizeCase({
    key: 'k#1',
    results: [{ result: 'nc', details: [`${ORIGIN}/style.css (ligne 3) : p {color:red}`] }],
    inputHash: 'x',
    origin: ORIGIN,
  });
  assert.equal(level2.details[0], 'http://fixture/style.css (ligne 3) : p {color:red}');
});

test('two runs on a different port produce the same fingerprint', () => {
  const one = normalizeCase({
    key: 'k#1',
    results: [{ result: 'nc', details: [`http://127.0.0.1:1111/a.css`] }],
    inputHash: 'x',
    origin: 'http://127.0.0.1:1111',
  });
  const two = normalizeCase({
    key: 'k#1',
    results: [{ result: 'nc', details: [`http://127.0.0.1:2222/a.css`] }],
    inputHash: 'x',
    origin: 'http://127.0.0.1:2222',
  });
  assert.equal(one.level1.d, two.level1.d);
});

test('detail ORDER is behaviour and is preserved', () => {
  const forward = fingerprint([{ tag: 'a' }, { tag: 'b' }]);
  const backward = fingerprint([{ tag: 'b' }, { tag: 'a' }]);
  assert.notEqual(forward, backward, 'document order must not be sorted away');
});

test('object keys are sorted, so key order alone cannot move a fingerprint', () => {
  const a = normalizeCase({
    key: 'k#1',
    results: [{ result: 'c', details: [{ tag: 'p', xpath: '/p' }] }],
    inputHash: 'x',
    origin: ORIGIN,
  });
  const b = normalizeCase({
    key: 'k#1',
    results: [{ result: 'c', details: [{ xpath: '/p', tag: 'p' }] }],
    inputHash: 'x',
    origin: ORIGIN,
  });
  assert.equal(a.level1.d, b.level1.d);
});

test('an engine that returns nothing is recorded as null, not skipped', () => {
  const { level1 } = normalizeCase({ key: 'k#1', results: [], inputHash: 'x', origin: ORIGIN });
  assert.equal(level1.r, null);
  assert.equal(level1.n, 0);
});

test('JSONL is sorted by key, so shards diff cleanly', () => {
  const out = toJsonl([{ k: 'b' }, { k: 'a' }, { k: 'c' }]);
  assert.deepEqual(
    out.trim().split('\n').map((l) => JSON.parse(l).k),
    ['a', 'b', 'c'],
  );
});

test('shard names come from the criterion id, not the path', () => {
  assert.equal(shardOf('rules/ABBR_W_TITLE/true/1.html#ABBR_W_TITLE'), 'ab');
  assert.equal(shardOf('sets/10058/ima-01-10058_1.html#10058'), '10');
});

test('the input hash ignores nothing but the volatile fields', () => {
  assert.equal(inputHash({ a: 1, b: 2 }), inputHash({ b: 2, a: 1 }));
  assert.notEqual(inputHash({ a: 1 }), inputHash({ a: 2 }));
});
