
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { assertAbsoluteBelow, assertRelativeBelow, assertRevertError, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const MAX_REL_ERROR_COMPOUND = 5.4e-14;     // inherits exp's relative error
const MAX_REL_ERROR_LOG_RETURN = 1.6e-15;   // inherits ln's relative error
const MAX_ABS_ERROR_RATE_CONV = 1e-15;      // Taylor branch precision for rate conversions

describe("DeFiMathRates", function () {

  async function deploy() {
    const RatesWrapper = await ethers.getContractFactory("RatesWrapper");
    const rates = await RatesWrapper.deploy();
    return { rates };
  }

  describe("performance", function () {
    describe.only("compoundInterest", function () {
      it("single", async function () {
        const { rates } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        totalGas += parseInt((await rates.compoundInterestMG(tokens(1000), tokens(0.05), SEC_IN_YEAR)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
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
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("presentValue", function () {
      it("single", async function () {
        const { rates } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        totalGas += parseInt((await rates.presentValueMG(tokens(1000), tokens(0.05), SEC_IN_YEAR)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { rates } = await loadFixture(deploy);
        const fvs = [100, 1000, 10000];
        const ratesArr = [0.01, 0.05, 0.10, 0.20];
        const times = [SEC_IN_DAY, SEC_IN_DAY * 30, SEC_IN_YEAR, SEC_IN_YEAR * 5];
        let totalGas = 0, count = 0;
        for (const fv of fvs) {
          for (const r of ratesArr) {
            for (const t of times) {
              totalGas += parseInt((await rates.presentValueMG(tokens(fv), tokens(r), t)).gasUsed);
              count++;
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("logReturn", function () {
      it("multiple in typical range", async function () {
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
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("continuousToDiscrete", function () {
      it("multiple in typical range", async function () {
        const { rates } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let r = -0.5; r <= 0.5; r += 0.01) {
          totalGas += parseInt((await rates.continuousToDiscreteMG(tokens(r))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("discreteToContinuous", function () {
      it("multiple in typical range", async function () {
        const { rates } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let r = -0.5; r <= 0.5; r += 0.01) {
          totalGas += parseInt((await rates.discreteToContinuousMG(tokens(r))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });
  });

  describe("functionality", function () {
    describe("compoundInterest", function () {
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
        const times = [SEC_IN_DAY, SEC_IN_DAY * 30, SEC_IN_YEAR, SEC_IN_YEAR * 5];
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

        it("returns 0 when principal is 0", async function () {
          const { rates } = await loadFixture(deploy);
          const actual = (await rates.compoundInterest(0, tokens(0.05), SEC_IN_YEAR)).toString() / 1e18;
          assert.equal(actual, 0);
        });

        it("handles high rate over short period", async function () {
          const { rates } = await loadFixture(deploy);
          // r = 100% APR over 1 day
          const expected = 1000 * Math.exp(1 * SEC_IN_DAY / SEC_IN_YEAR);
          const actual = (await rates.compoundInterest(tokens(1000), tokens(1), SEC_IN_DAY)).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
        });

        it("handles low rate over long period", async function () {
          const { rates } = await loadFixture(deploy);
          // r = 0.1% APR over 10 years
          const expected = 1000 * Math.exp(0.001 * 10);
          const actual = (await rates.compoundInterest(tokens(1000), tokens(0.001), SEC_IN_YEAR * 10)).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_COMPOUND);
        });
      });

      describe("failure", function () {
        it("rejects when principal exceeds max", async function () {
          const { rates } = await loadFixture(deploy);
          // MAX_PRINCIPAL = 1e33 + 1; principal must be strictly less
          await assertRevertError(rates, rates.compoundInterest("1000000000000000000000000000000001", tokens(0.05), SEC_IN_YEAR), "PrincipalUpperBoundError");
        });

        it("rejects when rate exceeds max", async function () {
          const { rates } = await loadFixture(deploy);
          await assertRevertError(rates, rates.compoundInterest(tokens(1000), "4000000000000000001", SEC_IN_YEAR), "RateUpperBoundError");
        });
      });
    });

    describe("presentValue", function () {
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
        const times = [SEC_IN_DAY, SEC_IN_DAY * 30, SEC_IN_YEAR, SEC_IN_YEAR * 5];
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

        it("returns 0 when FV is 0", async function () {
          const { rates } = await loadFixture(deploy);
          const actual = (await rates.presentValue(0, tokens(0.05), SEC_IN_YEAR)).toString() / 1e18;
          assert.equal(actual, 0);
        });
      });

      describe("failure", function () {
        it("rejects when FV exceeds max", async function () {
          const { rates } = await loadFixture(deploy);
          await assertRevertError(rates, rates.presentValue("1000000000000000000000000000000001", tokens(0.05), SEC_IN_YEAR), "PrincipalUpperBoundError");
        });

        it("rejects when rate exceeds max", async function () {
          const { rates } = await loadFixture(deploy);
          await assertRevertError(rates, rates.presentValue(tokens(1000), "4000000000000000001", SEC_IN_YEAR), "RateUpperBoundError");
        });
      });
    });

    describe("logReturn", function () {
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

      describe("failure", function () {
        it("rejects when newPrice is 0", async function () {
          const { rates } = await loadFixture(deploy);
          await assertRevertError(rates, rates.logReturn(0, tokens(100)), "PriceLowerBoundError");
        });

        it("rejects when oldPrice is 0", async function () {
          const { rates } = await loadFixture(deploy);
          await assertRevertError(rates, rates.logReturn(tokens(100), 0), "PriceLowerBoundError");
        });
      });
    });

    describe("continuousToDiscrete", function () {
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
    });

    describe("discreteToContinuous", function () {
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

      describe("failure", function () {
        it("rejects when r = -1", async function () {
          const { rates } = await loadFixture(deploy);
          await assertRevertError(rates, rates.discreteToContinuous("-1000000000000000000"), "Log1pLowerBoundError");
        });
      });
    });

    describe("rateConversion roundTrip", function () {
      it("continuousToDiscrete then discreteToContinuous returns original", async function () {
        const { rates } = await loadFixture(deploy);
        for (let r = -0.3; r <= 0.3; r += 0.05) {
          const discrete = (await rates.continuousToDiscrete(tokens(r))).toString() / 1e18;
          const back = (await rates.discreteToContinuous(tokens(discrete))).toString() / 1e18;
          assertAbsoluteBelow(back, r, 1e-13);
        }
      });
    });
  });
});
