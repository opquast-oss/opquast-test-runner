// The second signal: what the engine does, against what the fixture author expected.
//
// Kept strictly apart from the gate. The gate asks "did the engine change its mind", has no
// opinion on correctness, and blocks. This asks "is the engine right", has no opinion on change,
// and does not block. Merging them would make every red run an argument about the referential.
//
// The expectations are hand-written, some of them fifteen years old, and nothing in the repository
// shows the suite was ever green. A disagreement here is therefore not automatically an engine
// bug — it may equally be a fixture that was always wrong. That is why the output is a register to
// be reviewed, not a verdict.

/** Tally a results_list into the {C, NC, NA, I} shape the X-results meta uses. */
export function tally(resultsList) {
  const out = { C: 0, NC: 0, NA: 0, I: 0 };
  for (const r of resultsList ?? []) {
    const k = String(r).toUpperCase();
    if (k in out) out[k] += 1;
  }
  return out;
}

/**
 * Does one record agree with its hand-written expectation?
 *
 * Two conventions, both from the legacy suite:
 *   - a rules fixture expects a single verdict, from its true/false directory;
 *   - a sets fixture expects a tally, and the legacy compared ONLY the keys present in the meta
 *     (`Object.keys(x_results).every(...)`), so a meta that omits a key does not constrain it.
 */
export function agrees(record) {
  const x = record.x;
  if (x === null || x === undefined) return null; // nothing was expected
  if (record.r === 'ERROR') return false;
  if (typeof x === 'string') return record.r === x;
  const got = tally(record.rl);
  return Object.keys(x).every((k) => got[k.toUpperCase()] === x[k]);
}

/**
 * Compare a set of baseline records against the committed register.
 *
 * `register` maps a case key to a reviewed note. Its cardinality is a floor: a disagreement that
 * is not in it is new and must be looked at; one that is in it but now agrees is good news and
 * should be removed.
 */
export function review(records, register = {}) {
  const disagreeing = [];
  const agreeing = [];
  const unexpected = [];

  for (const rec of records) {
    const verdict = agrees(rec);
    if (verdict === null) continue;
    (verdict ? agreeing : disagreeing).push(rec);
  }

  const known = new Set(Object.keys(register));
  const seen = new Set(disagreeing.map((r) => r.k));
  const fresh = disagreeing.filter((r) => !known.has(r.k));
  for (const k of known) if (!seen.has(k)) unexpected.push(k);

  return {
    checked: agreeing.length + disagreeing.length,
    agreeing: agreeing.length,
    disagreeing,
    fresh,
    resolved: unexpected,
    ok: fresh.length === 0,
  };
}

/** Group disagreements by rule or criterion, which is how a human reads several hundred of them. */
export function byCriterion(records) {
  const groups = new Map();
  for (const r of records) {
    const id = r.k.split('#').pop();
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(r);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length);
}

/**
 * Which rule turned the verdict? `results_list` is ordered like the criterion's rules, so a
 * position that came back `i` names the rule that gave up. Without this a register of 206 lines
 * says where, and a reviewer still has to find out why for each one.
 */
export function blame(record, rulesets) {
  const id = record.k.split('#').pop();
  const names = Object.keys(rulesets[id] ?? {});
  if (typeof record.x === 'string') return names.length === 1 ? names : [id];
  const out = [];
  (record.rl ?? []).forEach((v, i) => {
    if (v === 'i' && names[i]) out.push(names[i]);
  });
  return out.length ? out : names;
}

/**
 * First-pass classification, for the causes already established by measurement. Everything else
 * stays `unclassified` on purpose: guessing a category is worse than admitting nobody has looked.
 */
export const KNOWN_CAUSES = {
  CSS_CONTENT: {
    category: 'browser',
    note:
      'getComputedStyle(el, ":before").getPropertyCSSValue() — removed from Blink and from the ' +
      'CSSOM spec. The call throws, the catch returns false, and false is `i`. Firefox-only API; ' +
      'nothing to fix in the engine short of rewriting the rule against getPropertyValue().',
  },
  FAVICON: {
    category: 'network',
    note: 'needs a real fetch of /favicon.ico, which the hermetic corpus deliberately cannot serve.',
  },
  HTTP_404: {
    category: 'network',
    note: 'needs a real 404 probe against the origin, which the hermetic corpus cannot serve.',
  },
};
