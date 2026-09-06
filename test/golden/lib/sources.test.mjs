import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseCollisions, selectTier, enumerateAll, QUARANTINE } from './sources.mjs';

test('no fixture path differs from another only by case', () => {
  // Regression lock. Twelve byte-identical duplicates lived in sets/ under both SCR-… and scr-…
  // spellings: invisible on a case-insensitive checkout, enumerated in CI, and the corpus digest
  // disagreed by exactly those twelve cases between the two. The check asks git rather than the
  // filesystem, because the machine that creates this problem is the one that cannot see it.
  assert.deepEqual(caseCollisions(), []);
});

test('the tiers partition the corpus, with S1 inside S2', () => {
  const s2 = selectTier('S2').map((c) => c.key);
  const s3 = selectTier('S3').map((c) => c.key);
  const s4 = selectTier('S4').map((c) => c.key);
  const union = new Set([...s2, ...s3, ...s4]);
  assert.equal(union.size, s2.length + s3.length + s4.length, 'tiers must not overlap');
  assert.equal(union.size, enumerateAll().length, 'and must cover everything');
  const inS2 = new Set(s2);
  assert.ok(selectTier('S1').every((c) => inS2.has(c.key)), 'S1 is a subset of S2');
});

test('quarantined cases are enumerated by nothing', () => {
  const all = new Set(enumerateAll().map((c) => c.key));
  for (const k of Object.keys(QUARANTINE)) assert.ok(!all.has(k), `${k} must not be enumerated`);
});
