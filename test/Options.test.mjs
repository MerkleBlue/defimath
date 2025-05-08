
import { assert, expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { BlackScholesNUMJS } from "../poc/blackscholes/BlackScholesNUMJS.mjs";
import bs from "black-scholes";
import greeks from "greeks";
import { assertAbsoluteBelow, assertRevertError, generateRandomTestPoints, generateTestStrikePoints, generateTestTimePoints, MIN_ERROR, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const fastTest = true;

const MAX_OPTION_ABS_ERROR = 1.1e-10; // in $, for a call/put option on underlying valued at $1000
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

describe("DeFiMathOptions (SOL and JS)", function () {
  let blackScholesJS;
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const [owner] = await ethers.getSigners();

    // deploy contract that uses BlackScholesNUM library, use it for all tests
    const OptionsWrapper = await ethers.getContractFactory("OptionsWrapper");
    const options = await OptionsWrapper.deploy();

    return { owner, options };
  }

  async function deployCompare() {
    const [owner] = await ethers.getSigners();

    // deploy contract that uses BlackScholesNUM library, use it for all tests
    const OptionsWrapper = await ethers.getContractFactory("OptionsWrapper");
    const options = await OptionsWrapper.deploy();

    const AdapterDerivexyz = await ethers.getContractFactory("AdapterDerivexyz");
    const adapterDerivexyz = await AdapterDerivexyz.deploy();

    const AdapterPremia = await ethers.getContractFactory("AdapterPremia");
    const adapterPremia = await AdapterPremia.deploy();

    const AdapterParty = await ethers.getContractFactory("AdapterParty");
    const adapterParty = await AdapterParty.deploy();

    const AdapterDopex = await ethers.getContractFactory("AdapterDopex");
    const adapterDopex = await AdapterDopex.deploy();

    return { owner, options, adapterDerivexyz, adapterPremia, adapterParty, adapterDopex };
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
              actualSOL = (await options.getCallOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate))).toString() / 1e18;
            } else {
              actualSOL = (await options.getPutOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate))).toString() / 1e18;
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

    blackScholesJS = new BlackScholesNUMJS();
  });

  describe("performance", function () {
    describe("call", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await options.getCallOptionPriceMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("multiple in typical range", async function () {
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
                totalGas += parseInt((await options.getCallOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("put", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await options.getPutOptionPriceMG(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("multiple in typical range", async function () {
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
                totalGas += parseInt((await options.getPutOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("delta", function () {
      it("multiple in typical range", async function () {
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
                totalGas += parseInt((await options.getDeltaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("gamma", function () {
      it("multiple in typical range", async function () {
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
                totalGas += parseInt((await options.getGammaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("theta", function () {
      it("multiple in typical range", async function () {
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
                totalGas += parseInt((await options.getThetaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });
  });

  describe("functionality", function () {
    describe("call", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const actualJS = blackScholesJS.getCallOptionPrice(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05);
        assertAbsoluteBelow(actualJS, expected, MAX_OPTION_ABS_ERROR);

        const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
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
                const actualJS = blackScholesJS.getCallOptionPrice(1000, strike, time * SEC_IN_DAY, vol, rate);
                assertAbsoluteBelow(actualJS, expected, MAX_OPTION_ABS_ERROR);

                const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
              }
            }
          }
        }
      });

      // todo: neverending random test

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testOptionRange(strikes, times, vols, rates, true, MAX_OPTION_ABS_ERROR, 10, false);
        });

        // todo: test with vol max only SOL

        it("expired ITM", async function () {
          const { options } = await loadFixture(deploy);
          const expected = blackScholesWrapped(1000, 980, 0, 0.60, 0.05, "call");
  
          const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { options } = await loadFixture(deploy);
          const expected = blackScholesWrapped(1000, 1000, 0, 0.60, 0.05, "call");
  
          const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { options } = await loadFixture(deploy);
          const expected = blackScholesWrapped(1000, 1020, 0, 0.60, 0.05, "call");

          const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
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
        
                const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
              }
            }
          }
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

      describe("regression", function () {
        it("handles when N(d1) == N(d2) for OTM option", async function () {
          const { options } = await loadFixture(deploy);
          const expected = blackScholesWrapped(1000, 1200, 1 / 365, 0.40, 0.05, "call");

          const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(1200), 1 * SEC_IN_DAY, tokens(0.40), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { options } = await loadFixture(deploy);
          const expected = blackScholesWrapped(1000, 1020, 1 / SEC_IN_YEAR, 0, 0.05, "call");
  
          const actualSOL = (await options.getCallOptionPrice(tokens(1000), tokens(1020), 1, 0, tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getCallOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await options.getCallOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getCallOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getCallOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await options.getCallOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getCallOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await options.getCallOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await options.getCallOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await options.getCallOptionPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05)); // todo: check value when 2 years in another test
          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await options.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(options, options.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("put", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = blackScholesWrapped(1000, 1020, 60 / 365, 0.60, 0.05, "put");

        const actualSOL = (await options.getPutOptionPrice(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
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

                const actualSOL = (await options.getPutOptionPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
              }
            }
          }
        }
      });

      // todo: neverending random test

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
  
          const actualSOL = (await options.getPutOptionPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { options } = await loadFixture(deploy);
          const expected = blackScholesWrapped(1000, 1000, 0, 0.60, 0.05, "put");
  
          const actualSOL = (await options.getPutOptionPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { options } = await loadFixture(deploy);
          const expected = blackScholesWrapped(1000, 980, 0, 0.60, 0.05, "put");
  
          const actualSOL = (await options.getPutOptionPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
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
        
                const actualSOL = (await options.getPutOptionPrice(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_OPTION_ABS_ERROR);
              }
            }
          }
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

      describe("regression", function () {
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getPutOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await options.getPutOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getPutOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getPutOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await options.getPutOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getPutOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await options.getPutOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await options.getPutOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await options.getPutOptionPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await options.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(options, options.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("delta", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expectedCall = greeks.getDelta(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const expectedPut = greeks.getDelta(1000, 980, 60 / 365, 0.60, 0.05, "put");
        
        const actualSOL = await options.getDelta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
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

                const actualSOL = await options.getDelta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, expectedCall, MAX_DELTA_ABS_ERROR);
                assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, expectedPut, MAX_DELTA_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("expired ITM call", async function () {
          const { options } = await loadFixture(deploy);
  
          const actualSOL = await options.getDelta(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, 1, MAX_DELTA_ABS_ERROR);
          assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, 0, MAX_DELTA_ABS_ERROR);
        });

        it("expired ITM put", async function () {
          const { options } = await loadFixture(deploy);
  
          const actualSOL = await options.getDelta(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(actualSOL.deltaCall.toString() / 1e18, 0, MAX_DELTA_ABS_ERROR);
          assertAbsoluteBelow(actualSOL.deltaPut.toString() / 1e18, 1, MAX_DELTA_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getDelta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await options.getDelta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getDelta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getDelta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await options.getDelta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getDelta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getDelta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await options.getDelta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
          await assertRevertError(options, options.getDelta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getDelta(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await options.getDelta(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getDelta(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getDelta(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await options.getDelta(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(options, options.getDelta(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getDelta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await options.getDelta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(options, options.getDelta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("gamma", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = greeks.getGamma(1000, 980, 60 / 365, 0.60, 0.05);
        
        const actualSOL = (await options.getGamma(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
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

                const actualSOL = (await options.getGamma(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_GAMMA_ABS_ERROR);
              }
            }
          }
        }
      });

      // todo: random tests

      describe("limits", function () {
        it("expired option", async function () {
          const { options } = await loadFixture(deploy);
  
          const actualSOL = await options.getGamma(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(actualSOL.toString() / 1e18, 0, MAX_GAMMA_ABS_ERROR);
        });
      });


      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getGamma("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await options.getGamma("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getGamma(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getGamma("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await options.getGamma("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getGamma("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getGamma(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await options.getGamma(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
          await assertRevertError(options, options.getGamma(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getGamma(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await options.getGamma(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getGamma(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getGamma(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await options.getGamma(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(options, options.getGamma(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getGamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await options.getGamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(options, options.getGamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("theta", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expectedCall = greeks.getTheta(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const expectedPut = greeks.getTheta(1000, 980, 60 / 365, 0.60, 0.05, "put");
        
        const actualSOL = await options.getTheta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
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

                const actualSOL = await options.getTheta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                assertAbsoluteBelow(actualSOL.thetaCall.toString() / 1e18, expectedCall, MAX_THETA_ABS_ERROR);
                assertAbsoluteBelow(actualSOL.thetaPut.toString() / 1e18, expectedPut, MAX_THETA_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("expired option", async function () {
          const { options } = await loadFixture(deploy);
  
          const actualSOL = await options.getTheta(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(actualSOL.thetaCall.toString() / 1e18, 0, MAX_THETA_ABS_ERROR);
          assertAbsoluteBelow(actualSOL.thetaPut.toString() / 1e18, 0, MAX_THETA_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getTheta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await options.getTheta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getTheta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getTheta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await options.getTheta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getTheta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getTheta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await options.getTheta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
          await assertRevertError(options, options.getTheta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getTheta(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await options.getTheta(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getTheta(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getTheta(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await options.getTheta(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(options, options.getTheta(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getTheta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await options.getTheta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(options, options.getTheta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("vega", function () {
      it("single", async function () {
        const { options } = await loadFixture(deploy);
        const expected = greeks.getVega(1000, 980, 60 / 365, 0.60, 0.05);
        
        const actualSOL = (await options.getVega(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
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

                const actualSOL = (await options.getVega(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_VEGA_ABS_ERROR);
              }
            }
          }
        }
      });

      // todo: random tests
      describe("limits", function () {
        it("expired option", async function () {
          const { options } = await loadFixture(deploy);
  
          const actualSOL = await options.getVega(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(actualSOL.toString() / 1e18, 0, MAX_VEGA_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getVega("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await options.getVega("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getVega(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getVega("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await options.getVega("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getVega("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getVega(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await options.getVega(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05))
          await assertRevertError(options, options.getVega(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getVega(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await options.getVega(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(options, options.getVega(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getVega(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await options.getVega(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05)); // todo: check value when 2 years in another test
          await assertRevertError(options, options.getVega(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { options } = await loadFixture(deploy);

          await assertRevertError(options, options.getVega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await options.getVega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(options, options.getVega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });
  });

  describe("compare", function () {
    it("call", async function () {
      const { options, adapterDerivexyz, adapterPremia, adapterParty, adapterDopex } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const expected = blackScholesWrapped(1000, strike, time / 365, vol, rate, "call");

              const result1 = await options.getCallOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.price.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);
      
              // Derivexyz
              const result2 = await adapterDerivexyz.callPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2.price.toString() / 1e18;
              avgGas2 += parseInt(result2.gasUsed);

              // Premia (using discounted strike instead of rate, it's the same, also using vol squared because it uses variance
              const result3 = await adapterPremia.callPrice(tokens(1000), tokens(strike / Math.exp(rate * time / 365)), time * SEC_IN_DAY, tokens(vol ** 2));
              const price3 = result3.price.toString() / 1e18;
              avgGas3 += parseInt(result3.gasUsed);

              // Partylikeits1983
              const result4 = await adapterParty.callPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price4 = result4.price.toString() / 1e18;
              avgGas4 += parseInt(result4.gasUsed);

              // Dopex
              const result5 = await adapterDopex.callPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price5 = result5.price.toString() / 1e18;
              avgGas5 += parseInt(result5.gasUsed);

              count++;
              const error1 = Math.abs(price1 - expected);
              const error2 = Math.abs(price2 - expected);
              const error3 = Math.abs(price3 - expected);
              const error4 = Math.abs(price4 - expected);
              maxError1 = Math.max(maxError1, error1);
              maxError2 = Math.max(maxError2, error2);
              maxError3 = Math.max(maxError3, error3);
              maxError4 = Math.max(maxError4, error4);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Derivexyz  Premia  Party1983   Dopex");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "   ", (maxError2).toExponential(1) + " ", (maxError3).toExponential(1) + "    ", (maxError4).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "  " + (avgGas3 / count).toFixed(0), "     " + (avgGas4 / count).toFixed(0), "  " + (avgGas5 / count).toFixed(0));
    });

    it("put", async function () {
      const { options, adapterDerivexyz, adapterPremia, adapterParty, adapterDopex } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const expected = blackScholesWrapped(1000, strike, time / 365, vol, rate, "put");

              const result1 = await options.getPutOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.price.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);
      
              // Derivexyz
              const result2 = await adapterDerivexyz.putPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2.price.toString() / 1e18;
              avgGas2 += parseInt(result2.gasUsed);

              // Premia (using discounted strike instead of rate, it's the same, also using vol squared because it uses variance
              const result3 = await adapterPremia.putPrice(tokens(1000), tokens(strike / Math.exp(rate * time / 365)), time * SEC_IN_DAY, tokens(vol ** 2));
              const price3 = result3.price.toString() / 1e18;
              avgGas3 += parseInt(result3.gasUsed);

              // Partylikeits1983
              const result4 = await adapterParty.putPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price4 = result4.price.toString() / 1e18;
              avgGas4 += parseInt(result4.gasUsed);

              // Dopex
              const result5 = await adapterDopex.putPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price5 = result5.price.toString() / 1e18;
              avgGas5 += parseInt(result5.gasUsed);

              count++;
              const error1 = Math.abs(price1 - expected);
              const error2 = Math.abs(price2 - expected);
              const error3 = Math.abs(price3 - expected);
              const error4 = Math.abs(price4 - expected);
              maxError1 = Math.max(maxError1, error1);
              maxError2 = Math.max(maxError2, error2);
              maxError3 = Math.max(maxError3, error3);
              maxError4 = Math.max(maxError4, error4);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Derivexyz  Premia  Party1983   Dopex");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "   ", (maxError2).toExponential(1) + " ", (maxError3).toExponential(1) + "    ", (maxError4).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "  " + (avgGas3 / count).toFixed(0), "     " + (avgGas4 / count).toFixed(0), "  " + (avgGas5 / count).toFixed(0));
    });

    it("delta", async function () {
      const { options, adapterDerivexyz, adapterParty } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const expected = greeks.getDelta(1000, strike, time / 365, vol, rate, "call");

              const result1 = await options.getDeltaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.deltaCall.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);
      
              // Derivexyz
              const result2 = await adapterDerivexyz.delta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2.deltaCall.toString() / 1e18;
              avgGas2 += parseInt(result2.gasUsed);

              // Partylikeits1983
              const result4 = await adapterParty.delta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price4 = result4.deltaCall.toString() / 1e18;
              avgGas4 += parseInt(result4.gasUsed);

              count++;
              const error1 = Math.abs(price1 - expected);
              const error2 = Math.abs(price2 - expected);
              const error4 = Math.abs(price4 - expected);
              maxError1 = Math.max(maxError1, error1);
              maxError2 = Math.max(maxError2, error2);
              maxError4 = Math.max(maxError4, error4);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Derivexyz  Premia  Party1983   Dopex");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "   ", (maxError2).toExponential(1) + "            ", (maxError4).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0) + "              " + (avgGas4 / count).toFixed(0));
    });

    it("gamma", async function () {
      const { options } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const expected = greeks.getGamma(1000, strike, time / 365, vol, rate, "call");

              const result1 = await options.getGammaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.gamma.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);

              count++;
              const error1 = Math.abs(price1 - expected);
              maxError1 = Math.max(maxError1, error1);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Derivexyz  Premia  Party1983   Dopex");
      console.log("Max abs error  ", (maxError1).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0));
    });

    it("theta", async function () {
      const { options, adapterDopex } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const expected = greeks.getTheta(1000, strike, time / 365, vol, rate, "call");

              const result1 = await options.getThetaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.thetaCall.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);
  
              count++;
              const error1 = Math.abs(price1 - expected);
              maxError1 = Math.max(maxError1, error1);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Derivexyz  Premia  Party1983   Dopex");
      console.log("Max abs error  ", (maxError1).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0));
    });

    it("vega", async function () {
      const { options, adapterDerivexyz } = await loadFixture(deployCompare);
  
      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];
  
      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;
  
      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const expected = greeks.getVega(1000, strike, time / 365, vol, rate, "call");
  
              const result1 = await options.getVegaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.vega.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);
      
              // Derivexyz
              const result2 = await adapterDerivexyz.vega(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2._vega.toString() / 1e18;
              avgGas2 += parseInt(result2.gasUsed);
  
              count++;
              const error1 = Math.abs(price1 - expected);
              const error2 = Math.abs(price2 - expected);
              maxError1 = Math.max(maxError1, error1);
              maxError2 = Math.max(maxError2, error2);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Derivexyz  Premia  Party1983   Dopex");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "   ", (maxError2).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0));
    });
  });
});
