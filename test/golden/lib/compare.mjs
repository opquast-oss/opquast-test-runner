// Compare a run against a baseline, and say what kind of difference it is.
//
// The distinction that makes this gate usable: a verdict that moved while the inputs stayed put is
// a REGRESSION; a verdict that moved because the inputs moved is not — it is a fixture or ruleset
// change, and reporting it as a regression would train everyone to ignore the gate. That is what
// the `in` hash is for.
//
// Pure functions, no browser, no filesystem: this half is provable in the dev container.

/** Fields whose change means the engine behaved differently. */
const BEHAVIOUR = ['r', 'rl', 'n', 'd'];

function sameBehaviour(a, b) {
  return BEHAVIOUR.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/**
 * @param baseline level-1 records from the committed baseline
 * @param current  level-1 records from the run under test
 */
export function compare(baseline, current, { baselineEnv = {}, currentEnv = {} } = {}) {
  const b = new Map(baseline.map((r) => [r.k, r]));
  const c = new Map(current.map((r) => [r.k, r]));

  const regressions = [];
  const errored = [];
  const inputChanged = [];
  const expectationChanged = [];
  const added = [];
  const removed = [];

  for (const [key, cur] of c) {
    const base = b.get(key);
    if (!base) {
      added.push(key);
      continue;
    }
    // A case that threw is a regression, full stop — checked BEFORE the input hash, because a
    // thrown case has no meaningful input hash and would otherwise be filed under "inputs changed"
    // and dismissed. That hole once let a run in which all 297 cases threw report "no regression".
    if (cur.r === 'ERROR' && base.r !== 'ERROR') {
      errored.push({ key, from: base.r });
      continue;
    }
    if (base.in !== cur.in) {
      // Inputs moved. Whether the verdict moved too is secondary — this case cannot answer the
      // question the gate asks, so it is reported on its own terms.
      inputChanged.push({
        key,
        inputs: [base.in, cur.in],
        verdictMoved: !sameBehaviour(base, cur),
      });
      continue;
    }
    if (!sameBehaviour(base, cur)) {
      regressions.push({
        key,
        from: { r: base.r, rl: base.rl, n: base.n, d: base.d },
        to: { r: cur.r, rl: cur.rl, n: cur.n, d: cur.d },
        // Naming what moved makes a 400-line report scannable.
        what: base.r !== cur.r ? 'verdict' : base.n !== cur.n ? 'detail count' : 'details',
      });
    }
    if (JSON.stringify(base.x) !== JSON.stringify(cur.x)) {
      expectationChanged.push({ key, from: base.x, to: cur.x });
    }
  }
  for (const key of b.keys()) if (!c.has(key)) removed.push(key);

  // Environment drift never fails on its own; it is what explains a failure. A Chromium bump that
  // moves verdicts is a legitimate baseline regeneration, not a bug — but only if you can see it.
  const envDrift = [];
  for (const field of new Set([...Object.keys(baselineEnv), ...Object.keys(currentEnv)])) {
    if (field === 'cases' || field === 'failures') continue;
    const from = JSON.stringify(baselineEnv[field]);
    const to = JSON.stringify(currentEnv[field]);
    if (from !== to) envDrift.push({ field, from: baselineEnv[field], to: currentEnv[field] });
  }

  return {
    regressions,
    errored,
    inputChanged,
    expectationChanged,
    added,
    removed,
    envDrift,
    ok: regressions.length === 0 && removed.length === 0 && errored.length === 0,
  };
}

/**
 * Human-readable report. `details` maps a key to its level-2 record, per side, so a details-only
 * change can show what actually moved instead of two opaque fingerprints.
 */
export function formatReport(result, { baselineDetails = new Map(), currentDetails = new Map() } = {}) {
  const out = [];
  const { regressions, errored, inputChanged, expectationChanged, added, removed, envDrift } = result;

  if (envDrift.length) {
    out.push(`environment differs from the baseline (${envDrift.length} field(s)):`);
    for (const d of envDrift) out.push(`  ${d.field}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
    out.push('  A verdict that moves with the environment is a baseline to regenerate, not a bug.');
    out.push('');
  }

  if (regressions.length) {
    out.push(`✗ ${regressions.length} regression(s) — same inputs, different behaviour:`);
    for (const r of regressions.slice(0, 40)) {
      out.push(`  ${r.key}`);
      if (r.what === 'verdict') {
        out.push(`      verdict ${r.from.r} → ${r.to.r}   results_list ${JSON.stringify(r.from.rl)} → ${JSON.stringify(r.to.rl)}`);
      } else if (r.what === 'detail count') {
        out.push(`      details ${r.from.n} → ${r.to.n}`);
      } else {
        out.push(`      details changed (${r.from.n} unchanged in count)`);
      }
      const bd = baselineDetails.get(r.key)?.details;
      const cd = currentDetails.get(r.key)?.details;
      if (bd && cd) for (const line of detailDiff(bd, cd)) out.push(`      ${line}`);
    }
    if (regressions.length > 40) out.push(`  … and ${regressions.length - 40} more`);
    out.push('');
  }

  if (errored?.length) {
    out.push(`✗ ${errored.length} case(s) threw where the baseline had a verdict:`);
    for (const e of errored.slice(0, 20)) out.push(`  ${e.key}   was ${e.from}`);
    if (errored.length > 20) out.push(`  … and ${errored.length - 20} more`);
    out.push('');
  }

  if (removed.length) {
    out.push(`✗ ${removed.length} case(s) in the baseline produced nothing in this run:`);
    for (const k of removed.slice(0, 20)) out.push(`  ${k}`);
    out.push('');
  }

  if (inputChanged.length) {
    const moved = inputChanged.filter((i) => i.verdictMoved).length;
    out.push(
      `⚠ ${inputChanged.length} case(s) whose INPUTS changed (${moved} also changed verdict) —` +
        ' not a regression: a fixture, a ruleset or the lib set moved.',
    );
    for (const i of inputChanged.slice(0, 20)) out.push(`  ${i.key}`);
    if (inputChanged.length > 20) out.push(`  … and ${inputChanged.length - 20} more`);
    out.push('');
  }

  if (expectationChanged.length) {
    out.push(`⚠ ${expectationChanged.length} case(s) whose hand-written expectation changed.`);
    out.push('');
  }

  if (added.length) {
    out.push(`⚠ ${added.length} case(s) not in the baseline — new fixtures, to be recorded.`);
    out.push('');
  }

  if (result.ok && !inputChanged.length && !added.length && !envDrift.length) {
    out.push('✓ identical to the baseline');
  } else if (result.ok) {
    out.push('✓ no regression');
  }
  return out.join('\n');
}

/** A few lines of what moved inside the details, capped so one bad case cannot flood the report. */
function detailDiff(before, after, cap = 3) {
  const lines = [];
  const b = (Array.isArray(before) ? before : []).map((d) => JSON.stringify(d));
  const a = (Array.isArray(after) ? after : []).map((d) => JSON.stringify(d));
  const gone = b.filter((x) => !a.includes(x));
  const born = a.filter((x) => !b.includes(x));
  for (const x of gone.slice(0, cap)) lines.push(`- ${truncate(x)}`);
  for (const x of born.slice(0, cap)) lines.push(`+ ${truncate(x)}`);
  if (gone.length > cap || born.length > cap) lines.push(`  … ${gone.length} removed, ${born.length} added`);
  return lines;
}

const truncate = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
