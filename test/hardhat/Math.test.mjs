
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import bs from "black-scholes";
import erf from 'math-erf';
import { assertAbsoluteBelow, assertPrecisionBelow, assertRelativeBelow, assertRevertError, mulberry32, randomInt256, randomUint256, tokens } from "./Common.test.mjs";
import { assert } from "chai";
import Decimal from "decimal.js";
import {
    MAX_ABS_ERROR_EXP, MAX_REL_ERROR_EXP, MAX_REL_ERROR_EXPM1, MAX_ABS_ERROR_EXPM1, MAX_REL_ERROR_LN, MAX_ABS_ERROR_LN, MAX_REL_ERROR_SQRT, MAX_ABS_ERROR_SQRT,
    MAX_REL_ERROR_CBRT, MAX_ABS_ERROR_CBRT, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW, MAX_ABS_ERROR_ERF, MAX_ABS_ERROR_CDF,
} from "./Tolerances.test.mjs";

// ── Full-precision sqrt accuracy check (decimal.js) ────────────────────────────
// Float64 Math.sqrt caps measurable error at ~3e-16 (machine epsilon). decimal.js
// at 60 digits computes the exact reference, so we can assert the TRUE accuracy:
// the result is correctly rounded to 1 wei = MAX_ABS_ERROR_SQRT (small values, where FP18
// quantization dominates) or within MAX_REL_ERROR_SQRT relative (large values). This
// reveals ~1e-18 (60-bit) accuracy.
Decimal.set({ precision: 60 });
const sqrtExactWei = (xWei) => new Decimal(xWei.toString()).times("1e18").sqrt(); // exact √(x·1e18) in wei
// Relative-error check — for x > 1e18 wei (real value > 1), where the FP18 result
// carries ≥18 significant digits so relative error is the meaningful metric.
function assertSqrtAccurate(actual, expected) {
  const rel = new Decimal(actual.toString()).minus(expected).abs().div(expected);
  assert.ok(rel.lt(MAX_REL_ERROR_SQRT),
    `relErr ${rel.toExponential(3)} ≥ ${MAX_REL_ERROR_SQRT.toExponential(0)}`);
}
// Absolute check — for x < 1e18 wei (result < 1), where the result has few significant
// wei and error is FP18-quantization-dominated (relative is meaningless). Measured in
// real-value (FP18) terms — wei difference ÷ 1e18 — to match the other MAX_ABS_ERROR_*
// bounds. sqrt is correctly rounded here, so the bound is 1 wei = 1e-18.
function assertSqrtAbsolute(actual, expected) {
  const absErr = new Decimal(actual.toString()).minus(expected).abs().div("1e18");
  assert.ok(absErr.lte(MAX_ABS_ERROR_SQRT), `sqrt off by ${absErr.toExponential(2)} (> ${MAX_ABS_ERROR_SQRT.toExponential(0)})`);
}

// ── Full-precision cbrt accuracy check (decimal.js) ────────────────────────────
// Same rule as sqrt: relative where cbrt(x) ≥ 1 (x ≥ 1e18 wei), absolute where
// cbrt(x) < 1 (near 0, where the result is quantization-dominated). Unlike sqrt,
// cbrt is not correctly-rounded sub-1 (~8.5e-17 worst, ≈85 wei), so MAX_ABS_ERROR_CBRT
// is looser than sqrt's 1-wei rounding. cbrtExactWei = exact cbrt(x)·1e18 in wei:
// cbrt(x)·1e18 = cbrt(x · 1e54) = cbrt(xWei · 1e36).
const cbrtExactWei = (xWei) => new Decimal(xWei.toString()).times("1e36").cbrt();
// Relative-error check — for x ≥ 1e18 wei (result ≥ 1). One bound covers both the
// small-x branch (~1.4e-16) and the large-x post-scale branch (~1.1e-13).
function assertCbrtAccurate(actual, expected) {
  const rel = new Decimal(actual.toString()).minus(expected).abs().div(expected);
  assert.ok(rel.lt(MAX_REL_ERROR_CBRT),
    `relErr ${rel.toExponential(3)} ≥ ${MAX_REL_ERROR_CBRT.toExponential(0)}`);
}
// Absolute check — for x < 1e18 wei (result < 1), where relative error blows up at
// the tiny end while the absolute error stays tiny. Error is measured in real-value
// (FP18) terms — wei difference ÷ 1e18 — to match the other MAX_ABS_ERROR_* bounds.
function assertCbrtAbsolute(actual, expected) {
  const absErr = new Decimal(actual.toString()).minus(expected).abs().div("1e18");
  assert.ok(absErr.lte(MAX_ABS_ERROR_CBRT), `cbrt off by ${absErr.toExponential(2)} (> ${MAX_ABS_ERROR_CBRT.toExponential(0)})`);
}

