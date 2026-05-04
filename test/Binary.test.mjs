
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { OptionsJS } from "../poc/blackscholes/optionsJS.mjs";
import { assertAbsoluteBelow, assertRevertError, generateRandomTestPoints, generateTestStrikePoints, generateTestTimePoints, MIN_ERROR, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const fastTest = true;

const MAX_BINARY_ABS_ERROR = 2.5e-14; // for a unit-payout binary option
const MAX_BINARY_DELTA_ABS_ERROR = 1e-13; // for unit-payout binary delta
const MAX_BINARY_GAMMA_ABS_ERROR = 1e-15; // for unit-payout binary gamma
const MAX_BINARY_THETA_ABS_ERROR = 1e-15; // for unit-payout binary theta (per day)
const MAX_BINARY_VEGA_ABS_ERROR = 1e-15; // for unit-payout binary vega (per 1% vol)

// JS reference for binary call price
function binaryCallWrapped(spot, strike, timeSec, vol, rate) {
  // handle expired option
  if (timeSec <= 0) {
    return spot > strike ? 1 : 0;
  }
  return new OptionsJS().getBinaryCallPrice(spot, strike, timeSec, vol, rate);
}

// JS reference for binary put price
function binaryPutWrapped(spot, strike, timeSec, vol, rate) {
  // handle expired option
  if (timeSec <= 0) {
    return strike > spot ? 1 : 0;
  }
  return new OptionsJS().getBinaryPutPrice(spot, strike, timeSec, vol, rate);
}

// JS reference for binary delta
function binaryDeltaWrapped(spot, strike, timeSec, vol, rate) {
  // handle expired option
  if (timeSec <= 0) {
    return { deltaCall: 0, deltaPut: 0 };
  }
  return new OptionsJS().getBinaryDelta(spot, strike, timeSec, vol, rate);
}

// JS reference for binary gamma
function binaryGammaWrapped(spot, strike, timeSec, vol, rate) {
  // handle expired option
  if (timeSec <= 0) {
    return { gammaCall: 0, gammaPut: 0 };
  }
  return new OptionsJS().getBinaryGamma(spot, strike, timeSec, vol, rate);
}

// JS reference for binary theta
function binaryThetaWrapped(spot, strike, timeSec, vol, rate) {
  // handle expired option
  if (timeSec <= 0) {
    return { thetaCall: 0, thetaPut: 0 };
  }
  return new OptionsJS().getBinaryTheta(spot, strike, timeSec, vol, rate);
}

// JS reference for binary vega
function binaryVegaWrapped(spot, strike, timeSec, vol, rate) {
  // handle expired option
  if (timeSec <= 0) {
    return { vegaCall: 0, vegaPut: 0 };
  }
  return new OptionsJS().getBinaryVega(spot, strike, timeSec, vol, rate);
}

describe("DeFiMathBinary", function () {
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const BinaryWrapper = await ethers.getContractFactory("BinaryWrapper");
    const binary = await BinaryWrapper.deploy();
    return { binary };
  }

  async function deployCompare() {
    const BinaryWrapper = await ethers.getContractFactory("BinaryWrapper");
    const binary = await BinaryWrapper.deploy();

    // Haptic's BlackScholes has public functions, so it must be deployed and linked
    const BlackScholes = await ethers.getContractFactory("contracts/test/compare/derivatives/binary/haptic/BlackScholes.sol:BlackScholes");
    const blackScholes = await BlackScholes.deploy();

    const AdapterHaptic = await ethers.getContractFactory("AdapterHaptic", {
      libraries: { "contracts/test/compare/derivatives/binary/haptic/BlackScholes.sol:BlackScholes": await blackScholes.getAddress() },
    });
    const adapterHaptic = await AdapterHaptic.deploy();

    return { binary, adapterHaptic };
  }

  async function testBinaryRange(strikePoints, timePoints, volPoints, ratePoints, isCall, maxAbsError = MAX_BINARY_ABS_ERROR, multi = 10, log = true) {
    const { binary } = await loadFixture(deploy);
    log && console.log("Max abs error: $" + maxAbsError);

    let countTotal = 0, prunedCountSOL = 0;
    const totalPoints = strikePoints.length * timePoints.length * volPoints.length * ratePoints.length;
    let errorsSOL = [];
    for (const strike of strikePoints) {
      for (const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            // expected
            const expected = isCall
              ? binaryCallWrapped(100 * multi, strike * multi, exp, vol, rate)
              : binaryPutWrapped(100 * multi, strike * multi, exp, vol, rate);

            // SOL
            const actualSOL = isCall
              ? (await binary.getBinaryCallPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate))).toString() / 1e18
              : (await binary.getBinaryPutPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate))).toString() / 1e18;

            const absErrorSOL = Math.abs(actualSOL - expected);
            const errorParamsSOL = { expiration: exp, strike: strike * multi, vol, rate, act: actualSOL, exp: expected };
            errorsSOL.push({ absErrorSOL, errorParamsSOL });

            countTotal++;

            // print progress and prune errors
            if (countTotal % Math.round(totalPoints / 10) === 0) {
              if (log) {
                const startTime = new Date().getTime();
                errorsSOL.sort((a, b) => b.absErrorSOL - a.absErrorSOL);
                console.log("Progress:", (countTotal / totalPoints * 100).toFixed(0) +
                  "%, Max abs error:", "$" + (errorsSOL[0] ? errorsSOL[0].absErrorSOL.toFixed(12) : "0") +
                  " (" + (new Date().getTime() - startTime) + "mS)");
              }

              const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
              prunedCountSOL += toDelete.length;
              errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);
            }
          }
        }
      }
    }

    const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
    prunedCountSOL += toDelete.length;
    errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);

    if (log) {
      console.log();
      console.log("REPORT SOL");
      console.log("Errors Abs/Total: " + prunedCountSOL + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");
      if (errorsSOL[0]) console.log("Max abs error params SOL: ", errorsSOL[0]);
    }

    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].absErrorSOL, maxAbsError);
    }
  }

  async function testBinaryDeltaRange(strikePoints, timePoints, volPoints, ratePoints, maxAbsError = MAX_BINARY_DELTA_ABS_ERROR, multi = 10, log = true) {
    const { binary } = await loadFixture(deploy);
    log && console.log("Max abs error: " + maxAbsError);

    let countTotal = 0, prunedCountSOL = 0;
    let errorsSOL = [];
    for (const strike of strikePoints) {
      for (const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            const expected = binaryDeltaWrapped(100 * multi, strike * multi, exp, vol, rate);

            const result = await binary.getBinaryDelta(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate));
            const actualCall = result.deltaCall.toString() / 1e18;
            const actualPut = result.deltaPut.toString() / 1e18;

            const absErrorCall = Math.abs(actualCall - expected.deltaCall);
            const absErrorPut = Math.abs(actualPut - expected.deltaPut);
            const absErrorSOL = Math.max(absErrorCall, absErrorPut);
            const errorParamsSOL = { expiration: exp, strike: strike * multi, vol, rate, actCall: actualCall, expCall: expected.deltaCall, actPut: actualPut, expPut: expected.deltaPut };
            errorsSOL.push({ absErrorSOL, errorParamsSOL });

            countTotal++;
          }
        }
      }
    }

    const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
    prunedCountSOL += toDelete.length;
    errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);

    if (log) {
      console.log();
      console.log("REPORT SOL");
      console.log("Errors Abs/Total: " + prunedCountSOL + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");
      if (errorsSOL[0]) console.log("Max abs error params SOL: ", errorsSOL[0]);
    }

    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].absErrorSOL, maxAbsError);
    }
  }

  async function testBinaryGammaRange(strikePoints, timePoints, volPoints, ratePoints, maxAbsError = MAX_BINARY_GAMMA_ABS_ERROR, multi = 10, log = true) {
    const { binary } = await loadFixture(deploy);
    log && console.log("Max abs error: " + maxAbsError);

    let countTotal = 0, prunedCountSOL = 0;
    let errorsSOL = [];
    for (const strike of strikePoints) {
      for (const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            const expected = binaryGammaWrapped(100 * multi, strike * multi, exp, vol, rate);

            const result = await binary.getBinaryGamma(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate));
            const actualCall = result.gammaCall.toString() / 1e18;
            const actualPut = result.gammaPut.toString() / 1e18;

            const absErrorCall = Math.abs(actualCall - expected.gammaCall);
            const absErrorPut = Math.abs(actualPut - expected.gammaPut);
            const absErrorSOL = Math.max(absErrorCall, absErrorPut);
            const errorParamsSOL = { expiration: exp, strike: strike * multi, vol, rate, actCall: actualCall, expCall: expected.gammaCall, actPut: actualPut, expPut: expected.gammaPut };
            errorsSOL.push({ absErrorSOL, errorParamsSOL });

            countTotal++;
          }
        }
      }
    }

    const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
    prunedCountSOL += toDelete.length;
    errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);

    if (log) {
      console.log();
      console.log("REPORT SOL");
      console.log("Errors Abs/Total: " + prunedCountSOL + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");
      if (errorsSOL[0]) console.log("Max abs error params SOL: ", errorsSOL[0]);
    }

    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].absErrorSOL, maxAbsError);
    }
  }

  async function testBinaryThetaRange(strikePoints, timePoints, volPoints, ratePoints, maxAbsError = MAX_BINARY_THETA_ABS_ERROR, multi = 10, log = true) {
    const { binary } = await loadFixture(deploy);
    log && console.log("Max abs error: " + maxAbsError);

    let countTotal = 0, prunedCountSOL = 0;
    let errorsSOL = [];
    for (const strike of strikePoints) {
      for (const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            const expected = binaryThetaWrapped(100 * multi, strike * multi, exp, vol, rate);

            const result = await binary.getBinaryTheta(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate));
            const actualCall = result.thetaCall.toString() / 1e18;
            const actualPut = result.thetaPut.toString() / 1e18;

            const absErrorCall = Math.abs(actualCall - expected.thetaCall);
            const absErrorPut = Math.abs(actualPut - expected.thetaPut);
            const absErrorSOL = Math.max(absErrorCall, absErrorPut);
            const errorParamsSOL = { expiration: exp, strike: strike * multi, vol, rate, actCall: actualCall, expCall: expected.thetaCall, actPut: actualPut, expPut: expected.thetaPut };
            errorsSOL.push({ absErrorSOL, errorParamsSOL });

            countTotal++;
          }
        }
      }
    }

    const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
    prunedCountSOL += toDelete.length;
    errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);

    if (log) {
      console.log();
      console.log("REPORT SOL");
      console.log("Errors Abs/Total: " + prunedCountSOL + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");
      if (errorsSOL[0]) console.log("Max abs error params SOL: ", errorsSOL[0]);
    }

    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].absErrorSOL, maxAbsError);
    }
  }

  async function testBinaryVegaRange(strikePoints, timePoints, volPoints, ratePoints, maxAbsError = MAX_BINARY_VEGA_ABS_ERROR, multi = 10, log = true) {
    const { binary } = await loadFixture(deploy);
    log && console.log("Max abs error: " + maxAbsError);

    let countTotal = 0, prunedCountSOL = 0;
    let errorsSOL = [];
    for (const strike of strikePoints) {
      for (const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            const expected = binaryVegaWrapped(100 * multi, strike * multi, exp, vol, rate);

            const result = await binary.getBinaryVega(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate));
            const actualCall = result.vegaCall.toString() / 1e18;
            const actualPut = result.vegaPut.toString() / 1e18;

            const absErrorCall = Math.abs(actualCall - expected.vegaCall);
            const absErrorPut = Math.abs(actualPut - expected.vegaPut);
            const absErrorSOL = Math.max(absErrorCall, absErrorPut);
            const errorParamsSOL = { expiration: exp, strike: strike * multi, vol, rate, actCall: actualCall, expCall: expected.vegaCall, actPut: actualPut, expPut: expected.vegaPut };
            errorsSOL.push({ absErrorSOL, errorParamsSOL });

            countTotal++;
          }
        }
      }
    }

    const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
    prunedCountSOL += toDelete.length;
    errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);

    if (log) {
      console.log();
      console.log("REPORT SOL");
      console.log("Errors Abs/Total: " + prunedCountSOL + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");
      if (errorsSOL[0]) console.log("Max abs error params SOL: ", errorsSOL[0]);
    }

    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].absErrorSOL, maxAbsError);
    }
  }

  before(async () => {
    testTimePoints = generateTestTimePoints();
    testStrikePoints = generateTestStrikePoints(5, 500);
  });

  describe("performance", function () {
    describe("binary call", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryCallPriceMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryCallPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("binary put", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryPutPriceMG(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryPutPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("binary delta", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryDeltaMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryDeltaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("binary gamma", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryGammaMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryGammaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("binary theta", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryThetaMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryThetaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("binary vega", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryVegaMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryVegaMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).gasUsed);
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
    describe("binary call", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryCallWrapped(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05);

        const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryCallWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

                const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryRange(strikes, times, vols, rates, true, MAX_BINARY_ABS_ERROR, 10, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 1, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          // spot == strike at expiry: not strictly ITM, returns 0
          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("no volatility multiple strikes and expirations", async function () {
          const { binary } = await loadFixture(deploy);

          const strikes = [200, 800, 1000, 1200, 5000];
          const times = [1, 2, 10, 30, 60, SEC_IN_YEAR, 2 * SEC_IN_YEAR];
          const rates = [0, 0.05, 4];

          for (const strike of strikes) {
            for (const time of times) {
              for (const rate of rates) {
                const expected = binaryCallWrapped(1000, strike, time, 0, rate);

                const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
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
          await testBinaryRange(strikes, times, vols, rates, true, MAX_BINARY_ABS_ERROR, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryRange(strikes, times, vols, rates, true, MAX_BINARY_ABS_ERROR, 10, !fastTest);
        });
      });

      describe("regression", function () {
        it("handles deep OTM (Φ(d2) → 0)", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryCallWrapped(1000, 1200, 1 * SEC_IN_DAY, 0.40, 0.05);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1200), 1 * SEC_IN_DAY, tokens(0.40), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryCallWrapped(1000, 1020, 1, 0, 0.05);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1020), 1, 0, tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await binary.getBinaryCallPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await binary.getBinaryCallPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryCallPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await binary.getBinaryCallPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await binary.getBinaryCallPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryCallPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await binary.getBinaryCallPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("binary put", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryPutWrapped(1000, 1020, 60 * SEC_IN_DAY, 0.60, 0.05);

        const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryPutWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

                const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryRange(strikes, times, vols, rates, false, MAX_BINARY_ABS_ERROR, 10, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          // strike > spot at expiry: ITM put, returns full payout
          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 1, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          // spot == strike at expiry: not strictly ITM, returns 0
          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          // spot > strike at expiry: OTM put, returns 0
          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("no volatility multiple strikes and expirations", async function () {
          const { binary } = await loadFixture(deploy);

          const strikes = [200, 800, 1000, 1200, 5000];
          const times = [1, 2, 10, 30, 60, SEC_IN_YEAR, 2 * SEC_IN_YEAR];
          const rates = [0, 0.05, 4];

          for (const strike of strikes) {
            for (const time of times) {
              for (const rate of rates) {
                const expected = binaryPutWrapped(1000, strike, time, 0, rate);

                const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(strike), time, 0, tokens(rate))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
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
          await testBinaryRange(strikes, times, vols, rates, false, MAX_BINARY_ABS_ERROR, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryRange(strikes, times, vols, rates, false, MAX_BINARY_ABS_ERROR, 10, !fastTest);
        });
      });

      describe("regression", function () {
        it("handles deep OTM (Φ(-d2) → 0)", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryPutWrapped(1000, 800, 1 * SEC_IN_DAY, 0.40, 0.05);

          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(800), 1 * SEC_IN_DAY, tokens(0.40), tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryPutWrapped(1000, 980, 1, 0, 0.05);

          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(980), 1, 0, tokens(0.05))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

        it("call + put = e^(-r*τ) (parity)", async function () {
          const { binary } = await loadFixture(deploy);

          // Φ(d2) + Φ(-d2) = 1, so binaryCall + binaryPut = e^(-r*τ)
          const args = [tokens(1000), tokens(1100), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05)];
          const callPrice = (await binary.getBinaryCallPrice(...args)).toString() / 1e18;
          const putPrice = (await binary.getBinaryPutPrice(...args)).toString() / 1e18;
          const expectedDiscount = Math.exp(-0.05 * 30 / 365);

          assertAbsoluteBelow(callPrice + putPrice, expectedDiscount, MAX_BINARY_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await binary.getBinaryPutPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await binary.getBinaryPutPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryPutPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await binary.getBinaryPutPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await binary.getBinaryPutPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryPutPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await binary.getBinaryPutPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("binary delta", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryDeltaWrapped(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05);

        const result = await binary.getBinaryDelta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        const actualCall = result.deltaCall.toString() / 1e18;
        const actualPut = result.deltaPut.toString() / 1e18;

        assertAbsoluteBelow(actualCall, expected.deltaCall, MAX_BINARY_DELTA_ABS_ERROR);
        assertAbsoluteBelow(actualPut, expected.deltaPut, MAX_BINARY_DELTA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryDeltaWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

                const result = await binary.getBinaryDelta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                const actualCall = result.deltaCall.toString() / 1e18;
                const actualPut = result.deltaPut.toString() / 1e18;

                assertAbsoluteBelow(actualCall, expected.deltaCall, MAX_BINARY_DELTA_ABS_ERROR);
                assertAbsoluteBelow(actualPut, expected.deltaPut, MAX_BINARY_DELTA_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryDeltaRange(strikes, times, vols, rates, MAX_BINARY_DELTA_ABS_ERROR, 10, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryDelta(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.deltaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.deltaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryDelta(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.deltaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.deltaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryDelta(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.deltaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.deltaPut.toString() / 1e18, 0, MIN_ERROR);
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryDeltaRange(strikes, times, vols, rates, MAX_BINARY_DELTA_ABS_ERROR, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryDeltaRange(strikes, times, vols, rates, MAX_BINARY_DELTA_ABS_ERROR, 10, !fastTest);
        });
      });

      describe("regression", function () {
        it("call delta = -put delta", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryDelta(tokens(1000), tokens(1100), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05));
          const dCall = result.deltaCall.toString() / 1e18;
          const dPut = result.deltaPut.toString() / 1e18;

          assertAbsoluteBelow(dCall + dPut, 0, MIN_ERROR);
        });

        it("delta peaks near ATM", async function () {
          const { binary } = await loadFixture(deploy);

          // For ATM (spot ≈ strike), d2 is near 0 → φ(d2) is maximal → delta is largest
          const dATM = ((await binary.getBinaryDelta(tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05))).deltaCall.toString() / 1e18);
          const dDeepITM = ((await binary.getBinaryDelta(tokens(1000), tokens(500), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05))).deltaCall.toString() / 1e18);
          const dDeepOTM = ((await binary.getBinaryDelta(tokens(1000), tokens(2000), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05))).deltaCall.toString() / 1e18);

          assert.isAbove(dATM, dDeepITM);
          assert.isAbove(dATM, dDeepOTM);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryDeltaWrapped(1000, 1020, 1, 0, 0.05);

          const result = await binary.getBinaryDelta(tokens(1000), tokens(1020), 1, 0, tokens(0.05));
          assertAbsoluteBelow(result.deltaCall.toString() / 1e18, expected.deltaCall, MAX_BINARY_DELTA_ABS_ERROR);
          assertAbsoluteBelow(result.deltaPut.toString() / 1e18, expected.deltaPut, MAX_BINARY_DELTA_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryDelta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await binary.getBinaryDelta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryDelta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryDelta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await binary.getBinaryDelta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryDelta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await binary.getBinaryDelta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await binary.getBinaryDelta(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryDelta(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await binary.getBinaryDelta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(binary, binary.getBinaryDelta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("binary gamma", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryGammaWrapped(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05);

        const result = await binary.getBinaryGamma(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        const actualCall = result.gammaCall.toString() / 1e18;
        const actualPut = result.gammaPut.toString() / 1e18;

        assertAbsoluteBelow(actualCall, expected.gammaCall, MAX_BINARY_GAMMA_ABS_ERROR);
        assertAbsoluteBelow(actualPut, expected.gammaPut, MAX_BINARY_GAMMA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryGammaWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

                const result = await binary.getBinaryGamma(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                const actualCall = result.gammaCall.toString() / 1e18;
                const actualPut = result.gammaPut.toString() / 1e18;

                assertAbsoluteBelow(actualCall, expected.gammaCall, MAX_BINARY_GAMMA_ABS_ERROR);
                assertAbsoluteBelow(actualPut, expected.gammaPut, MAX_BINARY_GAMMA_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryGammaRange(strikes, times, vols, rates, MAX_BINARY_GAMMA_ABS_ERROR, 10, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryGamma(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.gammaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.gammaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryGamma(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.gammaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.gammaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryGamma(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.gammaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.gammaPut.toString() / 1e18, 0, MIN_ERROR);
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryGammaRange(strikes, times, vols, rates, MAX_BINARY_GAMMA_ABS_ERROR, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryGammaRange(strikes, times, vols, rates, MAX_BINARY_GAMMA_ABS_ERROR, 10, !fastTest);
        });
      });

      describe("regression", function () {
        it("call gamma = -put gamma", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryGamma(tokens(1000), tokens(1100), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05));
          const gCall = result.gammaCall.toString() / 1e18;
          const gPut = result.gammaPut.toString() / 1e18;

          assertAbsoluteBelow(gCall + gPut, 0, MIN_ERROR);
        });

        it("gamma sign flips around ATM (γ_call < 0 for ITM, > 0 for OTM)", async function () {
          const { binary } = await loadFixture(deploy);

          // For deep ITM call (spot >> strike, d1 > 0): γ_call < 0
          // For deep OTM call (spot << strike, d1 < 0): γ_call > 0
          const gITM = (await binary.getBinaryGamma(tokens(1000), tokens(800), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05))).gammaCall.toString() / 1e18;
          const gOTM = (await binary.getBinaryGamma(tokens(1000), tokens(1200), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05))).gammaCall.toString() / 1e18;

          assert.isBelow(gITM, 0);
          assert.isAbove(gOTM, 0);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryGammaWrapped(1000, 1020, 1, 0, 0.05);

          const result = await binary.getBinaryGamma(tokens(1000), tokens(1020), 1, 0, tokens(0.05));
          assertAbsoluteBelow(result.gammaCall.toString() / 1e18, expected.gammaCall, MAX_BINARY_GAMMA_ABS_ERROR);
          assertAbsoluteBelow(result.gammaPut.toString() / 1e18, expected.gammaPut, MAX_BINARY_GAMMA_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryGamma("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await binary.getBinaryGamma("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryGamma(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryGamma("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await binary.getBinaryGamma("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryGamma("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await binary.getBinaryGamma(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await binary.getBinaryGamma(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryGamma(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await binary.getBinaryGamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(binary, binary.getBinaryGamma(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("binary theta", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryThetaWrapped(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05);

        const result = await binary.getBinaryTheta(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        const actualCall = result.thetaCall.toString() / 1e18;
        const actualPut = result.thetaPut.toString() / 1e18;

        assertAbsoluteBelow(actualCall, expected.thetaCall, MAX_BINARY_THETA_ABS_ERROR);
        assertAbsoluteBelow(actualPut, expected.thetaPut, MAX_BINARY_THETA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryThetaWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

                const result = await binary.getBinaryTheta(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                const actualCall = result.thetaCall.toString() / 1e18;
                const actualPut = result.thetaPut.toString() / 1e18;

                assertAbsoluteBelow(actualCall, expected.thetaCall, MAX_BINARY_THETA_ABS_ERROR);
                assertAbsoluteBelow(actualPut, expected.thetaPut, MAX_BINARY_THETA_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryThetaRange(strikes, times, vols, rates, MAX_BINARY_THETA_ABS_ERROR, 10, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryTheta(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.thetaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.thetaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryTheta(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.thetaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.thetaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryTheta(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.thetaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.thetaPut.toString() / 1e18, 0, MIN_ERROR);
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryThetaRange(strikes, times, vols, rates, MAX_BINARY_THETA_ABS_ERROR, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryThetaRange(strikes, times, vols, rates, MAX_BINARY_THETA_ABS_ERROR, 10, !fastTest);
        });
      });

      describe("regression", function () {
        it("call θ + put θ = r·e^(-rτ) (carry parity)", async function () {
          const { binary } = await loadFixture(deploy);

          // (carryCall + term)/365 + (carryPut - term)/365 = (r·e^(-rτ)·(N(d2)+N(-d2)))/365 = r·e^(-rτ)/365
          const r = 0.05, t = 30 * SEC_IN_DAY;
          const result = await binary.getBinaryTheta(tokens(1000), tokens(1100), t, tokens(0.5), tokens(r));
          const tCall = result.thetaCall.toString() / 1e18;
          const tPut = result.thetaPut.toString() / 1e18;
          const expected = r * Math.exp(-r * t / SEC_IN_YEAR) / 365;

          assertAbsoluteBelow(tCall + tPut, expected, MAX_BINARY_THETA_ABS_ERROR);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryThetaWrapped(1000, 1020, 1, 0, 0.05);

          const result = await binary.getBinaryTheta(tokens(1000), tokens(1020), 1, 0, tokens(0.05));
          assertAbsoluteBelow(result.thetaCall.toString() / 1e18, expected.thetaCall, MAX_BINARY_THETA_ABS_ERROR);
          assertAbsoluteBelow(result.thetaPut.toString() / 1e18, expected.thetaPut, MAX_BINARY_THETA_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryTheta("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await binary.getBinaryTheta("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryTheta(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryTheta("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await binary.getBinaryTheta("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryTheta("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await binary.getBinaryTheta(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await binary.getBinaryTheta(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryTheta(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await binary.getBinaryTheta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(binary, binary.getBinaryTheta(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });

    describe("binary vega", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryVegaWrapped(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05);

        const result = await binary.getBinaryVega(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05));
        const actualCall = result.vegaCall.toString() / 1e18;
        const actualPut = result.vegaPut.toString() / 1e18;

        assertAbsoluteBelow(actualCall, expected.vegaCall, MAX_BINARY_VEGA_ABS_ERROR);
        assertAbsoluteBelow(actualPut, expected.vegaPut, MAX_BINARY_VEGA_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryVegaWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

                const result = await binary.getBinaryVega(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
                const actualCall = result.vegaCall.toString() / 1e18;
                const actualPut = result.vegaPut.toString() / 1e18;

                assertAbsoluteBelow(actualCall, expected.vegaCall, MAX_BINARY_VEGA_ABS_ERROR);
                assertAbsoluteBelow(actualPut, expected.vegaPut, MAX_BINARY_VEGA_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryVegaRange(strikes, times, vols, rates, MAX_BINARY_VEGA_ABS_ERROR, 10, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryVega(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.vegaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.vegaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryVega(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.vegaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.vegaPut.toString() / 1e18, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryVega(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05));
          assertAbsoluteBelow(result.vegaCall.toString() / 1e18, 0, MIN_ERROR);
          assertAbsoluteBelow(result.vegaPut.toString() / 1e18, 0, MIN_ERROR);
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryVegaRange(strikes, times, vols, rates, MAX_BINARY_VEGA_ABS_ERROR, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryVegaRange(strikes, times, vols, rates, MAX_BINARY_VEGA_ABS_ERROR, 10, !fastTest);
        });
      });

      describe("regression", function () {
        it("call vega = -put vega", async function () {
          const { binary } = await loadFixture(deploy);

          const result = await binary.getBinaryVega(tokens(1000), tokens(1100), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05));
          const vCall = result.vegaCall.toString() / 1e18;
          const vPut = result.vegaPut.toString() / 1e18;

          assertAbsoluteBelow(vCall + vPut, 0, MIN_ERROR);
        });

        it("vega sign flips around strike (ν_call < 0 for ITM, > 0 for OTM)", async function () {
          const { binary } = await loadFixture(deploy);

          // For deep ITM call (spot >> strike, d1 > 0): ν_call < 0
          // For deep OTM call (spot << strike, d1 < 0): ν_call > 0
          const vITM = (await binary.getBinaryVega(tokens(1000), tokens(800), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05))).vegaCall.toString() / 1e18;
          const vOTM = (await binary.getBinaryVega(tokens(1000), tokens(1200), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05))).vegaCall.toString() / 1e18;

          assert.isBelow(vITM, 0);
          assert.isAbove(vOTM, 0);
        });

        it("handles when vol is small, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryVegaWrapped(1000, 1020, 1, 0.0001, 0.05);

          const result = await binary.getBinaryVega(tokens(1000), tokens(1020), 1, tokens(0.0001), tokens(0.05));
          assertAbsoluteBelow(result.vegaCall.toString() / 1e18, expected.vegaCall, MAX_BINARY_VEGA_ABS_ERROR);
          assertAbsoluteBelow(result.vegaPut.toString() / 1e18, expected.vegaPut, MAX_BINARY_VEGA_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryVega("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
          await binary.getBinaryVega("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryVega(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryVega("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
          await binary.getBinaryVega("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryVega("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
          await binary.getBinaryVega(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
          await binary.getBinaryVega(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryVega(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05));
          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15)), "RateUpperBoundError");
          await binary.getBinaryVega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4));
          await assertRevertError(binary, binary.getBinaryVega(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18)), "RateUpperBoundError");
        });
      });
    });
  });

  describe("compare", function () {
    it("call", async function () {
      const { binary, adapterHaptic } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0;
      let avgGas1 = 0, avgGas2 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              // payout = 1 for fair comparison (Haptic returns unit-payout price)
              const expected = binaryCallWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

              // DeFiMath
              const result1 = await binary.getBinaryCallPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.price.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);

              // Haptic
              const result2 = await adapterHaptic.callPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2.price.toString() / 1e18;
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
      console.log("Metric         DeFiMath  Haptic");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "    " + (avgGas2 / count).toFixed(0));
    });

    it("put", async function () {
      const { binary, adapterHaptic } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0;
      let avgGas1 = 0, avgGas2 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              // payout = 1 for fair comparison (Haptic returns unit-payout price)
              const expected = binaryPutWrapped(1000, strike, time * SEC_IN_DAY, vol, rate);

              // DeFiMath
              const result1 = await binary.getBinaryPutPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price1 = result1.price.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);

              // Haptic
              const result2 = await adapterHaptic.putPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2.price.toString() / 1e18;
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
      console.log("Metric         DeFiMath  Haptic");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "    " + (avgGas2 / count).toFixed(0));
    });
  });
});
