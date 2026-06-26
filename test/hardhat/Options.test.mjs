
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import bs from "black-scholes";
import greeks from "greeks";
import { assertAbsoluteBelow, assertRevertError, generateRandomTestPoints, generateTestStrikePoints, generateTestTimePoints, MIN_ERROR, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const fastTest = true;

const MAX_OPTION_ABS_ERROR = 1.3e-10; // in $, for a call/put option on underlying valued at $1000
const MAX_DELTA_ABS_ERROR = 1.2e-13;
const MAX_GAMMA_ABS_ERROR = 3.2e-15;
const MAX_THETA_ABS_ERROR = 1.9e-12;
const MAX_VEGA_ABS_ERROR = 4e-13;

// bs has a bug with time = 0, it returns NaN, so we are wrapping it
export function blackScholesWrapped(spot, strike, time, vol, rate, callOrPut) {
  // handle expired option
  if (time <= 0) {
    if (callOrPut === "call") {
      return Math.max(0, spot - strike);
    } else {
      return Math.max(0, strike - spot);
    }
  }

  vol += 1e-16;

  return Math.max(0, bs.blackScholes(spot, strike, time, vol, rate, callOrPut));
}

describe("DeFiMathOptions", function () {
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const OptionsWrapper = await ethers.getContractFactory("OptionsWrapper");
    const options = await OptionsWrapper.deploy();

    return { options };
  }

  async function testOptionRange(strikePoints, timePoints, volPoints, ratePoints, isCall, maxAbsError = MAX_OPTION_ABS_ERROR, multi = 10, log = true) {
    const { options } = await loadFixture(deploy);
    log && console.log("Max abs error: $" + maxAbsError);

    let countTotal = 0, prunedCountSOL = 0;
    const totalPoints = strikePoints.length * timePoints.length * volPoints.length * ratePoints.length;
    let errorsSOL = [];
    for (const strike of strikePoints) {
      for(const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            // expected
            const expected = blackScholesWrapped(100 * multi, strike * multi, exp / SEC_IN_YEAR, vol, rate, isCall ? "call" : "put");

            // SOL
            let actualSOL = 0;
            if (isCall) {
              actualSOL = (await options.callOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate))).toString() / 1e18;
            } else {
              actualSOL = (await options.putOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate))).toString() / 1e18;
            }

            const absErrorSOL = Math.abs(actualSOL - expected);

            const errorParamsSOL = {
              expiration: exp, strike: strike * multi, vol, rate, act: actualSOL, exp: expected
            }
            errorsSOL.push({ absErrorSOL, errorParamsSOL });


            countTotal++;

            // print progress and prune errors
            if (countTotal % Math.round(totalPoints / 10) === 0) {
              if (log) {
                const startTime = new Date().getTime();
                errorsSOL.sort((a, b) => b.absErrorSOL - a.absErrorSOL);
                console.log("Progress:", (countTotal / totalPoints * 100).toFixed(0) + 
                "%, Max abs error:", "$" + (errorsSOL[0] ? (errorsSOL[0].absErrorSOL / (0.1 * multi)).toFixed(12) : "0") + 
                " (" + (new Date().getTime() - startTime) + "mS)");
              }

              // prune all errors where abs error < allowedAbsError
              const toDeleteErrorsSOL = errorsSOL.filter(error => error.absErrorSOL < maxAbsError);
              prunedCountSOL += toDeleteErrorsSOL.length;

              errorsSOL = errorsSOL.filter(error => error.absErrorSOL >= maxAbsError);
            }
          }
        }
      }
    }

    // prune all errors where abs error < allowedAbsError
    const toDeleteErrorsSOL = errorsSOL.filter(error => error.absErrorSOL < maxAbsError);
    prunedCountSOL += toDeleteErrorsSOL.length;

    errorsSOL = errorsSOL.filter(error => error.absErrorSOL >= maxAbsError);

    if (log) {
      // SOL
      console.log();
      console.log("REPORT SOL");
      console.log("Errors Abs/Rel/Total: " + prunedCountSOL + "/" + errorsSOL.length + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");

      console.log("Max abs error params SOL: ", errorsSOL[0]);
    }

    // assert that all errors are below allowedAbsError
    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].absErrorSOL, maxAbsError);
    }
  }

  // before all tests, called once
  before(async () => {
    testTimePoints = generateTestTimePoints();
    testStrikePoints = generateTestStrikePoints(5, 500);
  });

  // Greek-agnostic 4D sweep helper — same shape as testOptionRange but for delta/gamma/theta/vega.
  // Each greek has its own JS reference (greeks library), Solidity wrapper, and tolerance.
  // strikePoints/timePoints are raw values; multi scales them to the {spot=100*multi} test world.
  async function testGreekRange(greekName, strikePoints, timePoints, volPoints, ratePoints, multi = 10) {
    const { options } = await loadFixture(deploy);
    const spot = 100 * multi;
    for (const strike of strikePoints) {
      for (const time of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            const k = strike * multi;
            const t = time / SEC_IN_YEAR;
            switch (greekName) {
              case "delta": {
                const expectedCall = greeks.getDelta(spot, k, t, vol, rate, "call");
                const expectedPut = greeks.getDelta(spot, k, t, vol, rate, "put");
                const actual = await options.delta(tokens(spot), tokens(k), time, tokens(vol), tokens(rate));
                assertAbsoluteBelow(actual.deltaCall.toString() / 1e18, expectedCall, MAX_DELTA_ABS_ERROR);
                assertAbsoluteBelow(actual.deltaPut.toString() / 1e18, expectedPut, MAX_DELTA_ABS_ERROR);
                break;
              }
              case "gamma": {
                const expected = greeks.getGamma(spot, k, t, vol, rate, "call");
                const actual = (await options.gamma(tokens(spot), tokens(k), time, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actual, expected, MAX_GAMMA_ABS_ERROR);
                break;
              }
              case "theta": {
                const expectedCall = greeks.getTheta(spot, k, t, vol, rate, "call");
                const expectedPut = greeks.getTheta(spot, k, t, vol, rate, "put");
                const actual = await options.theta(tokens(spot), tokens(k), time, tokens(vol), tokens(rate));
                assertAbsoluteBelow(actual.thetaCall.toString() / 1e18, expectedCall, MAX_THETA_ABS_ERROR);
                assertAbsoluteBelow(actual.thetaPut.toString() / 1e18, expectedPut, MAX_THETA_ABS_ERROR);
                break;
              }
              case "vega": {
                const expected = greeks.getVega(spot, k, t, vol, rate, "call");
                const actual = (await options.vega(tokens(spot), tokens(k), time, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actual, expected, MAX_VEGA_ABS_ERROR);
                break;
              }
            }
          }
        }
      }
    }
  }

  describe("call", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 980, 60 / 365, 0.60, 0.05, "call");

        const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = blackScholesWrapped(1000, strike, time / 365, vol, rate, "call");

                const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
              }
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("limits and near limit values", async function () {
        const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
        const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
        const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
        const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
        await testOptionRange(strikes, times, vols, rates, true, MAX_OPTION_ABS_ERROR, 10, false);
      });

      it("expired ITM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 980, 0, 0.60, 0.05, "call");

        const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired ATM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1000, 0, 0.60, 0.05, "call");

        const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired OTM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1020, 0, 0.60, 0.05, "call");

        const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("no volatility multiple strikes and expirations", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [200, 800, 1000, 1200, 5000];
        const times = [1, 2, 10, 30, 60, SEC_IN_YEAR, 2 * SEC_IN_YEAR];
        const rates = [0, 0.05, 4];

        for (let strike of strikes) {
          for (let time of times) {
            for (let rate of rates) {
              const expected = blackScholesWrapped(1000, strike, time / SEC_IN_YEAR, 0, rate, "call");
      
              const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
              assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
            }
          }
        }
      });

      it("handles when N(d1) == N(d2) for OTM option", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1200, 1 / 365, 0.40, 0.05, "call");

        const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(1200), 1 * SEC_IN_DAY, tokens(0.40), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
      });

      it("handles when vol is 0, and time lowest", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1020, 1 / SEC_IN_YEAR, 0, 0.05, "call");

        const actualSOL = (await options.callOptionPrice(tokens(1000), tokens(1020), 1, 0, tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
      });
    });

    describe("random", function () {
      it("lower strikes", async function () {
        const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, true, MAX_OPTION_ABS_ERROR, 10, !fastTest);
      });

      it("higher strikes", async function () {
        const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, true, MAX_OPTION_ABS_ERROR, 10, !fastTest);
      });
    });

    describe("failure", function () {
      it("rejects when spot < min spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.callOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        await options.callOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.callOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
      });

      it("rejects when spot > max spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.callOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        await options.callOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.callOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
      });

      it("rejects when strike < spot / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.callOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.callOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.callOptionPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > spot * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.callOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.callOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.callOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.callOptionPrice(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.callOptionPrice(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.callOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.callOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.callOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.callOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("call across 5×5×3×3 strikes/times/vols/rates — 2729 gas", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await options.callOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 2729, `gas changed: ${avg} ≠ 2729 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("put", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1020, 60 / 365, 0.60, 0.05, "put");

        const actualSOL = (await options.putOptionPrice(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = blackScholesWrapped(1000, strike, time / 365, vol, rate, "put");

                const actualSOL = (await options.putOptionPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
              }
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("limits and near limit values", async function () {
        const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
        const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
        const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.44674407370955];
        const rates = [0, 0.0001, 0.0002, 3.9998, 3.999, 4];
        await testOptionRange(strikes, times, vols, rates, false, MAX_OPTION_ABS_ERROR, 10, false);
      });

      it("expired ITM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1020, 0, 0.60, 0.05, "put");

        const actualSOL = (await options.putOptionPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired ATM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1000, 0, 0.60, 0.05, "put");

        const actualSOL = (await options.putOptionPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired OTM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 980, 0, 0.60, 0.05, "put");

        const actualSOL = (await options.putOptionPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("no volatility multiple strikes and expirations", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [200, 800, 1000, 1200, 5000];
        const times = [1, 2, 10, 30, 60, SEC_IN_YEAR, 2 * SEC_IN_YEAR];
        const rates = [0, 0.05, 4];

        for (let strike of strikes) {
          for (let time of times) {
            for (let rate of rates) {
              const expected = blackScholesWrapped(1000, strike, time / SEC_IN_YEAR, 0, rate, "put");
      
              const actualSOL = (await options.putOptionPrice(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
              assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
            }
          }
        }
      });

      it("clamps a deep-OTM put to 0 when discounted-strike·N(-d2) rounds below spot·N(-d1)", async function () {
        const { options } = await loadFixture(deploy);
        // Deep-OTM put (spot $1000, strike $700): the true value is sub-wei, so
        // integer rounding tips strikeNd2 below spotNd1 — exercises the `: 0` clamp.
        const actualSOL = await options.putOptionPrice(tokens(1000), tokens(700), 7 * SEC_IN_DAY, tokens(0.3), tokens(0.05));
        assert.equal(actualSOL.toString(), "0");
      });
    });

    describe("random", function () {
      it("lower strikes", async function () {
        const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, false, MAX_OPTION_ABS_ERROR, 10, !fastTest);
      });

      it("higher strikes", async function () {
        const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, false, MAX_OPTION_ABS_ERROR, 10, !fastTest);
      });
    });

    describe("failure", function () {
      it("rejects when spot < min spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.putOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        await options.putOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.putOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
      });

      it("rejects when spot > max spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.putOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        await options.putOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.putOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
      });

      it("rejects when strike < spot / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.putOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.putOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.putOptionPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > spot * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.putOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.putOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.putOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.putOptionPrice(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.putOptionPrice(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.putOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.putOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.putOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.putOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("put across 5×5×3×3 strikes/times/vols/rates — 2739 gas", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await options.putOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 2739, `gas changed: ${avg} ≠ 2739 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("delta", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expectedCall = greeks.getDelta(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const expectedPut = greeks.getDelta(1000, 980, 60 / 365, 0.60, 0.05, "put");
        
        const actualSOL = await options.delta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, expectedCall, MAX_DELTA_ABS_ERROR);
        assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, expectedPut, MAX_DELTA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expectedCall = greeks.getDelta(1000, strike, time / 365, vol, rate, "call");
                const expectedPut = greeks.getDelta(1000, strike, time / 365, vol, rate, "put");

                const actualSOL = await options.delta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, expectedCall, MAX_DELTA_ABS_ERROR);
                assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, expectedPut, MAX_DELTA_ABS_ERROR);
              }
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("limits and near limit values", async function () {
        const strikes = [...testStrikePoints.slice(0, 2), ...testStrikePoints.slice(-2)];
        const times = [...testTimePoints.slice(0, 2), ...testTimePoints.slice(-2)];
        const vols = [0.0001, 0.0001001, 18.34674407370955, 18.446744073709551];
        const rates = [0, 0.0001, 3.9999, 4];
        await testGreekRange("delta", strikes, times, vols, rates);
      });

      it("expired ITM call", async function () {
        const { options } = await loadFixture(deploy);

        const actualSOL = await options.delta(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, 1, MAX_DELTA_ABS_ERROR);
        assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, 0, MAX_DELTA_ABS_ERROR);
      });

      it("expired ITM put", async function () {
        const { options } = await loadFixture(deploy);

        const actualSOL = await options.delta(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, 0, MAX_DELTA_ABS_ERROR);
        assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, 1, MAX_DELTA_ABS_ERROR);
      });
    });

    describe("failure", function () {
      it("rejects when spot < min spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        await options.delta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.delta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
      });

      it("rejects when spot > max spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        await options.delta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.delta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
      });

      it("rejects when strike < spot / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.delta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.delta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > spot * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.delta(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.delta(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.delta(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.delta(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.delta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.delta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("delta across 5×5×3×3 strikes/times/vols/rates — 1724 gas", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await options.deltaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 1724, `gas changed: ${avg} ≠ 1724 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("gamma", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = greeks.getGamma(1000, 980, 60 / 365, 0.60, 0.05);
        
        const actualSOL = (await options.gamma(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_GAMMA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = greeks.getGamma(1000, strike, time / 365, vol, rate, "call");

                const actualSOL = (await options.gamma(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_GAMMA_ABS_ERROR);
              }
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("limits and near limit values", async function () {
        const strikes = [...testStrikePoints.slice(0, 2), ...testStrikePoints.slice(-2)];
        const times = [...testTimePoints.slice(0, 2), ...testTimePoints.slice(-2)];
        const vols = [0.0001, 0.0001001, 18.34674407370955, 18.446744073709551];
        const rates = [0, 0.0001, 3.9999, 4];
        await testGreekRange("gamma", strikes, times, vols, rates);
      });

      it("expired option", async function () {
        const { options } = await loadFixture(deploy);

        const actualSOL = await options.gamma(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.toString() / 1e18, 0, MAX_GAMMA_ABS_ERROR);
      });
    });

    describe("failure", function () {
      it("rejects when spot < min spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        await options.gamma("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.gamma(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
      });

      it("rejects when spot > max spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        await options.gamma("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.gamma("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
      });

      it("rejects when strike < spot / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.gamma(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.gamma(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > spot * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.gamma(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.gamma(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.gamma(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.gamma(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.gamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.gamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("gamma across 5×5×3×3 strikes/times/vols/rates — 1496 gas", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await options.gammaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 1496, `gas changed: ${avg} ≠ 1496 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("theta", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expectedCall = greeks.getTheta(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const expectedPut = greeks.getTheta(1000, 980, 60 / 365, 0.60, 0.05, "put");
        
        const actualSOL = await options.theta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.thetaCall.toString() / 1e18, expectedCall, MAX_THETA_ABS_ERROR);
        assertAbsoluteBelow(actualSOL.thetaPut.toString() / 1e18, expectedPut, MAX_THETA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expectedCall = greeks.getTheta(1000, strike, time / 365, vol, rate, "call");
                const expectedPut = greeks.getTheta(1000, strike, time / 365, vol, rate, "put");

                const actualSOL = await options.theta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                assertAbsoluteBelow(actualSOL.thetaCall.toString() / 1e18, expectedCall, MAX_THETA_ABS_ERROR);
                assertAbsoluteBelow(actualSOL.thetaPut.toString() / 1e18, expectedPut, MAX_THETA_ABS_ERROR);
              }
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("limits and near limit values", async function () {
        const strikes = [...testStrikePoints.slice(0, 2), ...testStrikePoints.slice(-2)];
        const times = [...testTimePoints.slice(0, 2), ...testTimePoints.slice(-2)];
        const vols = [0.0001, 0.0001001, 18.34674407370955, 18.446744073709551];
        const rates = [0, 0.0001, 3.9999, 4];
        await testGreekRange("theta", strikes, times, vols, rates);
      });

      it("expired option", async function () {
        const { options } = await loadFixture(deploy);

        const actualSOL = await options.theta(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.thetaCall.toString() / 1e18, 0, MAX_THETA_ABS_ERROR);
        assertAbsoluteBelow(actualSOL.thetaPut.toString() / 1e18, 0, MAX_THETA_ABS_ERROR);
      });
    });

    describe("failure", function () {
      it("rejects when spot < min spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        await options.theta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.theta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
      });

      it("rejects when spot > max spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        await options.theta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.theta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
      });

      it("rejects when strike < spot / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.theta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.theta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > spot * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.theta(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.theta(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.theta(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.theta(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.theta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.theta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("theta across 5×5×3×3 strikes/times/vols/rates — 3290 gas", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await options.thetaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 3290, `gas changed: ${avg} ≠ 3290 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("vega", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = greeks.getVega(1000, 980, 60 / 365, 0.60, 0.05);
        
        const actualSOL = (await options.vega(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_VEGA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = greeks.getVega(1000, strike, time / 365, vol, rate, "call");

                const actualSOL = (await options.vega(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_VEGA_ABS_ERROR);
              }
            }
          }
        }
      });
    });

    describe("limits", function () {
      it("limits and near limit values", async function () {
        const strikes = [...testStrikePoints.slice(0, 2), ...testStrikePoints.slice(-2)];
        const times = [...testTimePoints.slice(0, 2), ...testTimePoints.slice(-2)];
        const vols = [0.0001, 0.0001001, 18.34674407370955, 18.446744073709551];
        const rates = [0, 0.0001, 3.9999, 4];
        await testGreekRange("vega", strikes, times, vols, rates);
      });

      it("expired option", async function () {
        const { options } = await loadFixture(deploy);

        const actualSOL = await options.vega(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.toString() / 1e18, 0, MAX_VEGA_ABS_ERROR);
      });
    });

    describe("failure", function () {
      it("rejects when spot < min spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        await options.vega("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.vega(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
      });

      it("rejects when spot > max spot", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        await options.vega("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.vega("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
      });

      it("rejects when strike < spot / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.vega(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.vega(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > spot * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.vega(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.vega(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.vega(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.vega(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.vega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.vega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("vega across 5×5×3×3 strikes/times/vols/rates — 1436 gas", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await options.vegaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 1436, `gas changed: ${avg} ≠ 1436 — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("impliedVolatility", function () {
    const MAX_IV_REL_ERROR = 1e-6;

    async function roundTripIV(spot, strike, timeSec, vol, rate, isCall) {
      const { options } = await loadFixture(deploy);
      const price = await options[isCall ? "callOptionPrice" : "putOptionPrice"](tokens(spot), tokens(strike), timeSec, tokens(vol), tokens(rate));
      const iv = (await options.impliedVolatility(tokens(spot), tokens(strike), timeSec, tokens(rate), price, isCall)).toString() / 1e18;
      const relError = Math.abs(iv - vol) / vol;
      assert.isBelow(relError, MAX_IV_REL_ERROR, `IV mismatch: expected ${vol}, got ${iv}`);
    }

    describe("behaviour", function () {
      it("single round-trip ATM call", async function () {
        await roundTripIV(1000, 1000, 30 * SEC_IN_DAY, 0.5, 0.05, true);
      });

      it("single round-trip ATM put", async function () {
        await roundTripIV(1000, 1000, 30 * SEC_IN_DAY, 0.5, 0.05, false);
      });

      it("round-trip across strike/time/vol/rate matrix (call)", async function () {
        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                await roundTripIV(1000, strike, time * SEC_IN_DAY, vol, rate, true);
              }
            }
          }
        }
      });

      it("round-trip across strike/time/vol/rate matrix (put)", async function () {
        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                await roundTripIV(1000, strike, time * SEC_IN_DAY, vol, rate, false);
              }
            }
          }
        }
      });

    });

    describe("limits", function () {
      it("low vol round-trip (vol near solver's lower bound)", async function () {
        await roundTripIV(1000, 1000, 30 * SEC_IN_DAY, 0.05, 0.05, true);
        await roundTripIV(1000, 1000, 30 * SEC_IN_DAY, 0.10, 0.05, true);
      });

      it("high vol round-trip (vol near solver's upper bound)", async function () {
        await roundTripIV(1000, 1000, 30 * SEC_IN_DAY, 2, 0.05, true);
        await roundTripIV(1000, 1000, 30 * SEC_IN_DAY, 5, 0.05, true);
      });
    });

    describe("failure", function () {
      it("rejects when spot is out of bounds", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility("999999999999", tokens(1000), 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "SpotLowerBoundError");
        await assertRevertError(options, options.impliedVolatility("1000000000000000000000000000000001", "1000000000000000000000000000000000", 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "SpotUpperBoundError");
      });

      it("rejects when strike is out of bounds", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility(tokens(1000), "5000000000000000000001", 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "StrikeUpperBoundError");
        await assertRevertError(options, options.impliedVolatility(tokens(1000), "199999999999999999999", 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "StrikeLowerBoundError");
      });

      it("rejects when expiration exceeds max", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 1009152001, tokens(0.05), tokens(50), true), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate exceeds max", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(18), tokens(50), true), "RateUpperBoundError");
      });

      it("rejects when timeToExp = 0", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 0, tokens(0.05), tokens(50), true), "TimeToExpiryLowerBoundError");
      });

      it("rejects when call price below intrinsic", async function () {
        const { options } = await loadFixture(deploy);
        // ITM call: spot=1000, strike=900, intrinsic > 100·e^(-rτ); pricing 50 is below intrinsic
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(900), 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "PriceOutOfBoundsError");
      });

      it("rejects when call price >= spot", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.05), tokens(1000), true), "PriceOutOfBoundsError");
      });

      it("rejects when put price >= K·e^(-rT)", async function () {
        const { options } = await loadFixture(deploy);
        // For strike=1000, rate=0.05, t=30d: K·e^(-rτ) ≈ 995.89; rejecting 1000
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.05), tokens(1000), false), "PriceOutOfBoundsError");
      });

      it("rejects when put price below intrinsic", async function () {
        const { options } = await loadFixture(deploy);
        // ITM put: spot=1000, strike=1100, lower no-arb bound K·e^(-rτ)-S ≈ 95.5; pricing 50 is below it
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1100), 30 * SEC_IN_DAY, tokens(0.05), tokens(50), false), "PriceOutOfBoundsError");
      });

      it("rejects an unsolvable call below the min-volatility price", async function () {
        const { options } = await loadFixture(deploy);
        // Deep-OTM 2y call priced above what any σ ≥ MIN_VOL_IV produces: the solver
        // floors σ at MIN_VOL_IV, where vega vanishes, and gives up.
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(4000), 730 * SEC_IN_DAY, tokens(0.05), tokens(800), true), "NoConvergenceError");
      });

      it("rejects an unsolvable call near the upper no-arb bound", async function () {
        const { options } = await loadFixture(deploy);
        // Price just shy of spot demands σ above MAX_VOL_IV: the solver caps σ and exhausts its iterations.
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.05), tokens(999.9), true), "NoConvergenceError");
      });

      it("rejects an unsolvable put below the min-volatility price", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(250), 730 * SEC_IN_DAY, tokens(0.05), tokens(150), false), "NoConvergenceError");
      });

      it("rejects an unsolvable put near the upper no-arb bound", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.05), tokens(995), false), "NoConvergenceError");
      });
    });

    describe("performance", function () {
      it("impliedVolatility across 5×5×3×3 strikes/times/vols/rates — 12355 gas (call) / 12431 gas (put)", async function () {
        const { options } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];
        const N = strikes.length * times.length * vols.length * rates.length;  // 225

        let callGas = 0, putGas = 0;
        for (const isCall of [true, false]) {
          for (const strike of strikes) {
            for (const time of times) {
              for (const vol of vols) {
                for (const rate of rates) {
                  const price = await options[isCall ? "callOptionPrice" : "putOptionPrice"](tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                  const gas = parseInt((await options.impliedVolatilityMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(rate), price, isCall)).gasUsed);
                  if (isCall) callGas += gas; else putGas += gas;
                }
              }
            }
          }
        }
        const avgCall = Math.round(callGas / N);
        const avgPut  = Math.round(putGas / N);
        assert.equal(avgCall, 12355, `gas changed: ${avgCall} ≠ 12355 — deterministic, update threshold if intentional`);
        assert.equal(avgPut, 12431, `gas changed: ${avgPut} ≠ 12431 — deterministic, update threshold if intentional`);
      });
    });
  });


});
