// Reading and writing a baseline directory.
//
// Layout, sharded on the first two characters of the criterion id so one rule family lands in one
// file — a behaviour change then touches a small, reviewable diff instead of a single huge file:
//
//   <dir>/env.json
//   <dir>/<shard>.jsonl           level 1, one compact record per case
//   <dir>/details/<shard>.jsonl   level 2, the full normalised details

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { toJsonl, shardOf } from './normalize.mjs';

function group(records, pick) {
  const shards = new Map();
  for (const r of records) {
    const s = shardOf(r.level1.k);
    if (!shards.has(s)) shards.set(s, []);
    shards.get(s).push(pick(r));
  }
  return [...shards].sort();
}

export function writeBaseline(dir, records, env) {
  mkdirSync(join(dir, 'details'), { recursive: true });
  for (const [s, rows] of group(records, (r) => r.level1)) {
    writeFileSync(join(dir, `${s}.jsonl`), toJsonl(rows));
  }
  for (const [s, rows] of group(records, (r) => r.level2)) {
    writeFileSync(join(dir, 'details', `${s}.jsonl`), toJsonl(rows));
  }
  writeFileSync(join(dir, 'env.json'), JSON.stringify(env, null, 2) + '\n');
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function readBaseline(dir) {
  if (!existsSync(dir)) return null;
  const level1 = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    level1.push(...readJsonl(join(dir, f)));
  }
  const details = new Map();
  const detailDir = join(dir, 'details');
  if (existsSync(detailDir)) {
    for (const f of readdirSync(detailDir).filter((f) => f.endsWith('.jsonl')).sort()) {
      for (const row of readJsonl(join(detailDir, f))) details.set(row.k, row);
    }
  }
  const envPath = join(dir, 'env.json');
  const env = existsSync(envPath) ? JSON.parse(readFileSync(envPath, 'utf8')) : {};
  return { level1, details, env };
}

/** Level-1 records and a key→details map, from a fresh run. */
export function splitRun(records) {
  return {
    level1: records.map((r) => r.level1),
    details: new Map(records.map((r) => [r.level2.k, r.level2])),
  };
}

/** One hash over the whole level-1 tier: what two runs compare when you just want yes or no. */
export function level1Digest(records) {
  const parts = group(records, (r) => r.level1).map(([s, rows]) => s + toJsonl(rows));
  return parts.join('');
}
