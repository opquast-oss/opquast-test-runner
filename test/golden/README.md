# Golden-master harness

Proves that changing the engine changes no verdict. See
`docs/engine-modernization-plan.md` §5 in the opquast-devtools repository for why it is a
precondition of M3, not an extra.

## Running it

```bash
npm install
npx playwright install chromium

node test/golden/record.mjs --tier S1 --out .golden-out/run1
```

Flags: `--tier S1|S2|S3|S4`, `--world isolated|main` (isolated is the default — see below), `--jquery <path>`, `--offset N`, `--limit N`,
`--out <dir>` (relative to `test/golden/`, default a gitignored scratch directory).
`GOLDEN_NO_EVENT_SHIM=1` disables the DOM0 handler instrumentation.

Output is sorted JSONL, so two runs are compared with `diff -r`.

### System dependencies

Chromium needs more shared libraries than a bare Debian image carries, and the failure is
**silent**: `headless_shell` does not check them and simply dies mid-page — "Target page, context or
browser has been closed" — while the full build refuses to start and names what is missing. Missing
Cairo/Pango cost an hour of bisection here, crashing on any page containing a form control and only
those.

```bash
sudo npx playwright install-deps chromium
```

CI uses `mcr.microsoft.com/playwright`, which carries them; that is the main reason the
authoritative baseline is produced there and not on a workstation.

## The gate

```bash
node test/golden/check.mjs --tier S1            # compares to baseline/S1
```

Exit 0 when nothing regressed, 1 when something did, 2 when the run could not complete — a browser
that dies mid-tier is not a green run with fewer cases.

The gate has **no opinion on whether a verdict is right**. It says only that the engine started
answering something else. Correctness against the fixtures' hand-written expectations is a
separate, non-blocking pass; merging the two would make the gate re-litigate the referential every
time it turned red.

Its central distinction is between a verdict that moved on unchanged inputs — a regression — and
one that moved because a fixture, a ruleset or the referential moved, which is not. That is what
the `in` hash is for, and it is why the hash covers the inputs and never the engine: hashing the
lib digests there would classify every engine edit as "inputs changed" and the gate would report a
regression exactly never, green by construction.

### Proving the gate actually catches something

A gate nobody has seen fail is a decoration. Verified end to end, on the full pilot:

```bash
node test/golden/record.mjs --tier S1 --out .golden-out/base
node test/golden/check.mjs  --tier S1 --baseline .golden-out/base   # ✓ identical to the baseline
node test/golden/.golden-out/break-engine.mjs                       # flips one rule's regex
node test/golden/check.mjs  --tier S1 --baseline .golden-out/base   # ✗ 1 regression
git checkout -- data/lib/oqs-tests.js
node test/golden/check.mjs  --tier S1 --baseline .golden-out/base   # ✓ identical again
```

The red run reported exactly one regression out of 297 cases —
`rules/JS_POPUP/true/1.html#JS_POPUP`, `verdict c → nc` — with no false positives, and named the
cause above it: of the five engine libs, only `oqs-tests.js`'s digest had moved.

### In CI

| job | tier | when |
|---|---|---|
| `golden:pilot` | S1, 297 cases | every pipeline |
| `golden:rules` | S2, 2 386 cases | default branch, MRs, schedules |
| `golden:criteria` | S3, 3 756 cases | default branch, MRs, schedules |
| `golden:modern` | S1 through `createEngine()` | every pipeline |
| `golden:record` | regenerates all three | manual only |

The image tag pins Chromium, and Chromium is part of the measurement: a browser bump can move a
verdict legitimately. Pinning it is what makes a red run mean "the engine changed" rather than
"something changed". Regenerating a baseline stays manual and produces an artifact to review —
never something a pipeline does on its own.

## Tiers

| tier | content | cases |
|---|---|---|
| S1 | every rule that is not plain DOM matching (not `xpath@html`, not `oqs@html`) | 297 over 118 rules |
| S2 | all of `fixtures/rules/` — 949/949 rules | 2 388 |
| S3 | all of `fixtures/sets/` — chaining, `results_list`, `na` | 3 757 |
| S4 | the periphery: stock, debug, impossible. Recorded, never blocking | 2 322 |

