
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { assertAbsoluteBelow, assertRelativeBelow, assertRevertError, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const MAX_REL_ERROR_COMPOUND = 5.4e-14;     // inherits exp's relative error
const MAX_REL_ERROR_LOG_RETURN = 1.6e-15;   // inherits ln's relative error
const MAX_ABS_ERROR_RATE_CONV = 1e-15;      // Taylor branch precision for rate conversions
const MAX_REL_ERROR_IRR = 1e-9;             // Newton-Raphson convergence tolerance

// JS reference: continuous-compounding YTM for zero-coupon bond
function jsYieldToMaturity(price, faceValue, timeToMaturity) {
  return Math.log(faceValue / price) / (timeToMaturity / SEC_IN_YEAR);
}

// JS reference: continuous-compounding IRR via Newton-Raphson
// Mirrors the Solidity implementation: solves Σ Cᵢ · e^(-r·tᵢ) = 0
function jsInternalRateOfReturn(cashflows, times, guess) {
  let r = guess;
  for (let iter = 0; iter < 50; iter++) {
    let f = 0, fp = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const tYear = times[i] / SEC_IN_YEAR;
      const e = Math.exp(-r * tYear);
      f += cashflows[i] * e;
      fp -= cashflows[i] * tYear * e;
    }
    if (Math.abs(f) < 1e-8) return r;
    if (fp === 0) throw new Error("Zero derivative");
    r -= f / fp;
  }
  throw new Error("No convergence");
}