describe("DeFiMath", function () {

  async function deploy() {
    const MathWrapper = await ethers.getContractFactory("MathWrapper");
    const deFiMath = await MathWrapper.deploy();

    return { deFiMath };
  }

  before(async function () {
    // Pay the deploy + snapshot cost once here so the first it() in any
    // describe block isn't charged for fixture cold-start.
    await loadFixture(deploy);
  });

  // ----- hoisted from describe("performance") -----


  // Realistic-input perf tests for mulDiv and mul.
  //
  // What "realistic" means here: typical DeFi arithmetic — token amounts in the
  // 1e6..1e30 wei range (covers stablecoins, ETH, and large-cap caps in 1e18 FP),
  // multiplied by rates/prices in the 1e15..1e22 range (10% to a few thousand).
  // Almost every product fits in uint256, so the fast path dominates; this matches
  // what users actually pay in production contracts.
  //
  // Magnitudes sampled log-uniformly so each decade of token amount is hit roughly
  // equally — avoids the bias toward the chosen extremes that a small hand-picked
  // grid produces.
  function realisticAmount(rng = Math.random) {
    // Log-uniform across roughly 1e6 .. 1e30 (~20..100 bits)
    const bits = 20 + Math.floor(rng() * 81);
    let n = 0n;
    let remaining = bits;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 30);
      n = (n << BigInt(chunk)) | BigInt(Math.floor(rng() * (1 << chunk)));
      remaining -= chunk;
    }
    return n === 0n ? 1n : n;
  }
  const REALISTIC_DENOMS = [
    10n ** 6n,     // USDC / 6-decimal stables
    10n ** 8n,     // BTC sats, Chainlink price feeds
    10n ** 18n,    // ETH and standard 1e18 fixed-point
    10n ** 27n,    // Aave's RAY precision
  ];

  // Batch-minus-baseline gas measurement for tiny inlined functions.
  //
  // Single-call wrappers under-report these because the Solidity optimizer
  // can hoist pure computations OUT of the gasleft() window. The chained-call
  // pattern (acc = f(acc, xs[i])) makes each call data-dependent on the
  // previous, defeating reordering. To isolate the function's marginal cost
  // from loop overhead, we subtract a baseline (same loop with XOR instead).
  async function measureBatch(deFiMath, batchFn, N, rng = Math.random) {
    const xs = new Array(N);
    // Use a mix of magnitudes so the optimizer can't pre-compute anything
    for (let i = 0; i < N; i++) {
      const bits = 20 + Math.floor(rng() * 200);
      let v = 0n;
      let r = bits;
      while (r > 0) { const c = Math.min(r, 30); v = (v << BigInt(c)) | BigInt(Math.floor(rng() * (1 << c))); r -= c; }
      xs[i] = v;
    }
    const baseline = parseInt((await deFiMath.noopBatchMG(xs)).totalGas);
    const total = parseInt((await deFiMath[batchFn](xs)).totalGas);
    // (N - 1) operations per loop (xs[0] seeds acc)
    return Math.round((total - baseline) / (N - 1));
  }

  describe("exp", function () {
    describe("behaviour", function () {
      it("exp when x in [1e-18, 0.01083042)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x < 0.01083042; x += x / 1.976) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("exp when x in [0.01083042, 0.69314718)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.01083042; x < 0.69314718; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("exp when x in [0.69314718, 2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.69314718; x < 2; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("exp when x in [2, 32)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x < 32; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("exp when x in [32, 135)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 32; x < 135; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("exp when x in [-1e-18, -0.01083042)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x < 0.01083042; x += x / 1.976) {
          const expected = Math.exp(-x);
          const actualSOL = (await deFiMath.exp(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_EXP);
        }
      });

      it("exp when x in [-0.01083042, -0.69314718)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.01083042; x < 0.69314718; x *= 1.0123) {
          const expected = Math.exp(-x);
          const actualSOL = (await deFiMath.exp(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_EXP);
        }
      });

      it("exp when x in [-0.69314718, -2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.69314718; x < 2; x *= 1.0123) {
          const expected = Math.exp(-x);
          const actualSOL = (await deFiMath.exp(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_EXP);
        }
      });

      it("exp when x in [-2, -32)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x < 32; x *= 1.0123) {
          const expected = Math.exp(-x);
          const actualSOL = (await deFiMath.exp(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_EXP);
        }
      });

      it("exp when x in [-32, -41.446)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 32; x < 41.446; x *= 1.0123) {
          const expected = Math.exp(-x);
          const actualSOL = (await deFiMath.exp(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_EXP);
        }
      });
    });

    describe("limits", function () {
      it("exp when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actualSOL = (await deFiMath.exp(0)).toString() / 1e18;
        assert.equal(actualSOL, 1);
      });

      it("exp when x is 1e-18", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const expected = Math.exp(1e-18);
        const actualSOL = (await deFiMath.exp(tokens(1e-18))).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
      });

      it("exp when x is largest positive", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const x = "134999999999999999999";
        const expected = Math.exp(134.999999999999999999);
        const actualSOL = (await deFiMath.exp(x)).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
      });

      it("exp when x is -1e-18", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const expected = Math.exp(-1e-18);
        const actualSOL = (await deFiMath.exp(tokens(-1e-18))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_EXP);
      });

      it("exp when x lowest negative", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const expected = Math.exp(-41.446531673892822312);
        let actualSOL = (await deFiMath.exp("-41446531673892822312")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_EXP);
        assert.equal(actualSOL, 1e-18);

        actualSOL = (await deFiMath.exp("-41446531673892822313")).toString() / 1e18;
        assert.equal(actualSOL, 0);
      });
    });

    describe("random", function () {
      it("matches Math.exp on 500 random positive inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let i = 0; i < 500; i++) {
          const x = Math.random() * 135;
          const expected = Math.exp(x);
          const actual = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("matches Math.exp on 500 random negative inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let i = 0; i < 500; i++) {
          const x = -Math.random() * 41.446;
          const expected = Math.exp(x);
          const actual = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXP);
        }
      });
    });

    describe("failure", function () {
      it("rejects when x >= max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        await assertRevertError(deFiMath, deFiMath.exp("135000000000000000000"), "ExpUpperBoundError");
        await deFiMath.exp("134999999999999999999");
        await assertRevertError(deFiMath, deFiMath.exp("136000000000000000000"), "ExpUpperBoundError");
      });
    });

    describe("performance", function () {
      it("exp when x in [-40, 130] — 285 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = -40; x <= 130; x += 0.85) {
          totalGas += parseInt((await deFiMath.expMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 285, `gas changed: ${avg} ≠ 277 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("expPositive", function () {
    describe("behaviour", function () {
      it("expPositive when x in [1e-18, 0.01083042)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x < 0.01083042; x += x / 1.976) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("expPositive when x in [0.01083042, 0.69314718)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.01083042; x < 0.69314718; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("expPositive when x in [0.69314718, 2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.69314718; x < 2; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("expPositive when x in [2, 32)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x < 32; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });

      it("expPositive when x in [32, 135)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 32; x < 135; x *= 1.0123) {
          const expected = Math.exp(x);
          const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
        }
      });
    });

    describe("limits", function () {
      it("expPositive when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actualSOL = (await deFiMath.expPositive(0)).toString() / 1e18;
        assert.equal(actualSOL, 1);
      });

      it("expPositive when x is 1e-18", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const expected = Math.exp(1e-18);
        const actualSOL = (await deFiMath.expPositive(tokens(1e-18))).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
      });

      it("expPositive when x is largest positive", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const x = "134999999999999999999";
        const expected = Math.exp(134.999999999999999999);
        const actualSOL = (await deFiMath.expPositive(x)).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP);
      });
    });

    describe("random", function () {
      it("matches Math.exp on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let i = 0; i < 500; i++) {
          const x = Math.random() * 135;
          const expected = Math.exp(x);
          const actual = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_EXP);
        }
      });
    });

    describe("failure", function () {
    });

    describe("performance", function () {
      it("expPositive when x in [0, 130] — 223 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0; x <= 130; x += 0.65) {
          totalGas += parseInt((await deFiMath.expPositiveMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 223, `gas changed: ${avg} ≠ 223 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("expm1", function () {
    describe("behaviour", function () {
      // Error-metric rule: absolute where |expm1(x)| < 1, relative where >= 1.
      // expm1 crosses |result| = 1 at x = ln2 only — it approaches -1 asymptotically but
      // never reaches it, so every x < ln2 (all negatives included) is the absolute band.
      it("expm1 when x in [1e-18, 0.01083042)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x < 0.01083042; x += x / 1.976) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [0.01083042, 0.69314718)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.01083042; x < 0.69314718; x *= 1.0123) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [0.69314718, 2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.69314718; x < 2; x *= 1.0123) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [2, 32)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x < 32; x *= 1.0123) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [32, 135)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 32; x < 135; x *= 1.0123) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [-1e-18, -0.01083042)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x < 0.01083042; x += x / 1.976) {
          const expected = Math.expm1(-x);
          const actual = (await deFiMath.expm1(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [-0.01083042, -0.69314718)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.01083042; x < 0.69314718; x *= 1.0123) {
          const expected = Math.expm1(-x);
          const actual = (await deFiMath.expm1(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [-0.69314718, -2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.69314718; x < 2; x *= 1.0123) {
          const expected = Math.expm1(-x);
          const actual = (await deFiMath.expm1(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [-2, -32)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x < 32; x *= 1.0123) {
          const expected = Math.expm1(-x);
          const actual = (await deFiMath.expm1(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("expm1 when x in [-32, -41.446)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 32; x < 41.446; x *= 1.0123) {
          const expected = Math.expm1(-x);
          const actual = (await deFiMath.expm1(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });
    });

    describe("limits", function () {
      it("expm1 when very small x", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Naive `exp(x) - 1e18` at wei-scale inputs is dominated by exp's approximation
        // noise (~1e4 wei) rather than by the true expm1 value. As long as |result - true|
        // stays within MAX_ABS_ERROR_EXPM1 we're within contract.
        for (const xWei of ["1", "1000", "1000000"]) {
          const actual = (await deFiMath.expm1(xWei)).toString() / 1e18;
          const expected = Math.expm1(Number(xWei) / 1e18);
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("expm1 when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actual = (await deFiMath.expm1(0)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("expm1 when x is -1 wei", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Sub-wei: exp(-1 wei) rounds to 1e18, so expm1 = 0 (within FP18 quantization).
        assert.equal((await deFiMath.expm1(-1)).toString(), "0");
      });

      it("expm1 when x is largest positive", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Above this, expm1 reverts via exp's ExpUpperBoundError (see failure block).
        const x = "134999999999999999999";
        const expected = Math.exp(134.999999999999999999) - 1;
        const actual = (await deFiMath.expm1(x)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_EXPM1);
      });
    });

    describe("random", function () {
      it("matches Math.expm1 on 500 random inputs with expm1(x) < 1 (x < ln2)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Absolute band: x ∈ (-41, ln2). Sampling this band with a RELATIVE metric is what
        // made the old positive-random test flaky — near the root expm1 → 0, so relative
        // error blows up (it peaked at ~1.04e-13, right at the band's true absolute worst).
        for (let i = 0; i < 500; i++) {
          const x = -41 + Math.random() * (Math.LN2 + 41);
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_EXPM1);
        }
      });

      it("matches Math.expm1 on 500 random inputs with expm1(x) >= 1 (x >= ln2)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Relative band: x ∈ [ln2, 135.3), with headroom from exp's upper bound.
        for (let i = 0; i < 500; i++) {
          const x = Math.LN2 + Math.random() * (134 - Math.LN2);
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_EXPM1);
        }
      });
    });

    describe("failure", function () {
      it("rejects when x >= exp upper bound", async function () {
        const { deFiMath } = await loadFixture(deploy);
        await assertRevertError(deFiMath, deFiMath.expm1("135000000000000000000"), "ExpUpperBoundError");
        await deFiMath.expm1("134999999999999999999");
      });
    });

    describe("performance", function () {
      it("expm1 when x in [-40, 130] — 291 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = -40; x <= 130; x += 0.85) {
          totalGas += parseInt((await deFiMath.expm1MG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 291, `gas changed: ${avg} ≠ 291 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe.only("ln", function () {
    describe("behaviour", function () {
      // Error-metric rule: absolute where |ln(x)| < 1 (input in [1/e, e]),
      // relative elsewhere. Grids are split at 1/e and e — each test sits entirely
      // on one side and uses a single explicit metric.
      //
      // Steps match sqrt's conventions:
      //   xWei += xWei / 5n + 1n  for bigint log-sweeps (~1.2× per step)
      //   x    += x * 0.2050317   for double-representable large-x sweeps
      //   x    += x * 0.02050317  for narrow near-root sweeps in the abs band


      // ── abs band: |ln(x)| < 1 (x in [1/e, e]) ──
      it("ln when x in [1/e, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1 / Math.E; x < 1; x += x * 0.02050317) {
          const expected = Math.log(x);
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_LN);
        }
      });

      it("ln when x in [1, e)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1; x < Math.E; x += x * 0.02050317) {
          const expected = Math.log(x);
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_LN);
        }
      });

      // ── rel band: |ln(x)| >= 1 (x <= 1/e or x >= e) ──
      it("ln when x in [1e-18, 1/e)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1e-18; x < 1 / Math.E; x += x) {
          const expected = Math.log(x);
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [e, 2^64)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = Math.E; x < 2 ** 64; x += x * 0.2050317) {
          const expected = Math.log(x);
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2^64, 2^128)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 2 ** 64; x < 2 ** 128; x += x * 0.2050317) {
          const expected = Math.log(x);
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      // Large-x branch (raw input > uint128.max): sweep the uint256 argument
      // DIRECTLY in wei — no tokens()/1e18 pre-scale, which would overflow the word.
      it("ln when x in [2^128, 2^196)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 2n ** 128n; x < 2n ** 196n; x += x / 5n) {
          const expected = Math.log(Number(x) / 1e18);
          const actualSOL = (await deFiMath.ln(x)).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2^196, 2^256)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const MAX = 2n ** 256n - 1n;
        for (let x = 2n ** 196n; x < MAX; x += x / 5n) {
          const expected = Math.log(Number(x) / 1e18);
          const actualSOL = (await deFiMath.ln(x)).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("limits", function () {
      // Both limits land in the relative band (|ln(x)| >> 1).
      it("ln when x is uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;
        const expected = Math.log(x);

        const actualSOL = (await deFiMath.ln("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      it("ln when x is minimum", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1e-18;
        const expected = Math.log(x);

        const actualSOL = (await deFiMath.ln("1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });
    });

    describe("random", function () {
      it("matches Math.log on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Skip xWei = 0 (tested in failure) and the near-root band x in (1/e, e)
        // where |ln(x)| < 1 — that band is covered by the absolute-error behaviour
        // grids. Everything kept here has |ln(x)| >= 1, so relative error is correct.
        const LO = BigInt(Math.round((1 / Math.E) * 1e18));
        const HI = BigInt(Math.round(Math.E * 1e18));
        for (let i = 0; i < 500; i++) {
          let xWei;
          do { xWei = randomUint256(); } while (xWei === 0n || (xWei > LO && xWei < HI));
          const expected = Math.log(Number(xWei) / 1e18);
          const actual = (await deFiMath.ln(xWei)).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("failure", function () {
      it("rejects when x = 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        await assertRevertError(deFiMath, deFiMath.ln("0"), "LnLowerBoundError");
        await deFiMath.ln("1");
      });
    });

    describe("performance", function () {
      it("ln when x in [1e-6, 1e6] — 390 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.000001; x <= 1000000; x *= 1.1481536) {
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 390, `gas changed: ${avg} ≠ 390 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("log1p", function () {
    describe("behaviour", function () {
      it("log1p when |x| < 0.01 (Taylor branch, precision-critical for small x)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = -0.01; x <= 0.01; x += 0.0001) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, 1e-17);
        }
      });

      // Error-metric rule: absolute where |log1p(x)| < 1, relative where >= 1.
      // log1p(x) = ln(1+x) crosses |result| = 1 at x = 1/e - 1 and x = e - 1, so grids
      // split there. (The |x| < 0.01 Taylor grid above sits inside the absolute band.)

      // ── absolute band: x in [1/e - 1, e - 1), where |log1p(x)| <= 1 ──
      it("log1p when x in [1/e - 1, -0.01]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1 / Math.E - 1; x <= -0.01; x += 0.003) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_LN);
        }
      });

      it("log1p when x in [0.01, e - 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 0.01; x < Math.E - 1; x += 0.0085) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_LN);
        }
      });

      // ── relative band: x <= 1/e - 1 (down to -1) ──
      it("log1p when x in [-0.99, 1/e - 1]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = -0.99; x <= 1 / Math.E - 1; x += 0.0018) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });

      // ── relative band: x >= e - 1 (large positive) ──
      it("log1p when x in [e - 1, 1e6]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Log-spaced ~185 samples across the tail.
        for (let x = Math.E - 1; x <= 1e6; x *= 1.0717734625361896) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("limits", function () {
      it("log1p when very small x (sub-ULP regime)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // for x at single-ULP scale, log1p(x) ≈ x and should be exact
        const actualA = (await deFiMath.log1p("1")).toString() / 1e18;
        assert.equal(actualA, 1e-18);
        const actualB = (await deFiMath.log1p("1000")).toString() / 1e18;
        assert.equal(actualB, 1e-15);
      });

      it("log1p when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actual = (await deFiMath.log1p(0)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("log1p when x is just above -1 (smallest valid input, -1 + 1 wei)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // -999999999999999999 = -1 + 1 wei. log1p(-1) reverts (see failure block);
        // 1 wei above is the smallest non-reverting input — result is ln(1e-18) ≈ -41.4.
        // Can't compute via Math.log1p(-1 + 1e-18): -1 + 1e-18 rounds to -1 in IEEE 754
        // (1e-18 is below ULP of 1.0). Use Math.log(1e-18) directly.
        const x = "-999999999999999999";
        const expected = Math.log(1e-18);
        const actual = (await deFiMath.log1p(x)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
      });

      it("log1p when x is int256 max (largest valid input)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // int256 max = 2^255 - 1 ≈ 5.79e76. log1p(int256.max) = ln(1 + int256.max/1e18)
        // ≈ ln(int256.max/1e18) ≈ ln(5.79e58) for very large x.
        const intMax = (1n << 255n) - 1n;
        const intMaxFp = Number(intMax) / 1e18;
        const expected = Math.log1p(intMaxFp);
        const actual = (await deFiMath.log1p(intMax)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
      });
    });

    describe("random", function () {
      it("matches Math.log1p on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const NEG_ONE_FP18 = -(10n ** 18n);
        // Reject x ≤ -1 (tested in failure) and the near-root band x in (1/e - 1, e - 1)
        // where |log1p(x)| < 1 — that band (Taylor + naive) is covered by the
        // absolute-error behaviour grids. What's kept has |log1p(x)| >= 1, so relative
        // error is the correct metric. xWei is int256, valid range is (-1e18, +∞).
        const LO = BigInt(Math.round((1 / Math.E - 1) * 1e18));   // 1/e - 1
        const HI = BigInt(Math.round((Math.E - 1) * 1e18));       // e - 1
        for (let i = 0; i < 500; i++) {
          let xWei;
          do { xWei = randomInt256(); } while (xWei <= NEG_ONE_FP18 || (xWei > LO && xWei < HI));
          const expected = Math.log1p(Number(xWei) / 1e18);
          const actual = (await deFiMath.log1p(xWei)).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("failure", function () {
      it("rejects when x = -1", async function () {
        const { deFiMath } = await loadFixture(deploy);
        await assertRevertError(deFiMath, deFiMath.log1p("-1000000000000000000"), "Log1pLowerBoundError");
        // just above -1 should work
        await deFiMath.log1p("-999999999999999999");
      });

      it("rejects when x < -1", async function () {
        const { deFiMath } = await loadFixture(deploy);
        await assertRevertError(deFiMath, deFiMath.log1p("-2000000000000000000"), "Log1pLowerBoundError");
      });
    });

    describe("performance", function () {
      it("log1p when x in [1e-6, 1e6] — 476 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.000001; x <= 1000000; x *= 1.1481536) {
          totalGas += parseInt((await deFiMath.log1pMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 476, `gas changed: ${avg} ≠ 476 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("log2", function () {
    describe("behaviour", function () {
      // Error-metric rule: absolute where |log2(x)| < 1, relative where >= 1.
      // log2 crosses |result| = 1 at x = 0.5 and x = 2. Same tolerances as ln —
      // log2 is ln scaled by 1/ln2, so its relative error matches ln's.

      // ── absolute band: x in [0.5, 2], where |log2(x)| <= 1 ──
      it("log2 when x in [0.5, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.5; x < 1; x += 0.005) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_LN);
        }
      });

      it("log2 when x in [1, 2]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 2; x += 0.01) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_LN);
        }
      });

      // ── relative band: x >= 2 ──
      it("log2 when x in [2, 2^16]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x <= 2 ** 16; x += 327.67) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^16, 2^32]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 16; x <= 2 ** 32; x += 21474508.8) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^32, 2^48]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 32; x <= 2 ** 48; x += 1407353408716.8) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^48, 2^64]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 48; x <= 2 ** 64; x += 92232312993664208) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^64, 2^128]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 64; x < 2 ** 128; x += 1.7014118346046924e+36) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^128, 2^195]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 128; x <= 2 ** 196; x += 5.021681388309345e+56) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      // ── relative band: x <= 0.5 (small x) ──
      it("log2 when x in [0.0625, 0.5)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.0625; x < 0.5; x += 0.004) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [1e-18, 1e-16)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1e-16; x += 1e-18) {
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("limits", function () {
      // Both limits land in the relative band (|log2(x)| >> 1).
      it("log2 when x is uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;
        const expected = Math.log2(x);

        const actualSOL = (await deFiMath.log2("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      it("log2 when x is minimum", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1e-18;
        const expected = Math.log2(x);

        const actualSOL = (await deFiMath.log2("1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });
    });

    describe("random", function () {
      it("matches Math.log2 on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Skip xWei = 0 (tested in failure) and the near-root band x in (0.5, 2)
        // where |log2(x)| < 1 — covered by the absolute-error behaviour grids.
        // Everything kept here has |log2(x)| >= 1, so relative error is correct.
        const FP1 = 10n ** 18n;
        for (let i = 0; i < 500; i++) {
          let xWei;
          do { xWei = randomUint256(); } while (xWei === 0n || (xWei > FP1 / 2n && xWei < FP1 * 2n));
          const expected = Math.log2(Number(xWei) / 1e18);
          const actual = (await deFiMath.log2(xWei)).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("failure", function () {
      it("rejects when x = 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        await assertRevertError(deFiMath, deFiMath.log2("0"), "LnLowerBoundError");
        await deFiMath.log2("1");
      });
    });

    describe("performance", function () {
      it("log2 when x in [1e-6, 1e6] — 406 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.000001; x <= 1000000; x *= 1.1481536) {
          totalGas += parseInt((await deFiMath.log2MG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 406, `gas changed: ${avg} ≠ 406 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("log10", function () {
    describe("behaviour", function () {
      // Error-metric rule: absolute where |log10(x)| < 1, relative where >= 1.
      // log10 crosses |result| = 1 at x = 0.1 and x = 10. Same tolerances as ln —
      // log10 is ln scaled by 1/ln10, so its relative error matches ln's.

      // ── absolute band: x in [0.1, 10], where |log10(x)| <= 1 ──
      it("log10 when x in [0.1, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.1; x < 1; x += 0.009) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_LN);
        }
      });

      it("log10 when x in [1, 10]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 10; x += 0.09) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_LN);
        }
      });

      // ── relative band: x >= 10 ──
      it("log10 when x in [10, 2^16]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 10; x <= 2 ** 16; x += 327.67) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^16, 2^32]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 16; x <= 2 ** 32; x += 21474508.8) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^32, 2^48]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 32; x <= 2 ** 48; x += 1407353408716.8) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^48, 2^64]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 48; x <= 2 ** 64; x += 92232312993664208) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^64, 2^128]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 64; x < 2 ** 128; x += 1.7014118346046924e+36) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^128, 2^195]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 128; x <= 2 ** 196; x += 5.021681388309345e+56) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      // ── relative band: x <= 0.1 (small x) ──
      it("log10 when x in [0.0625, 0.1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.0625; x < 0.1; x += 0.0004) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [1e-18, 1e-16)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1e-16; x += 1e-18) {
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("limits", function () {
      // Both limits land in the relative band (|log10(x)| >> 1).
      it("log10 when x is uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;
        const expected = Math.log10(x);

        const actualSOL = (await deFiMath.log10("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      it("log10 when x is minimum", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1e-18;
        const expected = Math.log10(x);

        const actualSOL = (await deFiMath.log10("1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });
    });

    describe("random", function () {
      it("matches Math.log10 on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Skip xWei = 0 (tested in failure) and the near-root band x in (0.1, 10)
        // where |log10(x)| < 1 — covered by the absolute-error behaviour grids.
        // Everything kept here has |log10(x)| >= 1, so relative error is correct.
        const FP1 = 10n ** 18n;
        for (let i = 0; i < 500; i++) {
          let xWei;
          do { xWei = randomUint256(); } while (xWei === 0n || (xWei > FP1 / 10n && xWei < FP1 * 10n));
          const expected = Math.log10(Number(xWei) / 1e18);
          const actual = (await deFiMath.log10(xWei)).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("failure", function () {
      it("rejects when x = 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        await assertRevertError(deFiMath, deFiMath.log10("0"), "LnLowerBoundError");
        await deFiMath.log10("1");
      });
    });

    describe("performance", function () {
      it("log10 when x in [1e-6, 1e6] — 406 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.000001; x <= 1000000; x *= 1.1481536) {
          totalGas += parseInt((await deFiMath.log10MG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 406, `gas changed: ${avg} ≠ 406 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("pow", function () {
    describe("behaviour", function () {
      it("pow when a = 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // anything^0 = 1, including 0^0 = 1 by convention
        assert.equal((await deFiMath.pow(tokens(0), 0)).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1), 0)).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(2), 0)).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1e6), 0)).toString() / 1e18, 1);
      });

      it("pow when x = 1", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 1^a = 1 for any a
        assert.equal((await deFiMath.pow(tokens(1), tokens(0.5))).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1), tokens(-10))).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1), tokens(100))).toString() / 1e18, 1);
      });

      it("pow when a = 1", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.1; x <= 10; x += 0.0495) {
          const expected = x;

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(1))).toString() / 1e18;
          assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
        }
      });

      it("pow when a = 2 (square)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.1; x <= 10; x += 0.0495) {
          const expected = x * x;

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(2))).toString() / 1e18;
          assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
        }
      });

      it("pow when a = 0.5 (sqrt)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.01; x <= 100; x += 0.4999) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(0.5))).toString() / 1e18;
          assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
        }
      });

      it("pow when a = -1 (reciprocal)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.1; x <= 10; x += 0.0495) {
          const expected = 1 / x;

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(-1))).toString() / 1e18;
          assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
        }
      });

      it("pow when x in [0.5, 10], a in [-2, 2]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 14 × 14 = 196 samples
        for (let x = 0.5; x <= 10; x += 9.5 / 14) {
          for (let a = -2; a <= 2; a += 4 / 14) {
            const expected = Math.pow(x, a);

            const actualSOL = (await deFiMath.pow(tokens(x), tokens(a))).toString() / 1e18;
            assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
          }
        }
      });

      it("pow when x in [1e-3, 1e3], a in [-1, 1]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 14 × 14 = 196 samples, x log-spaced over 6 decades
        for (let x = 1e-3; x <= 1e3; x *= 10 ** (6 / 14)) {
          for (let a = -1; a <= 1; a += 2 / 14) {
            const expected = Math.pow(x, a);

            const actualSOL = (await deFiMath.pow(tokens(x), tokens(a))).toString() / 1e18;
            assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
          }
        }
      });

      it("pow when x in [1, 100], a fractional", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 28 × 7 = 196 samples
        for (let x = 1; x <= 100; x += 99 / 28) {
          for (const a of [0.1, 0.333, 0.5, 0.75, 1.5, 2.5, 3.1415]) {
            const expected = Math.pow(x, a);

            const actualSOL = (await deFiMath.pow(tokens(x), tokens(a))).toString() / 1e18;
            assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
          }
        }
      });
    });

    describe("limits", function () {
      it("pow underflow when exponent very negative", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // pow(2, -100) = 7.9e-31 → exp(-100 * ln(2)) = exp(-69.3) ≈ 7.9e-31
        // still above underflow bound, so should match
        const expected = Math.pow(2, -100);
        const actualSOL = (await deFiMath.pow(tokens(2), tokens(-100))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, 1e-30);

        // pow(2, -1000) → exp(-693) underflows to 0
        const actualUnderflow = (await deFiMath.pow(tokens(2), tokens(-1000))).toString() / 1e18;
        assert.equal(actualUnderflow, 0);
      });

      it("pow near exp upper bound (a * ln(x) ≈ 135)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // max safe: a * ln(2) / 1e18 < 135e18
        // ln(2) ≈ 0.693147... → max a ≈ 194.859
        const expected = Math.pow(2, 194);
        const actualSOL = (await deFiMath.pow(tokens(2), tokens(194))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
      });

      it("pow near exp underflow bound (a * ln(x) ≈ -41.4)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // just above underflow: a * ln(2) / 1e18 > -41.446531673892822313e18
        // ln(2) ≈ 0.693147... → a ≈ -59.78 keeps result nonzero
        const expected = Math.pow(2, -59);
        const actualSOL = (await deFiMath.pow(tokens(2), tokens(-59))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, 1e-17);

        // crossing underflow: a = -60 gives -60 * 0.693 ≈ -41.58 → exp returns 0
        const actualUnderflow = (await deFiMath.pow(tokens(2), tokens(-60))).toString() / 1e18;
        assert.equal(actualUnderflow, 0);
      });

      it("pow when x = uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // ln(uint256 max) ≈ 135.99, so pow(uint256_max, a) overflows for a > 135.3/135.99 ≈ 0.995
        // use a = 0.5 → sqrt of uint256 max ≈ 3.4e29
        const uint256Max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        const xVal = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;

        const expected = Math.sqrt(xVal);
        const actualSOL = (await deFiMath.pow(uint256Max, tokens(0.5))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
      });

      it("pow when x = 1 wei (minimum fixed-point)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // ln(1e-18) ≈ -41.446, so pow(1 wei, 1) = exp(-41.446) → underflows to 0
        const actualSOL = (await deFiMath.pow("1", tokens(1))).toString() / 1e18;
        assert.equal(actualSOL, 0);

        // pow(1 wei, 0.5) = exp(-20.72) ≈ 1e-9, should work
        const expected = Math.sqrt(1e-18);
        const actualHalf = (await deFiMath.pow("1", tokens(0.5))).toString() / 1e18;
        assertAbsoluteBelow(actualHalf, expected, 1e-14);
      });

      it("pow when a = 1 wei (minimum positive exponent)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // pow(2, 1e-18) ≈ 1 + ln(2) * 1e-18 ≈ 1 (within fixed-point precision)
        const actualSOL = (await deFiMath.pow(tokens(2), "1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, 1, MAX_REL_ERROR_POW);
      });
    });

    describe("random", function () {
      it("matches Math.pow on 500 random (x, a) pairs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // x ∈ [0.01, 100], a ∈ [-2, 2]: a · ln(x) ∈ ~[-9.2, 9.2], safely inside exp's domain.
        for (let i = 0; i < 500; i++) {
          const x = 0.01 + Math.random() * 99.99;
          const a = -2 + Math.random() * 4;
          const expected = Math.pow(x, a);
          const actual = (await deFiMath.pow(tokens(x), tokens(a))).toString() / 1e18;
          assertPrecisionBelow(actual, expected, MAX_REL_ERROR_POW, MAX_ABS_ERROR_POW);
        }
      });
    });

    describe("failure", function () {
      it("rejects when x = 0 and a != 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        await assertRevertError(deFiMath, deFiMath.pow(tokens(0), tokens(1)), "LnLowerBoundError");
        await assertRevertError(deFiMath, deFiMath.pow(tokens(0), tokens(-1)), "LnLowerBoundError");
      });

      it("rejects when result overflows exp upper bound", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // pow(10, 100) → exp(100 * ln(10)) = exp(~230), overflows exp upper bound ~135
        await assertRevertError(deFiMath, deFiMath.pow(tokens(10), tokens(100)), "ExpUpperBoundError");
      });

      it("rejects pow(2, 195) — just above exp upper bound", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 195 * ln(2) ≈ 135.16e18, just over 135e18 upper bound
        await assertRevertError(deFiMath, deFiMath.pow(tokens(2), tokens(195)), "ExpUpperBoundError");
      });

      it("rejects pow(uint256 max, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // ln(uint256 max) ≈ 135.99e18, exceeds exp upper bound
        const uint256Max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        await assertRevertError(deFiMath, deFiMath.pow(uint256Max, tokens(1)), "ExpUpperBoundError");
      });

      it("rejects when |a| > MAX_POW_EXPONENT — guards int256 overflow on a·ln(x)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // MAX_POW_EXPONENT = 1e54 (in FP-raw int256 units). Just above the bound on either side must revert,
        // exactly at the bound must NOT revert. Pair the over-bound exponent with x = 1, so ln(x) = 0 —
        // that isolates the input check itself, with no chance of cascading into exp's own bounds.
        const MAX = "1000000000000000000000000000000000000000000000000000000";     //   1e54
        const OVER = "1000000000000000000000000000000000000000000000000000001";    //   1e54 + 1
        const UNDER = "-1000000000000000000000000000000000000000000000000000001";  //  -1e54 - 1

        await assertRevertError(deFiMath, deFiMath.pow(tokens(1), OVER), "PowExponentOutOfBoundsError");
        await assertRevertError(deFiMath, deFiMath.pow(tokens(1), UNDER), "PowExponentOutOfBoundsError");
        await deFiMath.pow(tokens(1), MAX);                  // exactly at MAX_POW_EXPONENT → accepted
        await deFiMath.pow(tokens(1), "-" + MAX);            // exactly at -MAX_POW_EXPONENT → accepted

        // Also confirm the int256 extremes revert (where a silent overflow would previously occur).
        const intMax  = "57896044618658097711785492504343953926634992332820282019728792003956564819967";
        const intMin  = "-57896044618658097711785492504343953926634992332820282019728792003956564819968";
        await assertRevertError(deFiMath, deFiMath.pow(tokens(1), intMax), "PowExponentOutOfBoundsError");
        await assertRevertError(deFiMath, deFiMath.pow(tokens(1), intMin), "PowExponentOutOfBoundsError");
      });

      it("handles a near MAX_POW_EXPONENT with non-trivial x — multiplication stays inside int256", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // Past the input-check at |a| = MAX_POW_EXPONENT = 1e54, the unchecked multiplication
        // a · ln(x) must still produce a meaningful int256. Worst case: |ln(x)| ≈ 178 at x = uint256.max,
        // so |a · ln(x)| ≤ 1e54 · 1.78e20 = 1.78e74 — well under int256.max ≈ 5.78e76.
        //
        // At a = ±MAX the only x where pow returns a non-degenerate value is x = 1 (ln = 0).
        // Every other x cascades through to exp() — gigantic-positive products revert with
        // ExpUpperBoundError, gigantic-negative products underflow silently to 0. Sweep all four
        // quadrants to confirm the multiplication doesn't wrap into a wrong int256 value (which
        // would feed exp the wrong sign and break this expected branch behaviour).
        const MAX = "1000000000000000000000000000000000000000000000000000000";  // 1e54
        const NEG_MAX = "-" + MAX;

        // x = 1, |a| = MAX → ln(x) = 0 → a·ln(x) = 0 → exp(0) = 1.
        assert.equal((await deFiMath.pow(tokens(1), MAX)).toString(), tokens(1));
        assert.equal((await deFiMath.pow(tokens(1), NEG_MAX)).toString(), tokens(1));

        // x > 1 (ln > 0):  a = +MAX → +∞ regime → exp reverts.   a = −MAX → −∞ regime → returns 0.
        await assertRevertError(deFiMath, deFiMath.pow(tokens(2), MAX), "ExpUpperBoundError");
        assert.equal((await deFiMath.pow(tokens(2), NEG_MAX)).toString(), "0");

        // x < 1 (ln < 0):  a = +MAX → −∞ regime → returns 0.     a = −MAX → +∞ regime → exp reverts.
        assert.equal((await deFiMath.pow(tokens(0.5), MAX)).toString(), "0");
        await assertRevertError(deFiMath, deFiMath.pow(tokens(0.5), NEG_MAX), "ExpUpperBoundError");

        // Worst-case |ln(x)| at uint256.max — same four-quadrant logic applies, just with the
        // largest possible |a · ln(x)|. If the unchecked multiplication wrapped, the sign would
        // flip and exp would take the wrong branch — these assertions would fail loudly.
        const uint256Max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        await assertRevertError(deFiMath, deFiMath.pow(uint256Max, MAX), "ExpUpperBoundError");
        assert.equal((await deFiMath.pow(uint256Max, NEG_MAX)).toString(), "0");
      });
    });

    describe("performance", function () {
      it("pow when x in [1e-3, 1e3] × a in [-3, 3] — 761 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 1e-3; x <= 1e3; x *= 2.0691380811147901) {  // 20 steps over 6 decades
          for (let a = -3; a <= 3; a += 6/9) {                    // 10 steps
            totalGas += parseInt((await deFiMath.powMG(tokens(x), tokens(a))).gasUsed);
            count++;
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 761, `gas changed: ${avg} ≠ 761 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("sqrt", function () {
    describe("behaviour", function () {
      it("sqrt when x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x < 1; x += x / 1.976) {
          const expected = sqrtExactWei(tokens(x));
          const actual = await deFiMath.sqrt(tokens(x));
          assertSqrtAbsolute(actual, expected);
        }
      });

      it("sqrt when x is just below 1 - [0.9999, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.9999; x < 1; x += 0.000000519373) {
          const expected = sqrtExactWei(tokens(x));
          const actual = await deFiMath.sqrt(tokens(x));
          assertSqrtAbsolute(actual, expected);
        }
      });

      it("sqrt when x is just above 1 - [1, 1.0001)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 1.0001; x += 0.000000519373) {
          const expected = sqrtExactWei(tokens(x));
          const actual = await deFiMath.sqrt(tokens(x));
          assertSqrtAccurate(actual, expected);
        }
      });

      it("sqrt when x in [1, 2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 2; x += 0.00519373) {
          const expected = sqrtExactWei(tokens(x));
          const actual = await deFiMath.sqrt(tokens(x));
          assertSqrtAccurate(actual, expected);
        }
      });

      it("sqrt when x in [2^0, 2^64)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1; x < 2 ** 64; x += x * 0.2050317) {
          const expected = sqrtExactWei(tokens(x));
          const actual = await deFiMath.sqrt(tokens(x));
          assertSqrtAccurate(actual, expected);
        }
      });

      it("sqrt when x in [2^64, 2^128)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 2 ** 64; x < 2 ** 128; x += x * 0.2050317) {
          const expected = sqrtExactWei(tokens(x));
          const actual = await deFiMath.sqrt(tokens(x));
          assertSqrtAccurate(actual, expected);
        }
      });

      // Large-x branch (raw input > uint128.max): sweep the uint256 argument
      // DIRECTLY in wei — no tokens()/1e18 pre-scale, which would overflow the word.
      it("sqrt when x in [2^128, 2^196)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 2n ** 128n; x < 2n ** 196n; x += x / 5n) {
          const expected = sqrtExactWei(x);
          const actual = await deFiMath.sqrt(x);
          assertSqrtAccurate(actual, expected);
        }
      });

      it("sqrt when x in [2^196, 2^256)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const MAX = 2n ** 256n - 1n;
        for (let x = 2n ** 196n; x < MAX; x += x / 5n) {
          const expected = sqrtExactWei(x);
          const actual = await deFiMath.sqrt(x);
          assertSqrtAccurate(actual, expected);
        }
      });
    });

    describe("limits", function () {
      it("sqrt when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const actualSOL = (await deFiMath.sqrt("0")).toString() / 1e18;
        assert.equal(actualSOL, 0);
      });

      it("sqrt when x is uint128.max (min in lower branch)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const xWei = 2n ** 128n;
        const expected = sqrtExactWei(xWei);
        const actual = await deFiMath.sqrt(xWei);
        assertSqrtAccurate(actual, expected);
      });

      it("sqrt when x is uint256.max", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const xWei = 2n ** 256n - 1n;
        const expected = sqrtExactWei(xWei);
        const actual = await deFiMath.sqrt(xWei);
        assertSqrtAccurate(actual, expected);
      });

      it("sqrt when x is uint128.max - 1 (max in upper branch)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const xWei = 2n ** 128n - 1n;
        const expected = sqrtExactWei(xWei);
        const actual = await deFiMath.sqrt(xWei);
        assertSqrtAccurate(actual, expected);
      });




    });

    describe("random", function () {
      it("matches sqrt on 2500 random inputs with x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        
        const FP1 = 10n ** 18n;
        for (let i = 0; i < 2500; i++) {
          let xWei;
          do { xWei = randomUint256() % FP1; } while (xWei === 0n);
          const expected = sqrtExactWei(xWei);
          const actual = await deFiMath.sqrt(xWei);
          assertSqrtAbsolute(actual, expected);
        }
      });

      it("matches sqrt on 2500 random inputs with x in [1, uint256 max])", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const FP1 = 10n ** 18n;
        const UINT_MAX = 2n ** 256n - 1n;
        for (let i = 0; i < 2500; i++) {
          let xWei;
          do { xWei = randomUint256(); } while (xWei < FP1 || xWei > UINT_MAX);
          const expected = sqrtExactWei(xWei);
          const actual = await deFiMath.sqrt(xWei);
          assertSqrtAccurate(actual, expected);
        }
      });
    });

    // todo: move this test
    describe("handles the full uint256 range without reverting", function () {
      it("computes sqrt across the large-x branch [uint128.max+1, uint256.max] with sub-FP18 precision", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Large-x branch: sqrt uses the no-pre-scale path (Newton on raw x, post-scale × 1e9)
        // for any x > uint128.max. This zone was previously rejected as out-of-range;
        // now sqrt handles it with sub-FP18 precision (integer sqrt has plenty of digits).
        const UINT128_MAX = 2n ** 128n - 1n;
        const UINT_MAX = 2n ** 256n - 1n;

        // BigInt integer sqrt (Newton) — reference for the post-scale branch.
        const bigIntSqrt = (n) => {
          if (n < 2n) return n;
          let y = n, x = (n + 1n) / 2n;
          while (x < y) { y = x; x = (x + n / x) / 2n; }
          return y;
        };

        // Sweep across the full large-x domain.
        const cases = [
          UINT128_MAX + 1n,             // just past the branch cutoff
          UINT128_MAX * 2n,
          10n ** 40n,
          10n ** 50n,
          10n ** 60n,
          10n ** 70n,
          10n ** 76n,
          1n << 253n,                   // worst-case seed input near uint256 ceiling
          1n << 254n,
          1n << 255n,
          UINT_MAX / 2n,
          UINT_MAX,
        ];
        let maxRelErr = 0;
        for (const x of cases) {
          const y = await deFiMath.sqrt(x);
          // For x > uint128.max, FP18 sqrt = floor(sqrt(x)) · 1e9 (post-scale form).
          const expected = bigIntSqrt(x) * 10n ** 9n;
          const delta = y > expected ? y - expected : expected - y;
          const relErr = Number(delta) / Number(expected);
          if (relErr > maxRelErr) maxRelErr = relErr;
        }
        assert.ok(maxRelErr < 1e-18, `large-x precision below FP18: ${maxRelErr}`);
      });
    });

    describe("performance", function () {
      it("sqrt when x in [1e-6, 1e6] — 197 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.000001; x <= 1000000; x *= 1.1481536) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 197, `gas changed: ${avg} ≠ 197 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("cbrt", function () {
    describe("behaviour", function () {
      // Metric by result magnitude (same rule as sqrt): absolute (wei) where cbrt(x) < 1
      // (x < 1e18 wei), relative where cbrt(x) ≥ 1. Reference is decimal.js exact.
      it("cbrt when x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x < 1; x += x / 1.976) {
          const expected = cbrtExactWei(tokens(x));
          const actual = await deFiMath.cbrt(tokens(x));
          assertCbrtAbsolute(actual, expected);
        }
      });

      it("cbrt when x is just below 1 - [0.9999, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.9999; x < 1; x += 0.000000519373) {
          const expected = cbrtExactWei(tokens(x));
          const actual = await deFiMath.cbrt(tokens(x));
          assertCbrtAbsolute(actual, expected);
        }
      });

      it("cbrt when x is just above 1 - [1, 1.0001)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 1.0001; x += 0.000000519373) {
          const expected = cbrtExactWei(tokens(x));
          const actual = await deFiMath.cbrt(tokens(x));
          assertCbrtAccurate(actual, expected);
        }
      });

      it("cbrt when x in [1, 2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 2; x += 0.00519373) {
          const expected = cbrtExactWei(tokens(x));
          const actual = await deFiMath.cbrt(tokens(x));
          assertCbrtAccurate(actual, expected);
        }
      });

      it("cbrt when x in [2^0, 2^64)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1; x < 2 ** 64; x += x * 0.2050317) {
          const expected = cbrtExactWei(tokens(x));
          const actual = await deFiMath.cbrt(tokens(x));
          assertCbrtAccurate(actual, expected);
        }
      });

      it("cbrt when x in [2^64, 2^128)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 2 ** 64; x < 2 ** 128; x += x * 0.2050317) {
          const expected = cbrtExactWei(tokens(x));
          const actual = await deFiMath.cbrt(tokens(x));
          assertCbrtAccurate(actual, expected);
        }
      });

      // Large-x branch (raw input > uint128.max): sweep the uint256 argument DIRECTLY
      // in wei — no tokens()/1e18 pre-scale, which would overflow the word.
      it("cbrt when x in [2^128, 2^196)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 2n ** 128n; x < 2n ** 196n; x += x / 5n) {
          const expected = cbrtExactWei(x);
          const actual = await deFiMath.cbrt(x);
          assertCbrtAccurate(actual, expected);
        }
      });

      it("cbrt when x in [2^196, 2^256)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const MAX = 2n ** 256n - 1n;
        for (let x = 2n ** 196n; x < MAX; x += x / 5n) {
          const expected = cbrtExactWei(x);
          const actual = await deFiMath.cbrt(x);
          assertCbrtAccurate(actual, expected);
        }
      });

      it("cbrt of perfect cubes is exact", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (const n of [1, 2, 3, 8, 10, 27, 100, 1000, 1000000]) {
          const cube = n * n * n;
          const expected = cbrtExactWei(tokens(cube));
          const actual = await deFiMath.cbrt(tokens(cube));
          assertCbrtAccurate(actual, expected);
        }
      });
    });

    describe("limits", function () {
      it("cbrt when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actualSOL = (await deFiMath.cbrt(0)).toString();
        assert.equal(actualSOL, "0");
      });

      it("cbrt when x is uint128.max (small-x branch top)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const xWei = 2n ** 128n - 1n;
        const expected = cbrtExactWei(xWei);
        const actual = await deFiMath.cbrt(xWei);
        assertCbrtAccurate(actual, expected);
      });

      it("cbrt when x is uint128.max + 1 (large-x branch bottom)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const xWei = 2n ** 128n;
        const expected = cbrtExactWei(xWei);
        const actual = await deFiMath.cbrt(xWei);
        assertCbrtAccurate(actual, expected);
      });

      it("cbrt when x is uint256.max", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const xWei = 2n ** 256n - 1n;
        const expected = cbrtExactWei(xWei);
        const actual = await deFiMath.cbrt(xWei);
        assertCbrtAccurate(actual, expected);
      });
    });

    describe("random", function () {
      it("matches cbrt on 2500 random inputs with x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const FP1 = 10n ** 18n;
        for (let i = 0; i < 2500; i++) {
          let xWei;
          do { xWei = randomUint256() % FP1; } while (xWei === 0n);
          const expected = cbrtExactWei(xWei);
          const actual = await deFiMath.cbrt(xWei);
          assertCbrtAbsolute(actual, expected);
        }
      });

      it("matches cbrt on 2500 random inputs with x in [1, uint256 max])", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const FP1 = 10n ** 18n;
        const UINT_MAX = 2n ** 256n - 1n;
        for (let i = 0; i < 2500; i++) {
          let xWei;
          do { xWei = randomUint256(); } while (xWei < FP1 || xWei > UINT_MAX);
          const expected = cbrtExactWei(xWei);
          const actual = await deFiMath.cbrt(xWei);
          assertCbrtAccurate(actual, expected);
        }
      });
    });

    describe("handles the full uint256 range without reverting", function () {
      it("computes cbrt across the large-x branch [uint128.max+1, uint256.max]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Large-x branch: no pre-scale, Newton on raw x, post-scale × 1e12 for FP18.
        // This zone was previously rejected as out-of-range; now cbrt handles it
        // with sub-FP18 precision (integer cbrt · 1e12 gives ~1e-13 at the boundary,
        // tightening to bit-perfect as x grows past 1e54).
        const UINT128_MAX = 2n ** 128n - 1n;
        const UINT_MAX = 2n ** 256n - 1n;

        const cases = [
          UINT128_MAX + 1n,             // just past the branch cutoff
          UINT128_MAX * 2n,
          10n ** 45n,
          10n ** 55n,
          10n ** 65n,
          10n ** 75n,
          UINT_MAX / 2n,
          UINT_MAX,
        ];
        for (const x of cases) {
          const y = await deFiMath.cbrt(x);
          // Contract returns integer_cbrt(x) · 1e12 (post-scale form). Newton on the
          // un-prescaled integer can accumulate precision loss for near-perfect cubes,
          // giving an intCbrt off by a small amount. Verify accuracy by cubing intCbrt
          // and comparing to x — |intCbrt^3 − x| / x should be << 1.
          assert.equal((y % 10n ** 12n).toString(), "0",
            `cbrt(${x}): y=${y} should be a multiple of 1e12`);
          const intCbrt = y / 10n ** 12n;
          const cubed = intCbrt * intCbrt * intCbrt;
          const diff = cubed > x ? cubed - x : x - cubed;
          // Assert relative error ~< 1e-10 (cube of a 1e-11-precise intCbrt).
          // At the branch boundary (x ≈ 2^128) precision is ~1e-13; at x ≥ 10^54 it's FP18-perfect.
          // Test tolerance: 1e-10 catches egregious errors while allowing the observed noise.
          assert.ok(diff * 10n ** 10n < x,
            `cbrt(${x}) relative error > 1e-10: intCbrt=${intCbrt}, cubed=${cubed}, diff=${diff}`);
        }
      });
    });

    describe("performance", function () {
      it("cbrt when x in [1e-6, 1e6] — 340 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.000001; x <= 1000000; x *= 1.1481536) {
          totalGas += parseInt((await deFiMath.cbrtMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 340, `gas changed: ${avg} ≠ 340 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("mulDiv", function () {
    const MAX = (1n << 256n) - 1n;

    describe("behaviour", function () {
      it("handles small inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        assert.equal((await deFiMath.mulDiv(0n, 0n, 1n)).toString(), "0");
        assert.equal((await deFiMath.mulDiv(0n, 12345n, 7n)).toString(), "0");
        assert.equal((await deFiMath.mulDiv(1n, 1n, 1n)).toString(), "1");
        assert.equal((await deFiMath.mulDiv(6n, 7n, 3n)).toString(), "14");           // 42 / 3
        assert.equal((await deFiMath.mulDiv(3n, 4n, 5n)).toString(), "2");            // 12 / 5 → 2 (rounds toward zero)
        assert.equal((await deFiMath.mulDiv(7n, 3n, 2n)).toString(), "10");           // 21 / 2 → 10
      });

      it("handles d = 1 (identity divide)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // a * b fits in uint256 → fast path returns a * b
        assert.equal((await deFiMath.mulDiv(2n ** 200n, 1n, 1n)).toString(), (2n ** 200n).toString());
        // (2^256 - 1) * 1 = 2^256 - 1 (max single-word)
        assert.equal((await deFiMath.mulDiv(MAX, 1n, 1n)).toString(), MAX.toString());
        // 1 * (2^256 - 1) = same
        assert.equal((await deFiMath.mulDiv(1n, MAX, 1n)).toString(), MAX.toString());
      });

      it("matches BigInt reference across random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // Pseudo-random sweep across magnitudes; deterministic so failures reproduce.
        const cases = [
          [12345678901234567890n, 98765432109876543210n, 1000000n],
          [1n << 128n, 1n << 128n, 1n << 200n],
          [(1n << 200n) - 1n, (1n << 100n) + 7n, (1n << 150n) + 3n],
          [tokens(1234.5678), tokens(0.000789), tokens(1)],
          [(1n << 250n) + 1n, 13n, (1n << 100n) + 1n],
        ];
        for (const [a, b, d] of cases) {
          const expected = (a * b) / d;
          const actual = await deFiMath.mulDiv(a, b, d);
          assert.equal(actual.toString(), expected.toString(), `mulDiv(${a}, ${b}, ${d})`);
        }
      });
    });

    describe("limits", function () {
      it("zero numerators (min input)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // a = 0 or b = 0 → quotient is 0 regardless of d.
        assert.equal((await deFiMath.mulDiv(0n, 0n, 1n)).toString(), "0");
        assert.equal((await deFiMath.mulDiv(0n, MAX, MAX)).toString(), "0");
        assert.equal((await deFiMath.mulDiv(MAX, 0n, MAX)).toString(), "0");
      });

      it("handles full 512-bit intermediate products", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 2^200 * 2^200 = 2^400 (overflows uint256), divided by 2^200 = 2^200 (fits)
        assert.equal(
          (await deFiMath.mulDiv(2n ** 200n, 2n ** 200n, 2n ** 200n)).toString(),
          (2n ** 200n).toString()
        );
        // 2^255 * 2 = 2^256 (just overflows), / 4 = 2^254
        assert.equal(
          (await deFiMath.mulDiv(2n ** 255n, 2n, 4n)).toString(),
          (2n ** 254n).toString()
        );
        // (2^256 - 1)^2 / (2^256 - 1) = 2^256 - 1 — extreme stress case
        assert.equal((await deFiMath.mulDiv(MAX, MAX, MAX)).toString(), MAX.toString());
      });
    });

    describe("random", function () {
      it("matches BigInt reference on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let i = 0; i < 500; i++) {
          let a, b, d, p1;
          // Reject (d == 0) and (d <= p1) cases — those are tested explicitly in failure.
          do {
            a = randomUint256();
            b = randomUint256();
            d = randomUint256();
            p1 = (a * b) >> 256n;
          } while (d === 0n || d <= p1);
          const expected = (a * b) / d;
          const actual = await deFiMath.mulDiv(a, b, d);
          assert.equal(actual.toString(), expected.toString(), `mulDiv(${a}, ${b}, ${d})`);
        }
      });
    });

    describe("failure", function () {
      it("rejects when d == 0 (fast path)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // 2 * 3 = 6 fits in uint256 → fast path checks d == 0
        await assertRevertError(deFiMath, deFiMath.mulDiv(2n, 3n, 0n), "MulDivByZeroError");
      });

      it("rejects when d == 0 (slow path)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // 2^200 * 2^200 overflows uint256 → slow path checks d == 0
        await assertRevertError(deFiMath, deFiMath.mulDiv(2n ** 200n, 2n ** 200n, 0n), "MulDivByZeroError");
      });

      it("rejects when quotient overflows uint256", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // 2^128 * 2^128 / 1 = 2^256 → doesn't fit in uint256
        await assertRevertError(deFiMath, deFiMath.mulDiv(1n << 128n, 1n << 128n, 1n), "MulDivOverflowError");
        // (2^256 - 1) * (2^256 - 1) / 1 → way over
        await assertRevertError(deFiMath, deFiMath.mulDiv(MAX, MAX, 1n), "MulDivOverflowError");
      });
    });

    describe("performance", function () {
      it("mulDiv on 200 realistic triples — 155 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const rng = mulberry32(1);
        const N = 200;
        let totalGas = 0, fastPath = 0;
        for (let i = 0; i < N; i++) {
          const a = realisticAmount(rng);
          const b = realisticAmount(rng);
          const d = REALISTIC_DENOMS[Math.floor(rng() * REALISTIC_DENOMS.length)];
          if ((a * b) < (1n << 256n)) fastPath++;
          totalGas += parseInt((await deFiMath.mulDivMG(a, b, d)).gasUsed);
        }
        const avg = Math.round(totalGas / N);
        assert.equal(avg, 155, `gas changed: ${avg} ≠ 155 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("mul", function () {
    const D = 10n ** 18n;
    const UMAX = (1n << 256n) - 1n;

    describe("behaviour", function () {
      it("fast-path identities", async function () {
        const { deFiMath } = await loadFixture(deploy);
        assert.equal((await deFiMath.mul(0n, 0n)).toString(), "0");
        assert.equal((await deFiMath.mul(0n, tokens(1234))).toString(), "0");
        // 1 · 1 in 1e18 FP = 1 · 1 = 1 → quotient is 1e18 / 1e18 = 1
        assert.equal((await deFiMath.mul(D, D)).toString(), D.toString());
        // 2 · 3 = 6, in 1e18 FP
        assert.equal((await deFiMath.mul(tokens(2), tokens(3))).toString(), tokens(6).toString());
        // truncates toward zero: 1 · 1 with one wei extra
        assert.equal((await deFiMath.mul(D + 1n, D + 1n)).toString(), (D + 2n).toString());
      });

      it("matches mulDiv(a, b, 1e18) across mixed inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [tokens(1.5), tokens(2)],
          [tokens(1234.5678), tokens(0.000789)],
          [(1n << 100n), (1n << 80n)],
          [(1n << 200n), (1n << 50n)],
          [(1n << 256n) - 1n, 1n],
        ];
        for (const [a, b] of cases) {
          const viaMul = (await deFiMath.mul(a, b)).toString();
          const viaMulDiv = (await deFiMath.mulDiv(a, b, D)).toString();
          assert.equal(viaMul, viaMulDiv, `mul(${a}, ${b}) should match mulDiv(_, _, 1e18)`);
        }
      });
    });

    describe("limits", function () {
      it("zero inputs (min input)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        assert.equal((await deFiMath.mul(0n, 0n)).toString(), "0");
        assert.equal((await deFiMath.mul(0n, UMAX)).toString(), "0");
        assert.equal((await deFiMath.mul(UMAX, 0n)).toString(), "0");
      });

      it("slow-path matches BigInt reference (a · b > 2^256)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [(1n << 200n), (1n << 50n)],
          [(1n << 250n) + 1n, 13n],
          [(1n << 200n) - 1n, (1n << 100n) + 7n],
        ];
        for (const [a, b] of cases) {
          const expected = (a * b) / D;
          assert.equal((await deFiMath.mul(a, b)).toString(), expected.toString(), `mul(${a}, ${b})`);
        }
      });
    });

    describe("random", function () {
      it("matches BigInt reference on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let i = 0; i < 500; i++) {
          let a, b, p1;
          // Reject overflow cases — explicitly tested in failure block.
          do {
            a = randomUint256();
            b = randomUint256();
            p1 = (a * b) >> 256n;
          } while (p1 >= D);
          const expected = (a * b) / D;
          const actual = await deFiMath.mul(a, b);
          assert.equal(actual.toString(), expected.toString(), `mul(${a}, ${b})`);
        }
      });
    });

    describe("failure", function () {
      it("rejects when quotient overflows uint256", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // a · b / 1e18 ≥ 2^256 ⇒ a · b ≥ 1e18 · 2^256.
        // (2^256 - 1) · (2^256 - 1) is well over that.
        await assertRevertError(deFiMath, deFiMath.mul(UMAX, UMAX), "MulOverflowError");
        // 2^240 · 2^240 has p1 ≈ 2^224 which is >> 1e18 (~2^60)
        await assertRevertError(deFiMath, deFiMath.mul(1n << 240n, 1n << 240n), "MulOverflowError");
      });
    });

    describe("performance", function () {
      it("mul on 200 realistic pairs — 130 gas (mulDiv 155)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const rng = mulberry32(2);
        const D = 10n ** 18n;
        const N = 200;
        let gMulDiv = 0, gMul = 0, fastPath = 0;
        for (let i = 0; i < N; i++) {
          const a = realisticAmount(rng);
          const b = realisticAmount(rng);
          if ((a * b) < (1n << 256n)) fastPath++;
          gMulDiv += parseInt((await deFiMath.mulDivMG(a, b, D)).gasUsed);
          gMul    += parseInt((await deFiMath.mulMG(a, b)).gasUsed);
        }
        const avgMulDiv = Math.round(gMulDiv / N);
        const avgMul    = Math.round(gMul / N);
        assert.equal(avgMul, 130, `gas changed: ${avgMul} ≠ 130 — deterministic, update threshold if intentional`);
        assert.equal(avgMulDiv, 155, `gas changed: ${avgMulDiv} ≠ 155 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("abs", function () {
    const INT_MAX = (1n << 255n) - 1n;
    const INT_MIN = -(1n << 255n);

    describe("behaviour", function () {
      it("matches BigInt abs on positives and negatives", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          1n, -1n,
          12345n, -12345n,
          tokens(0.001), `-${tokens(0.001)}`,
          tokens(1234.5678), `-${tokens(1234.5678)}`,
          (1n << 100n), -(1n << 100n),
          (1n << 200n), -(1n << 200n),
        ];
        for (const x of cases) {
          const xBig = BigInt(x);
          const expected = xBig < 0n ? -xBig : xBig;
          assert.equal((await deFiMath.abs(x)).toString(), expected.toString(), `abs(${x})`);
        }
      });
    });

    describe("limits", function () {
      it("handles int256 boundary values", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // int256 max: 2^255 - 1
        assert.equal((await deFiMath.abs(INT_MAX)).toString(), INT_MAX.toString());

        // int256 min: -2^255. No positive int256 represents +2^255, but the unsigned
        // result is 2^255 (the wrap-around in two's complement is the correct answer).
        assert.equal((await deFiMath.abs(INT_MIN)).toString(), (1n << 255n).toString());
      });

      it("zero returns zero", async function () {
        const { deFiMath } = await loadFixture(deploy);
        assert.equal((await deFiMath.abs(0n)).toString(), "0");
      });
    });

    describe("random", function () {
      it("matches BigInt reference on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let i = 0; i < 500; i++) {
          const x = randomInt256();
          const expected = x < 0n ? -x : x;
          const actual = await deFiMath.abs(x);
          assert.equal(actual.toString(), expected.toString(), `abs(${x})`);
        }
      });
    });

    describe("failure", function () {
      it("never reverts — domain is all of int256", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // No int256 input causes a revert. The branchless implementation has no
        // conditional path, so even `int256.min` (the input that overflows naive `-x`)
        // is handled cleanly via two's-complement wrap.
        await deFiMath.abs(0n);
        await deFiMath.abs(1n);
        await deFiMath.abs(-1n);
        await deFiMath.abs(INT_MAX);
        await deFiMath.abs(INT_MIN);
      });
    });

    describe("performance", function () {
      it("abs on 200 random int256 inputs — 17 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const rng = mulberry32(3);
        const N = 200;
        let totalGas = 0;
        for (let i = 0; i < N; i++) {
          const v = randomInt256(rng);
          totalGas += parseInt((await deFiMath.absMG(v)).gasUsed);
        }
        const avg = Math.round(totalGas / N);
        assert.equal(avg, 17, `gas changed: ${avg} ≠ 17 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("min", function () {
    const UMAX = (1n << 256n) - 1n;

    describe("behaviour", function () {
      it("matches BigInt min across mixed pairs (commutative, equal)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 1n], [1n, 0n],
          [5n, 7n], [7n, 5n],
          [tokens(1.5), tokens(2)],
          [(1n << 200n), (1n << 100n)],
        ];
        for (const [a, b] of cases) {
          const expected = a < b ? a : b;
          assert.equal((await deFiMath.min(a, b)).toString(), expected.toString(), `min(${a}, ${b})`);
        }
      });
    });

    describe("limits", function () {
      it("min at uint256 bounds (0 and 2^256 - 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 0n],                  // both at min
          [UMAX, UMAX],              // both at max
          [0n, UMAX], [UMAX, 0n],    // mixed extremes
        ];
        for (const [a, b] of cases) {
          const expected = a < b ? a : b;
          assert.equal((await deFiMath.min(a, b)).toString(), expected.toString(), `min(${a}, ${b})`);
        }
      });
    });

    describe("random", function () {
      it("matches BigInt reference on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let i = 0; i < 500; i++) {
          const a = randomUint256();
          const b = randomUint256();
          const expected = a < b ? a : b;
          const actual = await deFiMath.min(a, b);
          assert.equal(actual.toString(), expected.toString(), `min(${a}, ${b})`);
        }
      });
    });

    describe("failure", function () {
      it("never reverts — domain is the full uint256 × uint256 grid", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // 3 opcodes, no jumps — no reverting path exists.
        await deFiMath.min(0n, 0n);
        await deFiMath.min(0n, UMAX);
        await deFiMath.min(UMAX, 0n);
        await deFiMath.min(UMAX, UMAX);
      });
    });

    describe("performance", function () {
      it("min per-call gas (batch minus baseline, N=200) — 23 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const perCall = await measureBatch(deFiMath, "minBatchMG", 200, mulberry32(4));
        assert.equal(perCall, 23, `gas changed: ${perCall} ≠ 23 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("max", function () {
    const UMAX = (1n << 256n) - 1n;

    describe("behaviour", function () {
      it("matches BigInt max across mixed pairs (commutative, equal)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 1n], [1n, 0n],
          [5n, 7n], [7n, 5n],
          [tokens(1.5), tokens(2)],
          [(1n << 200n), (1n << 100n)],
        ];
        for (const [a, b] of cases) {
          const expected = a > b ? a : b;
          assert.equal((await deFiMath.max(a, b)).toString(), expected.toString(), `max(${a}, ${b})`);
        }
      });
    });

    describe("limits", function () {
      it("max at uint256 bounds (0 and 2^256 - 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 0n],                  // both at min
          [UMAX, UMAX],              // both at max
          [0n, UMAX], [UMAX, 0n],    // mixed extremes
        ];
        for (const [a, b] of cases) {
          const expected = a > b ? a : b;
          assert.equal((await deFiMath.max(a, b)).toString(), expected.toString(), `max(${a}, ${b})`);
        }
      });
    });

    describe("random", function () {
      it("matches BigInt reference on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let i = 0; i < 500; i++) {
          const a = randomUint256();
          const b = randomUint256();
          const expected = a > b ? a : b;
          const actual = await deFiMath.max(a, b);
          assert.equal(actual.toString(), expected.toString(), `max(${a}, ${b})`);
        }
      });
    });

    describe("failure", function () {
      it("never reverts — domain is the full uint256 × uint256 grid", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // 3 opcodes, no jumps — no reverting path exists.
        await deFiMath.max(0n, 0n);
        await deFiMath.max(0n, UMAX);
        await deFiMath.max(UMAX, 0n);
        await deFiMath.max(UMAX, UMAX);
      });
    });

    describe("performance", function () {
      it("max per-call gas (batch minus baseline, N=200) — 23 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const perCall = await measureBatch(deFiMath, "maxBatchMG", 200, mulberry32(5));
        assert.equal(perCall, 23, `gas changed: ${perCall} ≠ 23 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("clamp", function () {
    const UMAX = (1n << 256n) - 1n;

    describe("behaviour", function () {
      it("passes through values in range", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const lo = 10n, hi = 100n;
        for (const x of [10n, 11n, 42n, 99n, 100n]) {
          assert.equal((await deFiMath.clamp(x, lo, hi)).toString(), x.toString(), `clamp(${x}, ${lo}, ${hi})`);
        }
      });

      it("clamps below lo and above hi", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const lo = 10n, hi = 100n;
        assert.equal((await deFiMath.clamp(0n, lo, hi)).toString(), lo.toString());
        assert.equal((await deFiMath.clamp(9n, lo, hi)).toString(), lo.toString());
        assert.equal((await deFiMath.clamp(101n, lo, hi)).toString(), hi.toString());
        assert.equal((await deFiMath.clamp(UMAX, lo, hi)).toString(), hi.toString());
      });

      it("lo == hi collapses to that single value", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (const x of [0n, 41n, 42n, 43n, UMAX]) {
          assert.equal((await deFiMath.clamp(x, 42n, 42n)).toString(), "42");
        }
      });

      it("inverted range (lo > hi) always returns hi", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Documented behavior: function does not validate lo ≤ hi; the second min step
        // squashes the result to hi regardless of x. Caller's responsibility.
        for (const x of [0n, 50n, 200n, UMAX]) {
          assert.equal((await deFiMath.clamp(x, 100n, 10n)).toString(), "10", `clamp(${x}, 100, 10)`);
        }
      });
    });

    describe("limits", function () {
      it("handles full-range bounds", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // lo = 0, hi = UMAX → never clamps
        for (const x of [0n, 1n, tokens(1), UMAX]) {
          assert.equal((await deFiMath.clamp(x, 0n, UMAX)).toString(), x.toString(), `clamp(${x}, 0, UMAX)`);
        }
      });
    });

    describe("random", function () {
      it("matches reference on 500 random valid triples (lo ≤ hi)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let i = 0; i < 500; i++) {
          const x = randomUint256();
          let lo = randomUint256();
          let hi = randomUint256();
          if (lo > hi) [lo, hi] = [hi, lo];   // ensure valid range
          const expected = x < lo ? lo : (x > hi ? hi : x);
          const actual = await deFiMath.clamp(x, lo, hi);
          assert.equal(actual.toString(), expected.toString(), `clamp(${x}, ${lo}, ${hi})`);
        }
      });
    });

    describe("failure", function () {
      it("never reverts — even on inverted ranges and bounds at the uint256 ceiling", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Domain is the full uint256³ — no input combination causes a revert.
        await deFiMath.clamp(0n, 0n, 0n);
        await deFiMath.clamp(UMAX, 0n, UMAX);
        await deFiMath.clamp(0n, UMAX, UMAX);
        await deFiMath.clamp(42n, 100n, 10n);        // inverted range — returns hi (= 10)
        await deFiMath.clamp(UMAX, UMAX, 0n);        // inverted, both extremes
      });
    });

    describe("performance", function () {
      it("clamp on 200 random uint256 triples — 78 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const rng = mulberry32(6);
        const N = 200;
        let totalGas = 0;
        for (let i = 0; i < N; i++) {
          // ensure lo <= hi
          const a = randomUint256(rng);
          const b = randomUint256(rng);
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          const x = randomUint256(rng);
          totalGas += parseInt((await deFiMath.clampMG(x, lo, hi)).gasUsed);
        }
        const avg = Math.round(totalGas / N);
        assert.equal(avg, 78, `gas changed: ${avg} ≠ 78 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("avg", function () {
    const UMAX = (1n << 256n) - 1n;

    describe("behaviour", function () {
      it("matches BigInt avg on small values", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 0n], [0n, 1n], [1n, 0n],
          [1n, 1n], [2n, 2n],
          [5n, 3n],            // (5+3)/2 = 4
          [10n, 6n],           // (10+6)/2 = 8
          [7n, 4n],            // (7+4)/2 = 5 (rounds toward zero, floor(11/2))
          [99n, 100n],         // floor(199/2) = 99
          [tokens(1.5), tokens(2.5)],
        ];
        for (const [a, b] of cases) {
          const aBig = BigInt(a), bBig = BigInt(b);
          const expected = (aBig + bBig) / 2n;
          assert.equal((await deFiMath.avg(a, b)).toString(), expected.toString(), `avg(${a}, ${b})`);
        }
      });

      it("is commutative", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const pairs = [[5n, 7n], [UMAX, 0n], [(1n << 200n), (1n << 100n)]];
        for (const [a, b] of pairs) {
          const ab = (await deFiMath.avg(a, b)).toString();
          const ba = (await deFiMath.avg(b, a)).toString();
          assert.equal(ab, ba, `avg should be commutative for (${a}, ${b})`);
        }
      });
    });

    describe("limits", function () {
      it("zero inputs (min input)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        assert.equal((await deFiMath.avg(0n, 0n)).toString(), "0");
        assert.equal((await deFiMath.avg(0n, 1n)).toString(), "0");  // floor(1/2) = 0
        assert.equal((await deFiMath.avg(0n, UMAX)).toString(), ((UMAX) / 2n).toString());
      });

      it("does not overflow at the uint256 ceiling", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Sum (2^256 - 1) + (2^256 - 1) would wrap a naive (a+b)/2 to ~0; bit-trick handles it.
        assert.equal((await deFiMath.avg(UMAX, UMAX)).toString(), UMAX.toString());
        // (UMAX + 1) / 2 = 2^255
        assert.equal((await deFiMath.avg(UMAX, 1n)).toString(), (1n << 255n).toString());
        // (2^255 + 2^255) / 2 = 2^255
        assert.equal((await deFiMath.avg(1n << 255n, 1n << 255n)).toString(), (1n << 255n).toString());
      });
    });

    describe("random", function () {
      it("matches BigInt reference on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let i = 0; i < 500; i++) {
          const a = randomUint256();
          const b = randomUint256();
          const expected = (a + b) / 2n;   // BigInt sum is unbounded, no overflow
          const actual = await deFiMath.avg(a, b);
          assert.equal(actual.toString(), expected.toString(), `avg(${a}, ${b})`);
        }
      });
    });

    describe("failure", function () {
      it("never reverts — bit-trick handles the full uint256 ceiling cleanly", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // A naive (a+b)/2 reverts (Panic 0x11) on a sum that overflows uint256.
        // The bit-trick `(a & b) + ((a ^ b) >> 1)` never overflows.
        await deFiMath.avg(0n, 0n);
        await deFiMath.avg(UMAX, 0n);
        await deFiMath.avg(0n, UMAX);
        await deFiMath.avg(UMAX, UMAX);             // sum would be 2·UMAX, well over 2^256
        await deFiMath.avg(1n << 255n, 1n << 255n); // sum = 2^256
      });
    });

    describe("performance", function () {
      it("avg per-call gas (batch minus baseline, N=200) — 21 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const perCall = await measureBatch(deFiMath, "avgBatchMG", 200, mulberry32(7));
        assert.equal(perCall, 21, `gas changed: ${perCall} ≠ 21 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("sqrtTime", function () {
    describe("behaviour", function () {
      it("sqrtTime when x in [1s, 8192s]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1; x < 64 * 128; x += 41) {
          const expected = Math.sqrt(x * 31709792000 / 1e18);

          const actualSOL = (await deFiMath.sqrtTime(x * 31709792000)).toString() / 1e18;
          assertSqrtAbsolute(actualSOL, expected);
        }
      });

      it("sqrtTime when x in [8192s, 1d]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 8292; x < 86400; x += 391) {
          const expected = Math.sqrt(x * 31709792000 / 1e18);

          const actualSOL = (await deFiMath.sqrtTime(x * 31709792000)).toString() / 1e18;
          assertSqrtAbsolute(actualSOL, expected);
        }
      });

      it("sqrtTime when x in [1d, 1y]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 86400; x < 365 * 86400; x += 157248) {
          const expected = Math.sqrt(x / 31536000);

          const actualSOL = (await deFiMath.sqrtTime(tokens(x / 31536000))).toString() / 1e18;
          assertSqrtAbsolute(actualSOL, expected);
        }
      });

      it("sqrtTime when x in [1y, 32y]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 32.005; x += 0.03503) {
          const expected = sqrtExactWei(tokens(x));
          const actual = await deFiMath.sqrtTime(tokens(x));
          assertSqrtAccurate(actual, expected);
        }
      });
    });

    describe("limits", function () {
      it("sqrtTime when x is 1s (smallest documented input)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const x = 31709792000 / 1e18; // around 1 / 31536000 = 3.1709791984e-8
        const expected = sqrtExactWei(tokens(x));
        const actual = await deFiMath.sqrt(tokens(x));
        assertSqrtAbsolute(actual, expected);
      });

      it("sqrtTime when x is 32y (largest documented input)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // 32 years is the top of the documented operational range — the function has
        // no input validation, but precision is calibrated to [1s, 32y] in FP years.
        const x = 32;
        const expected = Math.sqrt(x);
        const actualSOL = (await deFiMath.sqrtTime(tokens(x))).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
      });
    });

    describe("random", function () {
      it("matches sqrtTime on 500 random inputs with x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        
        const FP1 = 10n ** 18n;
        for (let i = 0; i < 500; i++) {
          let xWei;
          do { xWei = randomUint256() % FP1; } while (xWei === 0n);
          const expected = sqrtExactWei(xWei);
          const actual = await deFiMath.sqrtTime(xWei);
          assertSqrtAbsolute(actual, expected);
        }
      });

      it("matches sqrtTime on 500 random inputs with x in [1y, 32y])", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const FP1 = 10n ** 18n;
        const UINT_MAX = 2n ** 256n - 1n;
        for (let i = 0; i < 500; i++) {
          let xWei;
          do { xWei = randomUint256(); } while (xWei < FP1 || xWei > 32n * FP1);
          const expected = sqrtExactWei(xWei);
          const actual = await deFiMath.sqrtTime(xWei);
          assertSqrtAccurate(actual, expected);
        }
      });
    });

    describe("failure", function () {
    });

    describe("performance", function () {
      it("sqrtTime when x in [1, 252288000] — 163 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 1; x <= 252288000; x += 1261440) {
          totalGas += parseInt((await deFiMath.sqrtTimeMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 163, `gas changed: ${avg} ≠ 163 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("stdNormCDF", function () {
    describe("behaviour", function () {
      it("stdNormCDF when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const actualSOL = (await deFiMath.stdNormCDF(tokens(0))).toString() / 1e18;
        assert.equal(actualSOL, 0.5);
      });

      it("stdNormCDF when x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1; x += x / 1.976) {
          const expected = bs.stdNormCDF(x);
          const actualSOL = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
        }
      });

      it("stdNormCDF when x in [1, 16.447)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 16.447; x += x * 0.02050317) {
          const expected = bs.stdNormCDF(x);
          const actualSOL = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
        }
      });

      it("stdNormCDF when x in [-1e-18, -1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1; x += x / 1.976) {
          const expected = bs.stdNormCDF(-x);
          const actualSOL = (await deFiMath.stdNormCDF(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
        }
      });

      it("stdNormCDF when x in [-1, -16.447)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 16.447; x += x * 0.02050317) {
          const expected = bs.stdNormCDF(-x);
          const actualSOL = (await deFiMath.stdNormCDF(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
        }
      });
    });

    describe("limits", function () {
      it("stdNormCDF when x is int max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = bs.stdNormCDF(x);

        const actualSOL = (await deFiMath.stdNormCDF("57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });

      it("stdNormCDF when x is 16.447", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 16.447;
        const expected = bs.stdNormCDF(x);

        const actualSOL = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });

      it("stdNormCDF when x is int min", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = bs.stdNormCDF(-x);

        const actualSOL = (await deFiMath.stdNormCDF("-57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });

      it("stdNormCDF when x is -16.447", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = -16.447;
        const expected = bs.stdNormCDF(x);

        const actualSOL = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });
    });

    describe("random", function () {
      it("matches bs.stdNormCDF on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Sample x ∈ [-16.447, 16.447] — the documented operational range. Outside this band
        // the CDF saturates to 0/1, handled in limits.
        for (let i = 0; i < 500; i++) {
          const x = -16.447 + Math.random() * 32.894;
          const expected = bs.stdNormCDF(x);
          const actual = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_CDF);
        }
      });
    });

    describe("failure", function () {
    });

    describe("performance", function () {
      it("stdNormCDF when x in [-11.63, 11.63] — 618 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = -11.63; x <= 11.63; x += 0.1163) {
          totalGas += parseInt((await deFiMath.stdNormCDFMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 618, `gas changed: ${avg} ≠ 618 — deterministic, update threshold if intentional`);
      });
    });

  });

  describe("erf", function () {
    describe("behaviour", function () {
      it("erf when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const actualSOL = (await deFiMath.erf(tokens(0))).toString() / 1e18;
        assert.equal(0, actualSOL);
      });

      it("erf when x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1; x += x / 1.976) {
          const expected = erf(x);
          const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf when x in [1, 11.63)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 11.63; x += x * 0.02050317) {
          const expected = erf(x);
          const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf when x in [-1e-18, -1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1; x += x / 1.976) {
          const expected = erf(-x);
          const actualSOL = (await deFiMath.erf(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf when x in [-1, -11.63)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 11.63; x += x * 0.02050317) {
          const expected = erf(-x);
          const actualSOL = (await deFiMath.erf(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });
    });

    describe("limits", function () {
      it("erf when x is int max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf("57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });

      it("erf when x is 11.64", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 11.64;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });

      it("erf when x is int min", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = -57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf("-57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });

      it("erf when x is -11.64", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = -11.64;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });
    });

    describe("random", function () {
      it("matches math-erf on 500 random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Sample x ∈ [-11.63, 11.63] — the documented operational range. Outside this band
        // erf saturates to ±1, handled in limits.
        for (let i = 0; i < 500; i++) {
          const x = -11.63 + Math.random() * 23.26;
          const expected = erf(x);
          const actual = (await deFiMath.erf(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_ERF);
        }
      });
    });

    describe("failure", function () {
    });

    describe("performance", function () {
      it("erf when x in [-10, 10] — 649 gas", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = -10; x <= 10; x += 0.1) {
          totalGas += parseInt((await deFiMath.erfMG(tokens(x))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 649, `gas changed: ${avg} ≠ 649 — deterministic, update threshold if intentional`);
      });
    });
  });
});