S1 starts with the hard set on purpose. The 822 DOM-only rules are the most deterministic by
construction, so proving them stable would prove little; if the 127 that read stylesheets, scripts,
HTTP resources, feeds or the doctype hold still, the rest follow.

`zombies` is excluded outright: its 23 criteria exist in no ruleset file, so nothing can evaluate
them.

## The two worlds

`--world main` runs the engine in the page's own global; `--world isolated` runs it in a real
isolated world sharing the DOM (CDP `Page.createIsolatedWorld`). Both go through
`Runtime.evaluate`, never `page.evaluate`, so the world is the only difference between two runs.

**They do not agree, and the difference is a production defect, not a harness artifact.**

Measured on S1: 9 of 297 cases differ, all in the `oqs@js` family. `_detectFunction` resolves an
inline handler's call by name against `window` and inspects the function's source:

```js
var fn = window;
for (var i of _function.split('.')) { fn = fn[i]; }
if (reg.test(fn.toString())) { result.push(_function); }
```

In the main world `window.bla` is the page's function and the rule fires. In an isolated world it
is `undefined`, `fn.toString()` throws, and an empty `catch` swallows it — the rule reports nothing.

The legacy add-on used `Cu.Sandbox({ sandboxPrototype: window })`, whose reads fell through to the
page, so it behaved like the main world. The extension injects the engine with
`browser.scripting.executeScript` and no `world` option — that is, isolated. So this family of
rules silently under-detects in production, and the extension's own harnesses cannot see it because
they run in the main world.

Tracked separately as DTOOLS-003: it is an extension defect, not an engine one.

**The baseline is anchored on the isolated world**, which is why it is the default. The net's job
is to guard what actually ships, not what ought to. The main world is recorded alongside as a
comparison — it agrees with the legacy add-on and therefore reads "more correct", but anchoring
there would leave the gate green while production drifted. When DTOOLS-003 is fixed, the anchor
moves and the baseline is regenerated: a deliberate, reviewed change, visible in its diff.

## Two engines, one measurement

`--adapter legacy` loads `data/lib/*.js` and calls the globals the way the add-on did.
`--adapter modern` loads the built browser global and goes through `createEngine()`. Same
fixtures, same fabricated HAR, same criteria — the engine is the only thing that differs.

Measured: **297/297 identical.** Which took a fix to get to. The first comparison returned 75
regressions, all CSS rules, nearly all `c → nc`: `createEngineContext` destructured `services` and
read only `dnsResolve`, so `services.xhr` — declared in the public API, typed, documented — was
never wired. The engine could see nothing beyond what a caller pre-loaded, and `createXhrShim`
answers `status: 0, data: ''` for everything else. To a rule that is not "not fetched", it is "the
resource exists and is empty", so every rule reading a stylesheet concluded the page had no CSS.

The harness hands the modern engine the very XHR the legacy path uses, captured before
`createEngine()` replaces the global. A lookalike reimplementation would make any remaining
difference unattributable, which is the one thing this comparison cannot afford.

### The M0→M2 audit, and why it cannot be a verdict diff

`--engine-rev <rev>` runs the pilot against the engine as it stood at any commit. Pointed at
`438f133a`, the state before the modernization, all 297 cases throw the same error:

```
SyntaxError: Unexpected identifier 'v'
```

Line 2384 of the pre-M0 `oqs-tests.js`:

```js
var _res = res.filter(function(v) v !== null);
```

SpiderMonkey expression closures — a Firefox extension, never standard, long removed. No V8-based
runtime will parse the file; `node --check` refuses it too. So a verdict-by-verdict comparison
against pre-M0 is impossible in Chromium **by construction**, and the "0 differences" the plan
expected was never reachable.

That is a better answer than the one expected. M1's four lines are not a cleanup: they are what
makes the engine executable outside Firefox at all. The claim that M0–M2 changed no verdict
therefore rests where it can be settled by inspection — on those four lines being semantically
identical (`function(v) v !== null` ≡ `function(v) { return v !== null; }`) — and not on a run that
cannot happen.

## The jQuery question, answered

The extension shipped jQuery 1.9.1 → 3.7.1 + Migrate on 2026-07-20, on the strength of a golden
covering 8 criteria on one page. `--jquery <path>` runs any tier under either, so the whole rules
tier can now answer what that change did.