describe("DeFiMathRates", function () {

  async function deploy() {
    const RatesWrapper = await ethers.getContractFactory("RatesWrapper");
    const rates = await RatesWrapper.deploy();
    return { rates };
  }

  before(async function () {
    // Pay the deploy + snapshot cost once so the first it() isn't charged with cold-start.
    await loadFixture(deploy);
  });

  describe("compoundInterest", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { rates } = await loadFixture(deploy);
        // P = 1000, r = 5%, t = 1 year → 1000 · e^0.05 ≈ 1051.27
        const expected = 1000 * Math.exp(0.05);
        const actual = (await rates.compoundInterest(tokens(1000), tokens(0.05), SEC_IN_YEAR)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });

      it("multiple in typical range", async function () {
        const { rates } = await loadFixture(deploy);
        const principals = [1, 100, 1000, 1e6];
        const ratesArr = [0.001, 0.01, 0.05, 0.10, 0.20, 0.50];
        const times = [SEC_IN_DAY, SEC_IN_DAY * 30, SEC_IN_YEAR, SEC_IN_YEAR * 2];
        for (const p of principals) {
          for (const r of ratesArr) {
            for (const t of times) {
              const expected = p * Math.exp(r * t / SEC_IN_YEAR);
              const actual = (await rates.compoundInterest(tokens(p), tokens(r), t)).toString() / 1e18;
              assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("returns principal when rate is 0", async function () {
        const { rates } = await loadFixture(deploy);
        const actual = (await rates.compoundInterest(tokens(1000), 0, SEC_IN_YEAR)).toString() / 1e18;
        assert.equal(actual, 1000);
      });

      it("returns principal when time is 0", async function () {
        const { rates } = await loadFixture(deploy);
        const actual = (await rates.compoundInterest(tokens(1000), tokens(0.05), 0)).toString() / 1e18;
        assert.equal(actual, 1000);
      });

      it("handles high rate over short period", async function () {
        const { rates } = await loadFixture(deploy);
        // r = 100% APR over 1 day
        const expected = 1000 * Math.exp(1 * SEC_IN_DAY / SEC_IN_YEAR);
        const actual = (await rates.compoundInterest(tokens(1000), tokens(1), SEC_IN_DAY)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });

      it("handles low rate over max period (2 years)", async function () {
        const { rates } = await loadFixture(deploy);
        // r = 0.1% APR over 2 years (the upper time bound)
        const expected = 1000 * Math.exp(0.001 * 2);
        const actual = (await rates.compoundInterest(tokens(1000), tokens(0.001), SEC_IN_YEAR * 2)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });
    });

    describe("failure", function () {
      it("rejects when principal is below min", async function () {
        const { rates } = await loadFixture(deploy);
        // MIN_PRINCIPAL = 1e12 - 1; principal must be strictly greater
        await assertRevertError(rates, rates.compoundInterest(0, tokens(0.05), SEC_IN_YEAR), "PrincipalLowerBoundError");
        await assertRevertError(rates, rates.compoundInterest("999999999999", tokens(0.05), SEC_IN_YEAR), "PrincipalLowerBoundError");
        // just above the bound should succeed
        await rates.compoundInterest("1000000000000", tokens(0.05), SEC_IN_YEAR);
      });

      it("rejects when principal exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        // MAX_PRINCIPAL = 1e33 + 1; principal must be strictly less
        await assertRevertError(rates, rates.compoundInterest("1000000000000000000000000000000001", tokens(0.05), SEC_IN_YEAR), "PrincipalUpperBoundError");
      });

      it("rejects when time exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        // MAX_TIME_INTERVAL = 63072000 + 1 (2 years + 1 second)
        await assertRevertError(rates, rates.compoundInterest(tokens(1000), tokens(0.05), 63072001), "TimeIntervalUpperBoundError");
        // exactly 2 years should succeed
        await rates.compoundInterest(tokens(1000), tokens(0.05), 63072000);
      });

      it("rejects when rate exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.compoundInterest(tokens(1000), "4000000000000000001", SEC_IN_YEAR), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("compoundInterest across 3×4×4 principals/rates/times — 467 gas", async function () {
        const { rates } = await loadFixture(deploy);
        const principals = [100, 1000, 10000];
        const ratesArr = [0.01, 0.05, 0.10, 0.20];
        const times = [SEC_IN_DAY, SEC_IN_DAY * 30, SEC_IN_YEAR, SEC_IN_YEAR * 2];
        let totalGas = 0, count = 0;
        for (const p of principals) {
          for (const r of ratesArr) {
            for (const t of times) {
              totalGas += parseInt((await rates.compoundInterestMG(tokens(p), tokens(r), t)).gasUsed);
              count++;
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 467, `gas changed: ${avg} ≠ 467 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("presentValue", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { rates } = await loadFixture(deploy);
        // FV = 1000, r = 5%, t = 1 year → 1000 · e^-0.05 ≈ 951.23
        const expected = 1000 * Math.exp(-0.05);
        const actual = (await rates.presentValue(tokens(1000), tokens(0.05), SEC_IN_YEAR)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });

      it("multiple in typical range", async function () {
        const { rates } = await loadFixture(deploy);
        const fvs = [1, 100, 1000, 1e6];
        const ratesArr = [0.001, 0.01, 0.05, 0.10, 0.20, 0.50];
        const times = [SEC_IN_DAY, SEC_IN_DAY * 30, SEC_IN_YEAR, SEC_IN_YEAR * 2];
        for (const fv of fvs) {
          for (const r of ratesArr) {
            for (const t of times) {
              const expected = fv * Math.exp(-r * t / SEC_IN_YEAR);
              const actual = (await rates.presentValue(tokens(fv), tokens(r), t)).toString() / 1e18;
              assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("returns FV when rate is 0", async function () {
        const { rates } = await loadFixture(deploy);
        const actual = (await rates.presentValue(tokens(1000), 0, SEC_IN_YEAR)).toString() / 1e18;
        assert.equal(actual, 1000);
      });

      it("returns FV when time is 0", async function () {
        const { rates } = await loadFixture(deploy);
        const actual = (await rates.presentValue(tokens(1000), tokens(0.05), 0)).toString() / 1e18;
        assert.equal(actual, 1000);
      });

      it("handles high rate over short period", async function () {
        const { rates } = await loadFixture(deploy);
        const expected = 1000 * Math.exp(-1 * SEC_IN_DAY / SEC_IN_YEAR);
        const actual = (await rates.presentValue(tokens(1000), tokens(1), SEC_IN_DAY)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });

      it("handles low rate over max period (2 years)", async function () {
        const { rates } = await loadFixture(deploy);
        const expected = 1000 * Math.exp(-0.001 * 2);
        const actual = (await rates.presentValue(tokens(1000), tokens(0.001), SEC_IN_YEAR * 2)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });
    });

    describe("failure", function () {
      it("rejects when FV is below min", async function () {
        const { rates } = await loadFixture(deploy);
        // MIN_PRINCIPAL = 1e12 - 1; FV must be strictly greater
        await assertRevertError(rates, rates.presentValue(0, tokens(0.05), SEC_IN_YEAR), "PrincipalLowerBoundError");
        await assertRevertError(rates, rates.presentValue("999999999999", tokens(0.05), SEC_IN_YEAR), "PrincipalLowerBoundError");
        // just above the bound should succeed
        await rates.presentValue("1000000000000", tokens(0.05), SEC_IN_YEAR);
      });

      it("rejects when FV exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.presentValue("1000000000000000000000000000000001", tokens(0.05), SEC_IN_YEAR), "PrincipalUpperBoundError");
      });

      it("rejects when time exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        // MAX_TIME_INTERVAL = 63072000 + 1 (2 years + 1 second)
        await assertRevertError(rates, rates.presentValue(tokens(1000), tokens(0.05), 63072001), "TimeIntervalUpperBoundError");
        // exactly 2 years should succeed
        await rates.presentValue(tokens(1000), tokens(0.05), 63072000);
      });

      it("rejects when rate exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.presentValue(tokens(1000), "4000000000000000001", SEC_IN_YEAR), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("presentValue across 3×4×4 FVs/rates/times — 519 gas", async function () {
        const { rates } = await loadFixture(deploy);
        const fvs = [100, 1000, 10000];
        const ratesArr = [0.01, 0.05, 0.10, 0.20];
        const times = [SEC_IN_DAY, SEC_IN_DAY * 30, SEC_IN_YEAR, SEC_IN_YEAR * 2];
        let totalGas = 0, count = 0;
        for (const fv of fvs) {
          for (const r of ratesArr) {
            for (const t of times) {
              totalGas += parseInt((await rates.presentValueMG(tokens(fv), tokens(r), t)).gasUsed);
              count++;
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 519, `gas changed: ${avg} ≠ 519 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("logReturn", function () {

    describe("behaviour", function () {
      it("returns 0 when prices are equal", async function () {
        const { rates } = await loadFixture(deploy);
        const actual = (await rates.logReturn(tokens(100), tokens(100))).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("returns positive for newPrice > oldPrice", async function () {
        const { rates } = await loadFixture(deploy);
        const expected = Math.log(110 / 100);
        const actual = (await rates.logReturn(tokens(110), tokens(100))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_LOG_RETURN);
      });

      it("returns negative for newPrice < oldPrice", async function () {
        const { rates } = await loadFixture(deploy);
        const expected = Math.log(90 / 100);
        const actual = (await rates.logReturn(tokens(90), tokens(100))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_LOG_RETURN);
      });

      it("multiple in typical range", async function () {
        const { rates } = await loadFixture(deploy);
        const oldPrices = [1, 100, 1e6];
        for (const oldP of oldPrices) {
          for (let ratio = 0.01; ratio <= 100; ratio *= 1.5) {
            const newP = oldP * ratio;
            const expected = Math.log(newP / oldP);
            const actual = (await rates.logReturn(tokens(newP), tokens(oldP))).toString() / 1e18;
            assertRelativeBelow(actual, expected, MAX_REL_ERROR_LOG_RETURN);
          }
        }
      });
    });

    describe("failure", function () {
      it("rejects when newPrice is below min", async function () {
        const { rates } = await loadFixture(deploy);
        // MIN_PRINCIPAL = 1e12 - 1; price must be strictly greater
        await assertRevertError(rates, rates.logReturn(0, tokens(100)), "PriceLowerBoundError");
        await assertRevertError(rates, rates.logReturn("999999999999", tokens(100)), "PriceLowerBoundError");
        // just above the bound should succeed
        await rates.logReturn("1000000000000", tokens(100));
      });

      it("rejects when oldPrice is below min", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.logReturn(tokens(100), 0), "PriceLowerBoundError");
        await assertRevertError(rates, rates.logReturn(tokens(100), "999999999999"), "PriceLowerBoundError");
      });

      it("rejects when newPrice exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.logReturn("1000000000000000000000000000000001", tokens(100)), "PriceUpperBoundError");
      });

      it("rejects when oldPrice exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.logReturn(tokens(100), "1000000000000000000000000000000001"), "PriceUpperBoundError");
      });
    });

    describe("performance", function () {
      it("logReturn across 3×5 oldPrices/newPrices — 600 gas", async function () {
        const { rates } = await loadFixture(deploy);
        const oldPrices = [100, 1000, 10000];
        const newPrices = [50, 95, 100.01, 105, 200];
        let totalGas = 0, count = 0;
        for (const oldP of oldPrices) {
          for (const newP of newPrices) {
            totalGas += parseInt((await rates.logReturnMG(tokens(newP), tokens(oldP))).gasUsed);
            count++;
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 600, `gas changed: ${avg} ≠ 600 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("continuousToDiscrete", function () {

    describe("behaviour", function () {
      it("returns 0 for r = 0", async function () {
        const { rates } = await loadFixture(deploy);
        const actual = (await rates.continuousToDiscrete(0)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("matches Math.expm1 across typical range", async function () {
        const { rates } = await loadFixture(deploy);
        for (let r = -0.5; r <= 0.5; r += 0.011) {
          const expected = Math.expm1(r);
          const actual = (await rates.continuousToDiscrete(tokens(r))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, 1e-13);
        }
      });

      it("preserves precision for small r (Taylor branch)", async function () {
        const { rates } = await loadFixture(deploy);
        for (let r = -0.005; r <= 0.005; r += 0.0001) {
          const expected = Math.expm1(r);
          const actual = (await rates.continuousToDiscrete(tokens(r))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_RATE_CONV);
        }
      });

      it("continuousToDiscrete then discreteToContinuous returns original", async function () {
        const { rates } = await loadFixture(deploy);
        for (let r = -0.3; r <= 0.3; r += 0.05) {
          const discrete = (await rates.continuousToDiscrete(tokens(r))).toString() / 1e18;
          const back = (await rates.discreteToContinuous(tokens(discrete))).toString() / 1e18;
          assertAbsoluteBelow(back, r, 1e-13);
        }
      });
    });

    describe("failure", function () {
      it("rejects when r exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        // MAX_RATE = 4e18 + 1
        await assertRevertError(rates, rates.continuousToDiscrete("4000000000000000001"), "RateUpperBoundError");
        // just below the bound should succeed
        await rates.continuousToDiscrete("4000000000000000000");
      });

      it("rejects when r is below -max", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.continuousToDiscrete("-4000000000000000001"), "RateLowerBoundError");
        // just above the bound should succeed
        await rates.continuousToDiscrete("-4000000000000000000");
      });
    });

    describe("performance", function () {
      it("continuousToDiscrete across r in [-0.5, 0.5] — 508 gas", async function () {
        const { rates } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let r = -0.5; r <= 0.5; r += 0.01) {
          totalGas += parseInt((await rates.continuousToDiscreteMG(tokens(r))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 508, `gas changed: ${avg} ≠ 508 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("discreteToContinuous", function () {

    describe("behaviour", function () {
      it("returns 0 for r = 0", async function () {
        const { rates } = await loadFixture(deploy);
        const actual = (await rates.discreteToContinuous(0)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("matches Math.log1p across typical range", async function () {
        const { rates } = await loadFixture(deploy);
        for (let r = -0.5; r <= 0.5; r += 0.011) {
          const expected = Math.log1p(r);
          const actual = (await rates.discreteToContinuous(tokens(r))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, 1e-13);
        }
      });

      it("preserves precision for small r (Taylor branch)", async function () {
        const { rates } = await loadFixture(deploy);
        for (let r = -0.005; r <= 0.005; r += 0.0001) {
          const expected = Math.log1p(r);
          const actual = (await rates.discreteToContinuous(tokens(r))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, MAX_ABS_ERROR_RATE_CONV);
        }
      });
    });

    describe("failure", function () {
      it("rejects when r exceeds max", async function () {
        const { rates } = await loadFixture(deploy);
        // MAX_RATE = 4e18 + 1
        await assertRevertError(rates, rates.discreteToContinuous("4000000000000000001"), "RateUpperBoundError");
        // just below the bound should succeed
        await rates.discreteToContinuous("4000000000000000000");
      });

      it("rejects when r <= -1 (log domain boundary)", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.discreteToContinuous("-1000000000000000000"), "RateLowerBoundError");
        await assertRevertError(rates, rates.discreteToContinuous("-2000000000000000000"), "RateLowerBoundError");
        // just above -1 should succeed
        await rates.discreteToContinuous("-999999999999999999");
      });
    });

    describe("performance", function () {
      it("discreteToContinuous across r in [-0.5, 0.5] — 589 gas", async function () {
        const { rates } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let r = -0.5; r <= 0.5; r += 0.01) {
          totalGas += parseInt((await rates.discreteToContinuousMG(tokens(r))).gasUsed);
          count++;
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 589, `gas changed: ${avg} ≠ 589 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("yieldToMaturity", function () {

    describe("behaviour", function () {
      it("zero-coupon: price < face → positive YTM (matches JS)", async function () {
        const { rates } = await loadFixture(deploy);
        const expected = jsYieldToMaturity(95, 100, SEC_IN_YEAR);
        const actual = (await rates.yieldToMaturity(tokens(95), tokens(100), SEC_IN_YEAR)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });

      it("deep discount (50% of face over 2 years)", async function () {
        const { rates } = await loadFixture(deploy);
        const expected = jsYieldToMaturity(50, 100, 2 * SEC_IN_YEAR);  // = ln(2)/2 ≈ 0.3466
        const actual = (await rates.yieldToMaturity(tokens(50), tokens(100), 2 * SEC_IN_YEAR)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });

      it("short maturity (30 days)", async function () {
        const { rates } = await loadFixture(deploy);
        const expected = jsYieldToMaturity(99.5, 100, 30 * SEC_IN_DAY);
        const actual = (await rates.yieldToMaturity(tokens(99.5), tokens(100), 30 * SEC_IN_DAY)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
      });
    });

    describe("failure", function () {
      it("rejects when price >= face", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.yieldToMaturity(tokens(100), tokens(100), SEC_IN_YEAR), "InvalidBondPriceError");
        await assertRevertError(rates, rates.yieldToMaturity(tokens(101), tokens(100), SEC_IN_YEAR), "InvalidBondPriceError");
      });

      it("rejects when timeToMaturity is 0", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.yieldToMaturity(tokens(95), tokens(100), 0), "TimeIntervalUpperBoundError");
      });

      it("rejects when timeToMaturity > 2 years", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.yieldToMaturity(tokens(95), tokens(100), 63072001), "TimeIntervalUpperBoundError");
      });

      it("rejects when price below min", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.yieldToMaturity(0, tokens(100), SEC_IN_YEAR), "PriceLowerBoundError");
      });

      it("rejects when price above max", async function () {
        const { rates } = await loadFixture(deploy);
        // MAX_PRINCIPAL = 1e33 + 1
        await assertRevertError(rates, rates.yieldToMaturity("1000000000000000000000000000000001", tokens(100), SEC_IN_YEAR), "PriceUpperBoundError");
      });

      it("rejects when faceValue below min", async function () {
        const { rates } = await loadFixture(deploy);
        // MIN_PRINCIPAL = 1e12 - 1
        await assertRevertError(rates, rates.yieldToMaturity(tokens(1), "999999999999", SEC_IN_YEAR), "PrincipalLowerBoundError");
      });

      it("rejects when faceValue above max", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.yieldToMaturity(tokens(100), "1000000000000000000000000000000001", SEC_IN_YEAR), "PrincipalUpperBoundError");
      });
    });

    describe("performance", function () {
      it("yieldToMaturity across 4×3 prices/times — 736 gas", async function () {
        const { rates } = await loadFixture(deploy);
        // Vary discount depth (price as % of face) and time to maturity.
        const prices = [50, 80, 95, 99];
        const times = [30 * SEC_IN_DAY, 180 * SEC_IN_DAY, SEC_IN_YEAR];
        let totalGas = 0, count = 0;
        for (const price of prices) {
          for (const t of times) {
            totalGas += parseInt((await rates.yieldToMaturityMG(tokens(price), tokens(100), t)).gasUsed);
            count++;
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 736, `gas changed: ${avg} ≠ 736 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("internalRateOfReturn", function () {

    describe("behaviour", function () {
      it("simple annuity: -1000 then four 300s", async function () {
        const { rates } = await loadFixture(deploy);
        const cashflowsJS = [-1000, 300, 300, 300, 300];
        const timesJS = [0, SEC_IN_YEAR, 2 * SEC_IN_YEAR, 3 * SEC_IN_YEAR, 4 * SEC_IN_YEAR];
        const expected = jsInternalRateOfReturn(cashflowsJS, timesJS, 0.05);
        const cashflows = cashflowsJS.map(c => tokens(c));
        const actual = (await rates.internalRateOfReturn(cashflows, timesJS, tokens(0.05))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_IRR);
      });

      it("monthly coupons: bond-like cashflows", async function () {
        const { rates } = await loadFixture(deploy);
        const cashflowsJS = [-10000];
        const timesJS = [0];
        for (let i = 1; i <= 12; i++) {
          cashflowsJS.push(i === 12 ? 10100 : 50); // principal returned at maturity
          timesJS.push(i * 30 * SEC_IN_DAY);
        }
        const expected = jsInternalRateOfReturn(cashflowsJS, timesJS, 0.05);
        const cashflows = cashflowsJS.map(c => tokens(c));
        const actual = (await rates.internalRateOfReturn(cashflows, timesJS, tokens(0.05))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_IRR);
      });

      it("negative IRR for loss-making investment", async function () {
        const { rates } = await loadFixture(deploy);
        // pay 1000, get back only 900 after 1 year — negative IRR
        const cashflowsJS = [-1000, 900];
        const timesJS = [0, SEC_IN_YEAR];
        const expected = jsInternalRateOfReturn(cashflowsJS, timesJS, -0.05);
        const cashflows = cashflowsJS.map(c => tokens(c));
        const actual = (await rates.internalRateOfReturn(cashflows, timesJS, "-50000000000000000")).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_IRR);
        assert.isBelow(actual, 0, "IRR should be negative for loss");
      });

      it("matches IRR for trivial 2-cashflow case (closed form)", async function () {
        const { rates } = await loadFixture(deploy);
        // for [-P, F] at [0, T], IRR = ln(F/P) / T (same as zero-coupon YTM)
        const closedForm = Math.log(110 / 100) / 1;  // = 0.0953...
        const cashflows = [-100, 110].map(c => tokens(c));
        const times = [0, SEC_IN_YEAR];
        const actual = (await rates.internalRateOfReturn(cashflows, times, tokens(0.05))).toString() / 1e18;
        assertRelativeBelow(actual, closedForm, MAX_REL_ERROR_IRR);
      });
    });

    describe("failure", function () {
      it("rejects when arrays empty or single", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.internalRateOfReturn([], [], tokens(0.05)), "ArrayLengthOutOfBoundsError");
        await assertRevertError(rates, rates.internalRateOfReturn([tokens(-1000)], [0], tokens(0.05)), "ArrayLengthOutOfBoundsError");
      });

      it("rejects when arrays mismatched", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.internalRateOfReturn([tokens(-1), tokens(2)], [0], tokens(0.05)), "ArrayLengthMismatchError");
      });

      it("rejects when guess exceeds MAX_RATE", async function () {
        const { rates } = await loadFixture(deploy);
        await assertRevertError(rates, rates.internalRateOfReturn([tokens(-1), tokens(2)], [0, SEC_IN_YEAR], "4000000000000000001"), "RateUpperBoundError");
        await assertRevertError(rates, rates.internalRateOfReturn([tokens(-1), tokens(2)], [0, SEC_IN_YEAR], "-4000000000000000001"), "RateUpperBoundError");
      });

      it("rejects when cashflow count reaches max", async function () {
        const { rates } = await loadFixture(deploy);
        const n = 1025; // MAX_CASHFLOWS = 1024 + 1
        const cashflows = Array.from({ length: n }, () => tokens(1));
        const times = Array.from({ length: n }, () => 0);
        await assertRevertError(rates, rates.internalRateOfReturn(cashflows, times, tokens(0.05)), "ArrayLengthOutOfBoundsError");
      });

      it("rejects when the derivative is zero (all times equal)", async function () {
        const { rates } = await loadFixture(deploy);
        // all times = 0 → every tᵢ term vanishes → fPrime == 0 while f ≠ 0
        await assertRevertError(rates, rates.internalRateOfReturn([tokens(-100), tokens(150)], [0, 0], tokens(0.05)), "NoConvergenceError");
      });

      it("rejects when IRR diverges past the rate bounds", async function () {
        const { rates } = await loadFixture(deploy);
        // true IRR ≈ ±ln(1000) ≈ ±6.9, outside ±MAX_RATE — Newton clamps every iteration and never converges
        await assertRevertError(rates, rates.internalRateOfReturn([tokens(-1), tokens(1000)], [0, SEC_IN_YEAR], tokens(0.05)), "NoConvergenceError");
        await assertRevertError(rates, rates.internalRateOfReturn([tokens(-1000), tokens(1)], [0, SEC_IN_YEAR], tokens(0.05)), "NoConvergenceError");
      });
    });

    describe("performance", function () {
      it("internalRateOfReturn on 4-cashflow annuity + 12-cashflow bond — 17043 / 49285 gas", async function () {
        const { rates } = await loadFixture(deploy);

        // 4-cashflow annuity: invest 1000, receive 300 at each of years 1, 2, 3, 4
        {
          const cashflows = [-1000, 300, 300, 300, 300].map(c => tokens(c));
          const times = [0, SEC_IN_YEAR, 2 * SEC_IN_YEAR, 3 * SEC_IN_YEAR, 4 * SEC_IN_YEAR];
          const gas = parseInt((await rates.internalRateOfReturnMG(cashflows, times, tokens(0.05))).gasUsed);
          assert.equal(gas, 17043, `gas changed: ${gas} ≠ 17043 (4-cashflow) — deterministic, update threshold if intentional`);
        }

        // 12-cashflow bond: invest 10000, receive 1000 per month for 12 months
        {
          const cashflows = [-10000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000].map(c => tokens(c));
          const times = Array.from({length: 12}, (_, i) => i === 0 ? 0 : (i * SEC_IN_DAY * 30));
          const gas = parseInt((await rates.internalRateOfReturnMG(cashflows, times, tokens(0.05))).gasUsed);
          assert.equal(gas, 49285, `gas changed: ${gas} ≠ 49285 (12-cashflow) — deterministic, update threshold if intentional`);
        }
      });
    });
  });

});
