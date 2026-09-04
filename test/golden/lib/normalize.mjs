// Raw engine output → the canonical record the baseline stores.
//
// Two levels, on purpose. Level 1 is one compact line per case, diffable by eye. Level 2 is the
// full `details` array, read only when level 1 says the fingerprint moved.
//
// The existing golden in the extension keeps only `details.length`, which is why it cannot detect
// a changed selector, XPath or extracted text — precisely the kind of drift a refactor produces.
// docs/engine-modernization-plan.md §5.4 asks for "mêmes statuts, mêmes détails"; this keeps them.

import { createHash } from 'node:crypto';

/** Everything that varies for reasons other than the engine. */
const VOLATILE = new Set(['time']);

/**
 * The fixture origin carries a random port. Rewriting it to a fixed token keeps a port change from
 * producing thousands of lines of diff, without discarding the path — which IS behaviour.
 */
function scrub(value, origin) {
  if (typeof value === 'string') return origin ? value.split(origin).join('http://fixture') : value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, origin));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (VOLATILE.has(k)) continue;
      out[k] = scrub(value[k], origin);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON: keys sorted at every level, so a fingerprint depends on content and not on the
 * order the engine happened to build its objects in.
 *
 * The ORDER OF THE DETAILS ARRAY is deliberately preserved — it follows document order, which is
 * behaviour, not noise. Only object keys are sorted.
 */
export function canonical(value) {
  return JSON.stringify(value);
}

export function fingerprint(value) {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

/**
 * One case's record.
 *
 * `results` is what synthesize_results returned. The legacy suites evaluated a single criterion
 * per page, so the row of interest is the first (and normally only) one; a case that somehow
 * produced none is recorded as `null` rather than silently skipped — "the engine returned nothing"
 * is a finding, not an absence.
 */
export function normalizeCase({ key, results, expectation, inputHash, origin }) {
  const row = Array.isArray(results) ? results[0] : undefined;
  const details = scrub(row?.details ?? [], origin);

  return {
    level1: {
      k: key,
      r: row?.result ?? null,
      rl: row?.results_list ?? null,
      n: Array.isArray(details) ? details.length : 0,
      d: fingerprint(details),
      x: expectation ? expectation.value : null,
      in: inputHash,
    },
    level2: { k: key, details },
  };
}

/** Stable serialisation of a payload, for the `in` hash that guards against silent input drift. */
export function inputHash(payload) {
  return createHash('sha256').update(canonical(scrub(payload, null))).digest('hex').slice(0, 16);
}

/** JSONL, one record per line, sorted by key so a shard is diffable. */
export function toJsonl(records) {
  return (
    records
      .slice()
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  );
}

/** Shard name: the first two characters of the criterion id, so a family lands in one file. */
export function shardOf(key) {
  const id = key.split('#').pop() ?? '';
  const head = id.slice(0, 2).toLowerCase().replace(/[^a-z0-9]/g, '_');
  return head || '__';
}
