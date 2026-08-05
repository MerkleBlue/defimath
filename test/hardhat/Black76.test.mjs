
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import bs from "black-scholes";
import greeks from "greeks";
import { assertAbsoluteBelow, assertPrecisionBelow, assertRevertError, generateRandomTestPoints, generateTestStrikePoints, generateTestTimePoints, MIN_ERROR, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";
import { MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_DELTA, MAX_REL_ERROR_B76_GAMMA, MAX_ABS_ERROR_B76_GAMMA, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA, MAX_REL_ERROR_B76_VEGA, MAX_ABS_ERROR_B76_VEGA, MAX_REL_ERROR_B76_IV, MAX_ABS_ERROR_B76_IV, AVG_GAS_B76_CALL, AVG_GAS_B76_PUT, AVG_GAS_B76_DELTA, AVG_GAS_B76_GAMMA, AVG_GAS_B76_THETA, AVG_GAS_B76_VEGA, AVG_GAS_B76_IV_CALL, AVG_GAS_B76_IV_PUT } from "../../constants/Constants.mjs";

const fastTest = true;

// Black-76 reference = e^(-rτ) · Black-Scholes(spot = F, rate = 0), driven by the same
// `black-scholes` and `greeks` npm packages the BlackScholes suite uses — there is no Black-76
// package, and the discount transform is exact. bs returns NaN at time = 0, so we wrap it.
export function black76Wrapped(future, strike, time, vol, rate, callOrPut) {
  // handle expired option
  if (time <= 0) {
    if (callOrPut === "call") {
      return Math.max(0, future - strike);
    } else {
      return Math.max(0, strike - future);
    }
  }

  vol += 1e-16;

  return Math.exp(-rate * time) * Math.max(0, bs.blackScholes(future, strike, time, vol, 0, callOrPut));
}

// Greek references: same transform. Price/delta/gamma/vega scale by the discount; theta gains a
// carry term because the discount factor itself depends on time: θ₇₆ = r·price + e^(-rτ)·θ_BS.
function b76Delta(future, strike, time, vol, rate, callOrPut) {
  return Math.exp(-rate * time) * greeks.getDelta(future, strike, time, vol, 0, callOrPut);
}
function b76Gamma(future, strike, time, vol, rate, callOrPut) {
  return Math.exp(-rate * time) * greeks.getGamma(future, strike, time, vol, 0, callOrPut);
}
function b76Vega(future, strike, time, vol, rate, callOrPut) {
  return Math.exp(-rate * time) * greeks.getVega(future, strike, time, vol, 0, callOrPut);
}
function b76Theta(future, strike, time, vol, rate, callOrPut) {
  const disc = Math.exp(-rate * time);
  const price = black76Wrapped(future, strike, time, vol, rate, callOrPut);
  return disc * greeks.getTheta(future, strike, time, vol, 0, callOrPut) + rate * price / 365;
}

describe("Black76", function () {
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const Black76Wrapper = await ethers.getContractFactory("Black76Wrapper");
    const options = await Black76Wrapper.deploy();

    return { options };
  }

  async function testOptionRange(strikePoints, timePoints, volPoints, ratePoints, isCall, multi = 10, log = false) {
    const { options } = await loadFixture(deploy);
    const cp = isCall ? "call" : "put";
    let maxAbs = 0, maxRel = 0, count = 0;
    for (const strike of strikePoints) {
      for (const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            const expected = black76Wrapped(100 * multi, strike * multi, exp / SEC_IN_YEAR, vol, rate, cp);
            const actualSOL = (await options[cp](tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate))).toString() / 1e18;

            // dual metric: relative where |price| >= 1, absolute where < 1 (deep OTM)
            assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);

            const abs = Math.abs(actualSOL - expected);
            if (Math.abs(expected) < 1) maxAbs = Math.max(maxAbs, abs);
            else maxRel = Math.max(maxRel, abs / Math.abs(expected));
            count++;
          }
        }
      }
    }
    if (log) console.log(`  ${cp}: ${count} pts — max abs (|y|<1) ${maxAbs.toExponential(2)}, max rel (|y|>=1) ${maxRel.toExponential(2)}`);
  }

  // before all tests, called once
  before(async () => {
    testTimePoints = generateTestTimePoints();
    testStrikePoints = generateTestStrikePoints(5, 500);
  });

  // Greek-agnostic 4D sweep helper — same shape as testOptionRange but for delta/gamma/theta/vega.
  // Each greek has its own JS reference (greeks library), Solidity wrapper, and tolerance.
  // strikePoints/timePoints are raw values; multi scales them to the {future=100*multi} test world.
  async function testGreekRange(greekName, strikePoints, timePoints, volPoints, ratePoints, multi = 10, log = false) {
    const { options } = await loadFixture(deploy);
    const future = 100 * multi;
    let maxAbs = 0, maxRel = 0;
    const track = (a, e) => { const abs = Math.abs(a - e); if (Math.abs(e) < 1) maxAbs = Math.max(maxAbs, abs); else maxRel = Math.max(maxRel, abs / Math.abs(e)); };
    for (const strike of strikePoints) {
      for (const time of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            const k = strike * multi;
            const t = time / SEC_IN_YEAR;
            switch (greekName) {
              case "delta": {
                // delta ∈ [-1, 1] → absolute error only (no relative)
                const expectedCall = b76Delta(future, k, t, vol, rate, "call");
                const expectedPut = b76Delta(future, k, t, vol, rate, "put");
                const actual = await options.delta(tokens(future), tokens(k), time, tokens(vol), tokens(rate));
                const aC = actual.deltaCall.toString() / 1e18, aP = actual.deltaPut.toString() / 1e18;
                assertAbsoluteBelow(aC, expectedCall, MAX_ABS_ERROR_B76_DELTA);
                assertAbsoluteBelow(aP, expectedPut, MAX_ABS_ERROR_B76_DELTA);
                track(aC, expectedCall); track(aP, expectedPut);
                break;
              }
              case "gamma": {
                const expected = b76Gamma(future, k, t, vol, rate, "call");
                const actual = (await options.gamma(tokens(future), tokens(k), time, tokens(vol), tokens(rate))).toString() / 1e18;
                assertPrecisionBelow(actual, expected, MAX_REL_ERROR_B76_GAMMA, MAX_ABS_ERROR_B76_GAMMA);
                track(actual, expected);
                break;
              }
              case "theta": {
                const expectedCall = b76Theta(future, k, t, vol, rate, "call");
                const expectedPut = b76Theta(future, k, t, vol, rate, "put");
                const actual = await options.theta(tokens(future), tokens(k), time, tokens(vol), tokens(rate));
                const aC = actual.thetaCall.toString() / 1e18, aP = actual.thetaPut.toString() / 1e18;
                assertPrecisionBelow(aC, expectedCall, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
                assertPrecisionBelow(aP, expectedPut, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
                track(aC, expectedCall); track(aP, expectedPut);
                break;
              }
              case "vega": {
                const expected = b76Vega(future, k, t, vol, rate, "call");
                const actual = (await options.vega(tokens(future), tokens(k), time, tokens(vol), tokens(rate))).toString() / 1e18;
                assertPrecisionBelow(actual, expected, MAX_REL_ERROR_B76_VEGA, MAX_ABS_ERROR_B76_VEGA);
                track(actual, expected);
                break;
              }
            }
          }
        }
      }
    }
    if (log) console.log(`  ${greekName}: max abs (|y|<1) ${maxAbs.toExponential(2)}, max rel (|y|>=1) ${maxRel.toExponential(2)}`);
  }

  describe("call", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 980, 60 / 365, 0.60, 0.05, "call");

        const actualSOL = (await options.call(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
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
                const expected = black76Wrapped(1000, strike, time / 365, vol, rate, "call");

                const actualSOL = (await options.call(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
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
        await testOptionRange(strikes, times, vols, rates, true, 10);
      });

      it("expired ITM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 980, 0, 0.60, 0.05, "call");

        const actualSOL = (await options.call(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired ATM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 1000, 0, 0.60, 0.05, "call");

        const actualSOL = (await options.call(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired OTM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 1020, 0, 0.60, 0.05, "call");

        const actualSOL = (await options.call(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
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
              const expected = black76Wrapped(1000, strike, time / SEC_IN_YEAR, 0, rate, "call");
      
              const actualSOL = (await options.call(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
              assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
            }
          }
        }
      });

      it("handles when N(d1) == N(d2) for OTM option", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 1200, 1 / 365, 0.40, 0.05, "call");

        const actualSOL = (await options.call(tokens(1000), tokens(1200), 1 * SEC_IN_DAY, tokens(0.40), tokens(0.05))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
      });

      it("handles when vol is 0, and time lowest", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 1020, 1 / SEC_IN_YEAR, 0, 0.05, "call");

        const actualSOL = (await options.call(tokens(1000), tokens(1020), 1, 0, tokens(0.05))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
      });
    });

    describe("random", function () {
      it("lower strikes", async function () {
        const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, true, 10);
      });

      it("higher strikes", async function () {
        const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, true, 10);
      });
    });

    describe("failure", function () {
      it("rejects when future < min future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.call("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
        await options.call("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.call(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
      });

      it("rejects when future > max future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.call("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
        await options.call("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.call("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
      });

      it("rejects when strike < future / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.call(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.call(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.call(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > future * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.call(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.call(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.call(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.call(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.call(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.call(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.call(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.call(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.call(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("call across 5×5×3×3 strikes/times/vols/rates — 2552 gas", async function () {
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
                totalGas += parseInt((await options.callMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, AVG_GAS_B76_CALL, `gas changed: ${avg} ≠ ${AVG_GAS_B76_CALL} — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("put", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 1020, 60 / 365, 0.60, 0.05, "put");

        const actualSOL = (await options.put(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
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
                const expected = black76Wrapped(1000, strike, time / 365, vol, rate, "put");

                const actualSOL = (await options.put(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
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
        await testOptionRange(strikes, times, vols, rates, false, 10);
      });

      it("expired ITM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 1020, 0, 0.60, 0.05, "put");

        const actualSOL = (await options.put(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired ATM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 1000, 0, 0.60, 0.05, "put");

        const actualSOL = (await options.put(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("expired OTM", async function () {
        const { options } = await loadFixture(deploy);
        const expected = black76Wrapped(1000, 980, 0, 0.60, 0.05, "put");

        const actualSOL = (await options.put(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
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
              const expected = black76Wrapped(1000, strike, time / SEC_IN_YEAR, 0, rate, "put");
      
              const actualSOL = (await options.put(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
              assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_OPTION, MAX_ABS_ERROR_B76_OPTION);
            }
          }
        }
      });

      it("clamps a deep-OTM put to 0 when discounted-strike·N(-d2) rounds below future·N(-d1)", async function () {
        const { options } = await loadFixture(deploy);
        // Deep-OTM put (future $1000, strike $250): the true value is sub-wei, so
        // integer rounding tips strikeNd2 below futNd1 — exercises the `: 0` clamp.
        const actualSOL = await options.put(tokens(1000), tokens(250), 1 * SEC_IN_DAY, tokens(0.1), tokens(0.05));
        assert.equal(actualSOL.toString(), "0");
      });
    });

    describe("random", function () {
      it("lower strikes", async function () {
        const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, false, 10);
      });

      it("higher strikes", async function () {
        const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
        const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
        const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
        const rates = [0, 0.1, 0.2, 4];
        await testOptionRange(strikes, times, vols, rates, false, 10);
      });
    });

    describe("failure", function () {
      it("rejects when future < min future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.put("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
        await options.put("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.put(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
      });

      it("rejects when future > max future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.put("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
        await options.put("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.put("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
      });

      it("rejects when strike < future / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.put(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.put(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.put(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > future * 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.put(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        await options.put(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.put(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.put(tokens(1000), tokens(930), 1009152001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        await options.put(tokens(1000), tokens(930), 1009152000, tokens(0.60), tokens(0.05));
        await assertRevertError(options, options.put(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.put(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
        await options.put(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
        await assertRevertError(options, options.put(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("put across 5×5×3×3 strikes/times/vols/rates — 2565 gas", async function () {
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
                totalGas += parseInt((await options.putMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, AVG_GAS_B76_PUT, `gas changed: ${avg} ≠ ${AVG_GAS_B76_PUT} — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("delta", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expectedCall = b76Delta(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const expectedPut = b76Delta(1000, 980, 60 / 365, 0.60, 0.05, "put");
        
        const actualSOL = await options.delta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, expectedCall, MAX_ABS_ERROR_B76_DELTA);
        assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, expectedPut, MAX_ABS_ERROR_B76_DELTA);
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
                const expectedCall = b76Delta(1000, strike, time / 365, vol, rate, "call");
                const expectedPut = b76Delta(1000, strike, time / 365, vol, rate, "put");

                const actualSOL = await options.delta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, expectedCall, MAX_ABS_ERROR_B76_DELTA);
                assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, expectedPut, MAX_ABS_ERROR_B76_DELTA);
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
        assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, 1, MAX_ABS_ERROR_B76_DELTA);
        assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, 0, MAX_ABS_ERROR_B76_DELTA);
      });

      it("expired ITM put", async function () {
        const { options } = await loadFixture(deploy);

        const actualSOL = await options.delta(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05));
        assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, 0, MAX_ABS_ERROR_B76_DELTA);
        assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, -1, MAX_ABS_ERROR_B76_DELTA);
      });
    });

    describe("failure", function () {
      it("rejects when future < min future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
        await options.delta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.delta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
      });

      it("rejects when future > max future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
        await options.delta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.delta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
      });

      it("rejects when strike < future / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.delta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.delta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.delta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > future * 5", async function () {
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
      it("delta across 5×5×3×3 strikes/times/vols/rates — 1915 gas", async function () {
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
        assert.equal(avg, AVG_GAS_B76_DELTA, `gas changed: ${avg} ≠ ${AVG_GAS_B76_DELTA} — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("gamma", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = b76Gamma(1000, 980, 60 / 365, 0.60, 0.05);
        
        const actualSOL = (await options.gamma(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_GAMMA, MAX_ABS_ERROR_B76_GAMMA);
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
                const expected = b76Gamma(1000, strike, time / 365, vol, rate, "call");

                const actualSOL = (await options.gamma(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_GAMMA, MAX_ABS_ERROR_B76_GAMMA);
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
        assertPrecisionBelow(actualSOL.toString() / 1e18, 0, MAX_REL_ERROR_B76_GAMMA, MAX_ABS_ERROR_B76_GAMMA);
      });
    });

    describe("failure", function () {
      it("rejects when future < min future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
        await options.gamma("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.gamma(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
      });

      it("rejects when future > max future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
        await options.gamma("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.gamma("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
      });

      it("rejects when strike < future / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.gamma(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.gamma(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.gamma(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > future * 5", async function () {
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
      it("gamma across 5×5×3×3 strikes/times/vols/rates — 1704 gas", async function () {
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
        assert.equal(avg, AVG_GAS_B76_GAMMA, `gas changed: ${avg} ≠ ${AVG_GAS_B76_GAMMA} — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("theta", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expectedCall = b76Theta(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const expectedPut = b76Theta(1000, 980, 60 / 365, 0.60, 0.05, "put");
        
        const actualSOL = await options.theta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        assertPrecisionBelow(actualSOL.thetaCall.toString() / 1e18, expectedCall, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
        assertPrecisionBelow(actualSOL.thetaPut.toString() / 1e18, expectedPut, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
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
                const expectedCall = b76Theta(1000, strike, time / 365, vol, rate, "call");
                const expectedPut = b76Theta(1000, strike, time / 365, vol, rate, "put");

                const actualSOL = await options.theta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                assertPrecisionBelow(actualSOL.thetaCall.toString() / 1e18, expectedCall, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
                assertPrecisionBelow(actualSOL.thetaPut.toString() / 1e18, expectedPut, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
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
        assertPrecisionBelow(actualSOL.thetaCall.toString() / 1e18, 0, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
        assertPrecisionBelow(actualSOL.thetaPut.toString() / 1e18, 0, MAX_REL_ERROR_B76_THETA, MAX_ABS_ERROR_B76_THETA);
      });
    });

    describe("failure", function () {
      it("rejects when future < min future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
        await options.theta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.theta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
      });

      it("rejects when future > max future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
        await options.theta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.theta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
      });

      it("rejects when strike < future / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.theta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.theta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.theta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > future * 5", async function () {
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
      it("theta across 5×5×3×3 strikes/times/vols/rates — 3255 gas", async function () {
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
        assert.equal(avg, AVG_GAS_B76_THETA, `gas changed: ${avg} ≠ ${AVG_GAS_B76_THETA} — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("vega", function () {

    describe("behaviour", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = b76Vega(1000, 980, 60 / 365, 0.60, 0.05);
        
        const actualSOL = (await options.vega(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_VEGA, MAX_ABS_ERROR_B76_VEGA);
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
                const expected = b76Vega(1000, strike, time / 365, vol, rate, "call");

                const actualSOL = (await options.vega(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertPrecisionBelow(actualSOL, expected, MAX_REL_ERROR_B76_VEGA, MAX_ABS_ERROR_B76_VEGA);
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
        assertPrecisionBelow(actualSOL.toString() / 1e18, 0, MAX_REL_ERROR_B76_VEGA, MAX_ABS_ERROR_B76_VEGA);
      });
    });

    describe("failure", function () {
      it("rejects when future < min future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
        await options.vega("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.vega(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "FutureLowerBoundError");
      });

      it("rejects when future > max future", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
        await options.vega("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
        await assertRevertError(options, options.vega("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "FutureUpperBoundError");
      });

      it("rejects when strike < future / 5", async function () {
        const { options } = await loadFixture(deploy);

        await assertRevertError(options, options.vega(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        await options.vega(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
        await assertRevertError(options, options.vega(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
      });

      it("rejects when strike > future * 5", async function () {
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
      it("vega across 5×5×3×3 strikes/times/vols/rates — 1659 gas", async function () {
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
        assert.equal(avg, AVG_GAS_B76_VEGA, `gas changed: ${avg} ≠ ${AVG_GAS_B76_VEGA} — deterministic, update threshold if intentional`);
      });
    });
  });

  describe("impliedVolatility", function () {

    async function roundTripIV(future, strike, timeSec, vol, rate, isCall) {
      const { options } = await loadFixture(deploy);
      const price = await options[isCall ? "call" : "put"](tokens(future), tokens(strike), timeSec, tokens(vol), tokens(rate));
      const iv = (await options.impliedVolatility(tokens(future), tokens(strike), timeSec, tokens(rate), price, isCall)).toString() / 1e18;
      // dual metric: relative where vol >= 1, absolute where < 1 (vols are mostly < 100%)
      assertPrecisionBelow(iv, vol, MAX_REL_ERROR_B76_IV, MAX_ABS_ERROR_B76_IV);
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
      it("rejects when future is out of bounds", async function () {
        const { options } = await loadFixture(deploy);
        await assertRevertError(options, options.impliedVolatility("999999999999", tokens(1000), 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "FutureLowerBoundError");
        await assertRevertError(options, options.impliedVolatility("1000000000000000000000000000000001", "1000000000000000000000000000000000", 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "FutureUpperBoundError");
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
        // ITM call: future=1000, strike=900, intrinsic > 100·e^(-rτ); pricing 50 is below intrinsic
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(900), 30 * SEC_IN_DAY, tokens(0.05), tokens(50), true), "PriceOutOfBoundsError");
      });

      it("rejects when call price >= future", async function () {
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
        // ITM put: future=1000, strike=1100, lower no-arb bound K·e^(-rτ)-S ≈ 95.5; pricing 50 is below it
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
        // Price just shy of the discounted future demands σ above MAX_VOL_IV: the solver caps σ and exhausts its iterations.
        await assertRevertError(options, options.impliedVolatility(tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.05), tokens(990), true), "NoConvergenceError");
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
      it("impliedVolatility across 5×5×3×3 strikes/times/vols/rates — 11760 gas (call) / 11802 gas (put)", async function () {
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
                  const price = await options[isCall ? "call" : "put"](tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                  const gas = parseInt((await options.impliedVolatilityMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(rate), price, isCall)).gasUsed);
                  if (isCall) callGas += gas; else putGas += gas;
                }
              }
            }
          }
        }
        const avgCall = Math.round(callGas / N);
        const avgPut  = Math.round(putGas / N);
        assert.equal(avgCall, AVG_GAS_B76_IV_CALL, `gas changed: ${avgCall} ≠ ${AVG_GAS_B76_IV_CALL} — deterministic, update threshold if intentional`);
        assert.equal(avgPut, AVG_GAS_B76_IV_PUT, `gas changed: ${avgPut} ≠ ${AVG_GAS_B76_IV_PUT} — deterministic, update threshold if intentional`);
      });
    });
  });


});
