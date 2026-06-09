# DeFiMath — Project notes for Claude

## Test file structure

Every Solidity contract test file (`test/<Module>.test.mjs`) is organized **function-first** —
each function has its own top-level `describe` block, and within that, a fixed sequence of
sub-describes models the kind of property being checked.

### Layout

```js
import { /* ... */ } from "./Common.test.mjs";
// per-file relative-error constants (e.g. MAX_REL_ERROR_LN)
const MAX_REL_ERROR_X = 1e-15;

describe.only("ModuleName", function () {
  // deploy fixture, helpers, hoisted constants
  async function deploy() { /* ... */ }
  before(async function () {
    // Pay the deploy + snapshot cost once so the first it() isn't charged with cold-start
    await loadFixture(deploy);
  });

  describe("functionName", function () {
    // any hoisted const/let shared across sub-describes (e.g. UMAX, INT_MAX)

    describe("behaviour",   function () { /* normal cases (sweeps + identities)  */ });
    describe("limits",      function () { /* min/max valid inputs + branch edges */ });
    describe("random",      function () { /* fuzz with real Math.random          */ });
    describe("failure",     function () { /* revert paths                         */ });
    describe("performance", function () { /* one it() per fn — N≈200, deterministic */ });
  });

  describe("nextFunction", function () { /* ... */ });
});
```

### Sub-describe semantics (in order)

| Section | Contains |
| :--- | :--- |
| **behaviour** | Normal-case `it()` tests. Sweeps across the function's typical operating range (~200 samples per test where applicable). Identity cases (`x=1`, `a=0`). |
| **limits** | Min and max valid inputs (e.g. `x is 0`, `x is uint256 max`); branch-transition boundaries (e.g. `x = -1 wei` if that crosses an `if`/`else`); near-revert boundary (largest input that doesn't trigger the revert). Always include min AND max input. |
| **random** | Fuzz coverage. Uses real `Math.random()` (not seeded) — 500 iterations is typical. Empty `describe` is OK if no random tests exist yet. |
| **failure** | Revert/error paths. One `it()` per named error in the contract. Empty `describe` is OK if the function has no revert paths (e.g. `min`, `max`). |
| **performance** | Exactly one `it()` per function. Deterministic (seeded `mulberry32` for any random sampling). ~200 samples wide-sweep across the full valid input domain. Asserts `avg gas ≤ threshold`. Test name includes the threshold: `"funcName when x in [lo, hi] — N gas"`. **No `console.log`** — the assert is the regression gate. |

### Conventions

- **Function-first ordering**: editing one function = one contiguous block.
- **No empty section noise**: function groups that genuinely have no random/failure/limits content can omit the corresponding sub-describe. Don't pad with empty stubs.
- **Hoisted helpers**: shared helpers (`measureBatch`, `realisticAmount`, `REALISTIC_DENOMS`) live at the outer `describe("Module")` scope, not inside any function group.
- **Helpers in `Common.test.mjs`**: cross-file utilities live there with `export` (`mulberry32`, `randomUint256`, `randomInt256`, `tokens`, `assertRelativeBelow`, `assertAbsoluteBelow`, `assertRevertError`).
- **Sweep step**: linear `for (let x = LO; x op HI; x += STEP)` with `STEP ≈ (HI - LO) / 200`. For multi-decade domains use log-spaced `x *= (HI/LO)**(1/200)`. For sub-ULP / dyadic-sensitive ranges keep `x += x` (geometric doubling) with a comment explaining why.
- **2D loops**: target ~14 × 14 ≈ 196 samples total, not 200 × 200.
- **Performance determinism**: seed `mulberry32(N)` per function (`N` = distinct integer per `it()` so changes don't propagate gas drift across tests). Gas threshold in `assert.ok(avg <= N, ...)` is tight — bump deliberately on intentional changes.
- **`before` hook**: outer `describe("Module")` has a `before` that calls `loadFixture(deploy)` once. Pays the ~300ms cold-start cost outside any `it()` so Mocha doesn't flag the first test as slow.

### Status

| File | Restructured to function-first |
| :--- | :--- |
| `test/Math.test.mjs` | ✅ done (20 function groups, 187 tests) |
| `test/Options.test.mjs` | ✅ done (7 function groups, 96 tests) |
| `test/Binary.test.mjs` | ⬜ pending |
| `test/Rates.test.mjs` | ⬜ pending |
| `test/Stats.test.mjs` | ⬜ pending |
| `test/Futures.test.mjs` | ⬜ pending |

### Workflow rule: when refactoring a test file

1. **Inventory** the existing test names + which function each touches.
2. **Move** each test into the function-first layout under its own `describe(fn)`.
3. **Categorize** each `it()` into `behaviour` / `limits` / `random` / `failure` / `performance`.
4. **Verify** all tests still pass before any name/step changes (`npx hardhat test test/<File>.test.mjs`).
5. **Reduce** sweep tests to ~200 samples each, log-spaced for multi-decade domains.
6. **Add `limits` coverage** for min and max valid inputs of every function (move existing identity tests, add new boundary tests).
7. **Consolidate** performance: one deterministic `it()` per function with a tight `≤ threshold` gas assert in the test name. No `console.log`.
8. **Clean up** any `scripts/` tooling used for the refactor; never commit one-shot scripts.

Future test files should match the Math layout verbatim — readers should be able to jump
between any two test files without re-learning the structure.