**15 regressions out of 2 386**, all in one family — form-control labelling
(`INPUT_W_TYPE_*_WO_FILLED_AND_UNIQUE_LABEL`, `SELECT_…`, `TEXTAREA_…`) — and all `c → i`: the
rules stop returning a verdict and fall back to "check by hand".

The mechanism, measured rather than surmised. `_htmlSameLabelsTitles` builds a selector by
concatenation (`data/lib/oqs-tests.js:347` and `:395`):

```js
var id = $.trim($(this).attr("id")),
    oLabel = $("label[for=" + id + "]"),
```

A form control with no `id` yields `label[for=]`:

| | `$('label[for=]')` |
|---|---|
| jQuery 1.9.1 | `0 matches`, silent |
| jQuery 3.7.1 + Migrate 3.5.2 | **throws** `Syntax error, unrecognized expression` |

The throw is caught, `result = false`, and the verdict becomes `i`. So since 2026-07-20, any form
control without an `id` — which is to say a great many real pages — makes this whole family of
accessibility rules abandon its verdict, silently, in production.

**Fixed, and proven in both directions** (`oLabel = id ? $("label[for=" + id + "]") : $()`):

| | verdicts |
|---|---|
| jQuery 1.9.1 + fix | `✓ no regression` — a non-event, the baseline untouched |
| jQuery 3.7.1 + fix | `✓ no regression` — 15 → 0 |

Two runs, ten minutes, and the jQuery upgrade is now verdict-neutral across all 949 rules. That
pair of runs is what the net was built for: a fix is not "it looks right", it is "the baseline held
where it had to and moved where it had to".

Two call sites, both in that one function. Note what the first hypothesis was: `.size()`, removed
in jQuery 3.0, used seven times in the engine. Measured instead of assumed — Migrate 3.5.2 does
restore `.size()`, so it was never the cause. Two runs of a probe settled it.

## What the baseline stores

Two levels. Level 1 is one compact line per case:

```
{"k":"rules/IMG_W_ALT/true/1.html#IMG_W_ALT","r":"c","rl":["c"],"n":2,"d":"a3f1…","x":"c","in":"7bd0…"}
```

`r` result · `rl` results_list · `n` number of details · `d` fingerprint of the details · `x` the
hand-written expectation · `in` a hash of the inputs. Level 2 holds the full normalised `details`,
read only when `d` moves. Measured: 24 kB for 297 cases, about 494 kB for the whole net.

`time` is dropped at the source and the fixture server's random port is scrubbed, because neither
is behaviour. Object keys are sorted; **the order of the details array is not** — it follows
document order, which is behaviour.

`in` exists to separate "the engine changed its mind" from "the inputs changed": a case whose
inputs moved is reported as such rather than as a regression.

## Two signals, never mixed

The fixtures carry expectations written by hand years ago — the `true`/`false` directory for the
rules families, the `X-results` meta for the sets families. They are not recordings of the engine
and nothing proves the suite was ever green.

So: the baseline (what the engine does) is one thing, `x` (what the author expected) is another.
The blocking gate compares runs to the baseline and has no opinion on correctness.
`node test/golden/conformance.mjs` compares the baseline to `x` and never blocks on the
disagreements themselves — only on ones absent from `conformance.json`, so the register is a floor
that can shrink but not silently grow.

**Measured across the three tiers: 6 142 cases carry an expectation, 5 936 agree — 96.6%.**

For a suite written by hand over fifteen years, never once proven green, and replayed in a
different browser engine, that is a good deal better than feared. The 206 disagreements are
attributed to the rule that caused them, since `results_list` is ordered like the criterion's
rules:

| cases | cause | |
|---|---|---|
| 44 | `CSS_CONTENT` | `getPropertyCSSValue()`, removed from Blink and from the CSSOM spec. Throws, the catch returns false, false is `i`. |
| 38 | `FAVICON`, `HTTP_404` | need a real network fetch the hermetic corpus deliberately cannot serve. |
| 124 | unclassified | not yet looked at — and left saying so, because guessing a category is worse than admitting nobody has. |

When the engine contradicts the fixture, we record it. We do not quietly fix either side: these
expectations predate the port, so a disagreement may equally be a fixture that was always wrong.
