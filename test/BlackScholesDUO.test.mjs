
import { assert, expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import hre from "hardhat";
import { BlackScholesNUMJS } from "../poc/blackscholes/BlackScholesNUMJS.mjs";
import bs from "black-scholes";

const SEC_IN_DAY = 24 * 60 * 60;
const SEC_IN_YEAR = 365 * 24 * 60 * 60;

const duoTest = true;
const fastTest = true;

const maxAbsError = 0.00008902;  // $, for an option on a $1000 spot price
const maxRelError = 0.00008901;  // %

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

  return Math.max(0, bs.blackScholes(spot, strike, time, vol, rate, callOrPut));
}

export function assertAbsoluteBelow(actual, expected, maxAbsError = 1) {
  const absError = Math.abs(actual - expected);

  assert.isBelow(absError, maxAbsError, "Absolute error is above the threshold");
}

export function assertRelativeBelow(actual, expected, maxRelError = 100) {
  const absError = Math.abs(actual - expected);
  const relError = (expected !== 0 && actual !== 0) ? Math.abs(absError / expected) : 0;

  assert.isBelow(relError, maxRelError, "Relative error is above the threshold");
}

export function assertEitherBelow(actual, expected, maxRelError = 100, maxAbsError = 1) {
  const absError = Math.abs(actual - expected);
  const relError = (expected !== 0 && actual !== 0) ? Math.abs(absError / expected) : 0;

  // console.log("Rel error JS: ", relError.toFixed(12) + "%,", "act: " + actual.toFixed(12), "exp: " + expected.toFixed(12));

  assert.isTrue(relError < maxRelError || absError < maxAbsError, "Relative or absolute error is above the threshold");
}

export function assertBothBelow(actual, expected, maxRelError = 100, maxAbsError = 1) {
  const absError = Math.abs(actual - expected);
  const relError = (expected !== 0 && actual !== 0) ? Math.abs(absError / expected) : 0;

  assert.isBelow(relError, maxRelError, "Relative error is above the threshold");
  assert.isBelow(absError, maxAbsError, "Absolute error is above the threshold");
}

function tokens(value) {
  const trimmedValue = Math.round(value * 1e18) / 1e18;
  return hre.ethers.parseUnits(trimmedValue.toString(), 18).toString();
}

async function assertRevertError(contract, method, errorName) {
  await expect(method).to.be.revertedWithCustomError(
    contract,
    errorName
  );
};

describe("BlackScholesDUO (SOL and JS)", function () {
  let blackScholesJS;
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const [owner] = await ethers.getSigners();

    // deploy contract that uses BlackScholesNUM library, use it for all tests
    const BlackScholesCaller = await ethers.getContractFactory("BlackScholesCaller");
    const blackScholesNUM = await BlackScholesCaller.deploy();

    return { owner, blackScholesNUM };
  }

  function getFuturePrice(spot, timeToExpirySec, rate) {
    // future = spot * e^(rT)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
    return futurePrice;
  }

  function convertSeconds(seconds) {
    const days = Math.floor(seconds / (24 * 3600));
    seconds %= 24 * 3600;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;

    return { days, hours, minutes, seconds };
  }

  function generateTimePoints() {
    const MAX_MAJOR = 26; // just above 2 years
    const points = [0, 1, 2, 3, 4, 5, 6, 7];
  
    for (let major = 3; major < MAX_MAJOR; major++) {
      for(let minor = 0; minor < 8; minor++) {
        points.push(parseFloat(2 ** major + minor * 2 ** (major - 3)));
      }
    }
    points.push(parseFloat(2 ** MAX_MAJOR)); // last point
  
    // console.log("Last time point: ", points[points.length - 1]);
  
    return points;
  }

  function generateTestTimePoints() {
    const timePoints = generateTimePoints();
  
    const testTimePoints = [];
    for (let i = 1; i < 128; i++) { // from 1 seconds
      testTimePoints.push(i);
    }

    for (let i = 0; i < timePoints.length - 1; i++) {
      const cellDeltaTime = timePoints[i + 1] - timePoints[i];
      if (cellDeltaTime >= 16) {
        const step = cellDeltaTime / 16;
        for (let j = 0; j < 16; j++) {
          if (timePoints[i] + j * step < 2 * SEC_IN_YEAR) { // up to 2 years
            testTimePoints.push(Math.round(timePoints[i] + j * step));
          }
        }
      }
    }

    // add last time point
    testTimePoints.push(2 * SEC_IN_YEAR);

    // console.log("timePoints.length", timePoints.length, "testTimePoints.length", testTimePoints.length);
    // console.log("Last time point:", testTimePoints[testTimePoints.length - 1], convertSeconds(testTimePoints[testTimePoints.length - 1]));
    return testTimePoints;
  }

  // generates strike points around 100 strike, log scale
  function generateTestStrikePoints(ratio, count) {
    const lowerPoints = [];
    const upperPoints = [];

    const multiplier = Math.pow(ratio, 1 / (count / 2 - 1));

    for (let i = 0; i < (count / 2) - 1; i++) {
      upperPoints.push(100 * Math.pow(multiplier, i));
    }
    upperPoints.push(100 * ratio); // last element


    for (const point of upperPoints) {
      lowerPoints.push((100 / point) * 100);
    }
    lowerPoints.reverse();
    lowerPoints.pop(); // last element

    return lowerPoints.concat(upperPoints);
  }

  function generateTestRatePoints(min, max, step) {
    const testRatePoints = [];
    for (let rate = min; rate <= max; rate += step) { // up to 20%
      testRatePoints.push(rate);
    }
  
    return testRatePoints;
  }

  function generateRandomTestPoints(startPoint, endPoint, count, doRound = false) {
    const testPoints = [];
    for (let i = 0; i < count; i++) {
      let point = 0;
      if (doRound) {
        point = Math.round(Math.random() * (endPoint - startPoint) + startPoint);
      } else {
        point = Math.random() * (endPoint - startPoint) + startPoint;
      }
      testPoints.push(point);
    }
  
    return testPoints;
  }

  async function testOptionRange(strikePoints, timePoints, volPoints, ratePoints, isCall, allowedRelError = 0.001000, allowedAbsError = 0.000114, multi = 10, log = true) {
    const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
    log && console.log("Allowed abs error: $" + allowedAbsError);
    log && console.log("Allowed rel error:  " + allowedRelError + "%");

    let countTotal = 0, prunedCountJS = 0, prunedCountSOL = 0;
    const totalPoints = strikePoints.length * timePoints.length * volPoints.length * ratePoints.length;
    let errorsJS = [], errorsSOL = [];
    for (const strike of strikePoints) {
      for(const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            // expected
            const expected = blackScholesWrapped(100 * multi, strike * multi, exp / SEC_IN_YEAR, vol, rate, isCall ? "call" : "put");

            // JS
            {
              let actualJS = 0
              if (isCall) {
                actualJS = blackScholesJS.getCallOptionPrice(100 * multi, strike * multi, exp, vol, rate); // todo: multiplier helps lower worst case  * 1.000004;
              } else {
                actualJS = blackScholesJS.getPutOptionPrice(100 * multi, strike * multi, exp, vol, rate); // todo: multiplier helps lower worst case  * 1.000004;
              }

              const relErrorJS = expected !== 0 ? (Math.abs(actualJS - expected) / expected * 100) : 0;
              const absErrorJS = Math.abs(actualJS - expected);

              const errorParamsJS = {
                expiration: exp, strike: strike * multi, vol, rate, act: actualJS, exp: expected
              }
              errorsJS.push({ absErrorJS, relErrorJS, errorParamsJS });
            }

            // SOL
            if (duoTest) {
              let actualSOL = 0;
              if (isCall) {
                actualSOL = (await blackScholesNUM.getCallOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
              } else {
                actualSOL = (await blackScholesNUM.getPutOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
              }

              const relErrorSOL = expected !== 0 ? (Math.abs(actualSOL - expected) / expected * 100) : 0;
              const absErrorSOL = Math.abs(actualSOL - expected);

              const errorParamsSOL = {
                expiration: exp, strike: strike * multi, vol, rate, act: actualSOL, exp: expected
              }
              errorsSOL.push({ absErrorSOL, relErrorSOL, errorParamsSOL });
            }

            countTotal++;

            // print progress and prune errors
            if (countTotal % Math.round(totalPoints / 10) === 0) {
              if (log) {
                const startTime = new Date().getTime();
                errorsJS.sort((a, b) => b.absErrorJS - a.absErrorJS);
                if (errorsJS[0].absErrorJS < allowedAbsError) {
                  console.log("Progress:", (countTotal / totalPoints * 100).toFixed(0) + 
                  "%, Max abs error:", "$" + (errorsJS[0] ? (errorsJS[0].absErrorJS / (0.1 * multi)).toFixed(6) : "0") + 
                  " (" + (new Date().getTime() - startTime) + "mS)");
                } else {
                  const filteredErrorsJS = errorsJS.filter(error => error.absErrorJS > allowedAbsError);
                  // sort filtered errors by relative error descending
                  filteredErrorsJS.sort((a, b) => b.relErrorJS - a.relErrorJS);
                  console.log("Progress:", (countTotal / totalPoints * 100).toFixed(0) + 
                  "%, Max abs error:", "$" + (filteredErrorsJS[0] ? (filteredErrorsJS[0].absErrorJS / (0.1 * multi)).toFixed(6) : "0") + 
                  ", Max rel error:", (filteredErrorsJS[0] ? filteredErrorsJS[0].relErrorJS.toFixed(6) + "%" : "0") + 
                  " (" + (new Date().getTime() - startTime) + "mS)");
                }
              }

              // prune all errors where abs error < allowedAbsError
              const toDeleteErrorsJS = errorsJS.filter(error => error.absErrorJS < allowedAbsError);
              prunedCountJS += toDeleteErrorsJS.length;
              const toDeleteErrorsSOL = errorsSOL.filter(error => error.absErrorSOL < allowedAbsError);
              prunedCountSOL += toDeleteErrorsSOL.length;

              errorsJS = errorsJS.filter(error => error.absErrorJS >= allowedAbsError);
              errorsSOL = errorsSOL.filter(error => error.absErrorSOL >= allowedAbsError);
            }
          }
        }
      }
    }

    // prune all errors where abs error < allowedAbsError
    const toDeleteErrorsJS = errorsJS.filter(error => error.absErrorJS < allowedAbsError);
    prunedCountJS += toDeleteErrorsJS.length;
    const toDeleteErrorsSOL = errorsSOL.filter(error => error.absErrorSOL < allowedAbsError);
    prunedCountSOL += toDeleteErrorsSOL.length;

    errorsJS = errorsJS.filter(error => error.absErrorJS >= allowedAbsError);
    errorsSOL = errorsSOL.filter(error => error.absErrorSOL >= allowedAbsError);

    // sort filtered errors by relative error descending
    errorsJS.sort((a, b) => b.relErrorJS - a.relErrorJS);

    // sort filtered errors by relative error descending
    errorsSOL.sort((a, b) => b.relErrorSOL - a.relErrorSOL);

    if (log) {
      // JS
      console.log();
      console.log("REPORT JS");
      console.log("Errors Abs/Rel/Total: " + prunedCountJS + "/" + errorsJS.length + "/" + countTotal, "(" + ((prunedCountJS / countTotal) * 100).toFixed(2) + "%)");

      console.log("Max abs error params JS: ", errorsJS[0], convertSeconds(errorsJS[0] ? errorsJS[0].errorParamsJS.expiration : 0));

      // SOL
      if (duoTest) {
        console.log();
        console.log("REPORT SOL");
        console.log("Errors Abs/Rel/Total: " + prunedCountSOL + "/" + errorsSOL.length + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");

        console.log("Max abs error params SOL: ", errorsSOL[0], convertSeconds(errorsSOL[0] ? errorsSOL[0].errorParamsSOL.expiration : 0));
      }
    }

    // verify - go through errors and assert that relative error is below allowedRelError
    for (let i = 0; i < errorsJS.length; i++) {
      assert.isBelow(errorsJS[i].relErrorJS, allowedRelError);
    }
    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].relErrorSOL, allowedRelError);
    }
  }

  // before all tests, called once
  before(async () => {
    testTimePoints = generateTestTimePoints();
    testStrikePoints = generateTestStrikePoints(5, 500);

    blackScholesJS = new BlackScholesNUMJS();
  });

  duoTest && describe("performance", function () {
    describe("exp", function () {
      it("exp positive < 0.03125", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
        let totalGas = 0, count = 0;
        for (let x = 0; x < 0.03125; x += 0.0003) { 
          totalGas += parseInt(await blackScholesNUM.expPositiveMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("exp positive [0.03125, 1)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
        let totalGas = 0, count = 0;
        for (let x = 0.03125; x < 1; x += 0.0020125) { 
          totalGas += parseInt(await blackScholesNUM.expPositiveMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp positive [1, 32)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 32; x += 0.06200125) { 
          totalGas += parseInt(await blackScholesNUM.expPositiveMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp positive [32, 50)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 32; x < 50; x += 0.25600125) { 
          totalGas += parseInt(await blackScholesNUM.expPositiveMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp negative [-50, -0.05]", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 0.05; x <= 50; x += 0.1 ) { 
          totalGas += parseInt(await blackScholesNUM.expPositiveMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("ln", function () {
      it("ln upper [1, 1.0905]", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          totalGas += parseInt(await blackScholesNUM.lnMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln upper [1.0905, 16]", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          totalGas += parseInt(await blackScholesNUM.lnMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln lower [0.0625, 1)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 0.0625; x < 1; x += 0.002) { 
          totalGas += parseInt(await blackScholesNUM.lnMG(tokens(x))); // todo: measure ln, not lnUpper
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("sqrt", function () {
      it("sqrt upper [1, 1.0746]", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.074607828321317497; x += 0.0002) {
          totalGas += parseInt(await blackScholesNUM.sqrtMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1.04427, 100)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1.074607828321317497; x < 100; x += 0.2) {
          totalGas += parseInt(await blackScholesNUM.sqrtMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [100, 10000)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 100; x < 10000; x += 21.457) {
          totalGas += parseInt(await blackScholesNUM.sqrtMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1e4, 1e6)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1e4; x < 1e6; x += 2012.3) {
          totalGas += parseInt(await blackScholesNUM.sqrtMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1e6, 1e8)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1e6; x < 1e8; x += 202463) {
          totalGas += parseInt(await blackScholesNUM.sqrtMG(tokens(x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      // todo: tests for 1 / (1-100, 100-10000, 10000-1000000)
      it("sqrt lower [1e-6, 1)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1000000; x += 2234) {
          totalGas += parseInt(await blackScholesNUM.sqrtMG(tokens(1 / x)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("stdNormCDF", function () {
      it("stdNormCDF single", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        const d1 = 0.6100358074173348;

        totalGas += parseInt(await blackScholesNUM.stdNormCDFMG(tokens(d1)));
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("stdNormCDF multiple", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        for (let d1 = -2; d1 < 2; d1 += 0.01234) {
          totalGas += parseInt(await blackScholesNUM.stdNormCDFMG(tokens(d1)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });
    });

    describe("future", function () {
      it("multiple in typical range", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const times = [7, 30, 60, 90, 180];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const time of times) {
          for (const rate of rates) {
            totalGas += parseInt(await blackScholesNUM.getFuturePriceMG(tokens(1000), time * SEC_IN_DAY, (rate * 10000)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("call", function () {
      it("single", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        totalGas += parseInt(await blackScholesNUM.getCallOptionPriceMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), (0.05 * 10000)));
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("multiple in typical range", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt(await blackScholesNUM.getCallOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), (rate * 10000)));
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
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        let totalGas = 0, count = 0;
        totalGas += parseInt(await blackScholesNUM.getPutOptionPriceMG(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), (0.05 * 10000)));
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("multiple in typical range", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt(await blackScholesNUM.getPutOptionPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), (rate * 10000)));
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
    describe("exp", function () {
      it("exp positive < 0.03125", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 0; x < 0.03125; x += 0.0003) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertBothBelow(actualJS, expected, 0.000000004200, 0.000000000050);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000004200, 0.000000000050);
          }
        }
      });

      it("exp positive [0.03125, 1)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 0.03125; x < 1; x += 0.0010125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertBothBelow(actualJS, expected, 0.000000004200, 0.000000000110);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000004200, 0.000000000110);
          }
        }
      });

      it("exp positive [1, 32)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 1; x < 32; x += 0.03200125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertRelativeBelow(actualJS, expected, 0.000000004200);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000004200);
          }
        }
      });

      it("exp positive [32, 50)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 32; x < 50; x += 0.25600125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertRelativeBelow(actualJS, expected, 0.000000004200);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000004200);
          }
        }
      });

      it("exp negative [-50, -0.05]", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 0.05; x <= 50; x += 0.05 ) { 
          const expected = Math.exp(-x);
          const actualJS = blackScholesJS.exp(-x);
          assertBothBelow(actualJS, expected, 0.000000004200, 0.000000000042);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.expNegative(tokens(x))).toString() / 1e18;
            assertAbsoluteBelow(actualSOL, expected, 0.000000000042);
          }
        }
      });
    });

    describe("ln", function () {
      // todo: test all limits like 1.090507732665257659
      it("ln upper [1, 1.0905]", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          assertBothBelow(actualJS, expected, 0.000000000150, 0.000000000002);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000150, 0.000000000002);
          }
        }
      });

      it("ln upper [1.0905, 16]", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000150);
          }
        }
      });

      it("ln lower [0.0625, 1)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 0.0625; x < 1; x += 0.001) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000150);
          }
        }
      });
    });

    describe("sqrt", function () {
      // todo: test all limits like 1.04427
      it("sqrt upper [1, 1.0746]", async function () { // root(64, 100) = 1.074607828321317497
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 1; x < 1.074607828321317497; x += 0.0001) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [1.04427, 100)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 1.074607828321317497; x < 100; x += 0.1) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [100, 10000)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 100; x < 10000; x += 9.89) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [1e4, 1e6)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 1e4; x < 1e6; x += 1e3) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [1e6, 1e8)", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let x = 1e6; x < 1e8; x += 1e5) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt lower [1e-6, 1)", async function () { // todo: test better
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
        for (let x = 1; x < 1000000; x += 1234) {
          const expected = Math.sqrt(1 / x);
          const actualJS = blackScholesJS.sqrt(1 / x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.sqrt(tokens(1 / x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000800); // todo: why lower than JS?
          }
        }
      });
    });

    describe("d1", function () {
      it("d1 single", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const volAdj = 0.6 * Math.sqrt(60 / 365);
        const rateAdj = 0.05 * (60 / 365);
        const expected = bs.getW(1000, 980, 60 / 365, 0.6, 0.05);
        const actualJS = blackScholesJS.getD1(1000, 980, 60 / 365, volAdj, 0.05);
        assertBothBelow(actualJS, expected, 0.00000006, 0.00000040);

        if (duoTest) {
          const actualSOL = (await blackScholesNUM.getD1(tokens(1000), tokens(980), tokens(volAdj), tokens(rateAdj))).toString() / 1e18;
          assertBothBelow(actualSOL, expected, 0.00000006, 0.00000040);
        }
      });

      it("d1 multiple", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const strikes = [500, 800, 1000, 1200, 1500];
        const times = [30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0, 0.05];

        for (let strike of strikes) {
          for (let time of times) {
            for (let vol of vols) {
              for (let rate of rates) {
                const volAdj = vol * Math.sqrt(time / 365);
                const rateAdj = rate * (time / 365);
                const expected = bs.getW(1000, strike, time / 365, vol, rate);
                const actualJS = blackScholesJS.getD1(1000, strike, time / 365, volAdj, rate);
                assertBothBelow(actualJS, expected, 0.000000000175, 0.00000040);

                if (duoTest) {
                  const actualSOL = (await blackScholesNUM.getD1(tokens(1000), tokens(strike), tokens(volAdj), tokens(rateAdj))).toString() / 1e18;
                  assertBothBelow(actualSOL, expected, 0.000000000175, 0.00000040);
                }
              }
            }
          }
        }
      });
    });

    describe("stdNormCDF", function () {
      it("stdNormCDF single", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const d1 = 0.6100358074173348;
        const expected = bs.stdNormCDF(d1);
        const actualJS = blackScholesJS.stdNormCDF(d1);
        assertAbsoluteBelow(actualJS, expected, 0.000000070000);

        if (duoTest) {
          const actualSOL = (await blackScholesNUM.stdNormCDF(tokens(d1))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, 0.000000070000);
        }
      });

      it("stdNormCDF multiple", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let d1 = -2; d1 < 2; d1 += 0.01234) {
          const expected = bs.stdNormCDF(d1);
          const actualJS = blackScholesJS.stdNormCDF(d1);
          assertAbsoluteBelow(actualJS, expected, 0.000000070000);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.stdNormCDF(tokens(d1))).toString() / 1e18;
            assertAbsoluteBelow(actualSOL, expected, 0.000000070000);
          }
        }
      });
    });

    describe("future", function () {
      it("multiple in typical range", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        for (let timeSec = 0; timeSec < SEC_IN_YEAR; timeSec += SEC_IN_YEAR / 50) { 
          for (let rate = 0; rate < 2; rate += 0.1) { 
            const expected = getFuturePrice(100, SEC_IN_YEAR, rate);
            const actualJS = blackScholesJS.getFuturePrice(100, SEC_IN_YEAR, rate);
            assertBothBelow(actualJS, expected, 0.00000006, 0.00000300);

            if (duoTest) {
              const actualSOL = (await blackScholesNUM.getFuturePrice(tokens(100), SEC_IN_YEAR, Math.round(rate * 10000))).toString() / 1e18;
              assertBothBelow(actualSOL, expected, 0.00000006, 0.00000300);
            }
          }
        }
      });

      describe("limits", function () {
        it("single when expired", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = getFuturePrice(100, 0, 0.05);
          const actualJS = blackScholesJS.getFuturePrice(100, 0, 0.05);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getFuturePrice(tokens(100), 0, (0.05 * 10000))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });

        it("single when rate 0%", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = getFuturePrice(100, SEC_IN_YEAR, 0);
          const actualJS = blackScholesJS.getFuturePrice(100, SEC_IN_YEAR, 0);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);

          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getFuturePrice(tokens(100), SEC_IN_YEAR, 0)).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getFuturePrice(0.00000099, 50000, 0.05)).to.throw("SpotLowerBoundError");
          expect(() => blackScholesJS.getFuturePrice(0, 50000, 0.05)).to.throw("SpotLowerBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getFuturePrice("999999999999", 50000, Math.round(0.05 * 10_000)), "SpotLowerBoundError");
            await blackScholesNUM.getFuturePrice("1000000000000", 50000, Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getFuturePrice(tokens(0), 50000, Math.round(0.05 * 10_000)), "SpotLowerBoundError");
          }
        });

        it("rejects when spot > max spot", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getFuturePrice(1e15 + 1, 50000, 0.05)).to.throw("SpotUpperBoundError");
          expect(() => blackScholesJS.getFuturePrice(1e18, 50000, 0.05)).to.throw("SpotUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getFuturePrice("1000000000000000000000000000000001", 50000, Math.round(0.05 * 10_000)), "SpotUpperBoundError");
            await blackScholesNUM.getFuturePrice("1000000000000000000000000000000000", 50000, Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getFuturePrice("100000000000000000000000000000000000", 50000, Math.round(0.05 * 10_000)), "SpotUpperBoundError");
          }
        });

        it("rejects when time > max time", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getFuturePrice(1000, 4294967295, 0.05)).to.throw("TimeToExpiryUpperBoundError");
          expect(() => blackScholesJS.getFuturePrice(1000, 63072001, 0.05)).to.throw("TimeToExpiryUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getFuturePrice(tokens(1000), 63072001, Math.round(0.05 * 10_000)), "TimeToExpiryUpperBoundError");
            await blackScholesNUM.getFuturePrice(tokens(1000), 63072000, Math.round(0.05 * 10_000)); // todo: check value when 2 years in another test
            await assertRevertError(blackScholesNUM, blackScholesNUM.getFuturePrice(tokens(1000), 4294967295, Math.round(0.05 * 10_000)), "TimeToExpiryUpperBoundError");
          }
        });
      });
    }); 

    describe("call", function () {
      it("single", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
        const expected = blackScholesWrapped(1000, 980, 60 / 365, 0.60, 0.05, "call");
        const actualJS = blackScholesJS.getCallOptionPrice(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05);
        assertEitherBelow(actualJS, expected, 0.000070, 0.000140);

        if (duoTest) {
          const actualSOL = (await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
          assertEitherBelow(actualSOL, expected, 0.000070, 0.000140);
        }
      });

      it("multiple in typical range", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = blackScholesWrapped(1000, strike, time / 365, vol, rate, "call");
                // console.log(1000, strike, time / 365, vol, rate);
                const actualJS = blackScholesJS.getCallOptionPrice(1000, strike, time * SEC_IN_DAY, vol, rate);
                assertEitherBelow(actualJS, expected, 0.000070, 0.000140);

                if (duoTest) {
                  const actualSOL = (await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), (rate * 10000))).toString() / 1e18;
                  assertEitherBelow(actualSOL, expected, 0.000070, 0.000140);
                }
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
          const rates = [0, 0.0001, 0.0002, 6.5533, 6.5534, 6.5535];
          await testOptionRange(strikes, times, vols, rates, true, 0.000070, 0.000370, 10, false);
        });

        it("expired ITM", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = blackScholesWrapped(1000, 980, 0, 0.60, 0.05, "call");
          const actualJS = blackScholesJS.getCallOptionPrice(1000, 980, 0, 0.60, 0.05);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);
  
          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(980), 0, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });

        it("expired ATM", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = blackScholesWrapped(1000, 1000, 0, 0.60, 0.05, "call");
          const actualJS = blackScholesJS.getCallOptionPrice(1000, 1000, 0, 0.60, 0.05);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);
  
          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(1000), 0, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });

        it("expired OTM", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = blackScholesWrapped(1000, 1020, 0, 0.60, 0.05, "call");
          const actualJS = blackScholesJS.getCallOptionPrice(1000, 1020, 0, 0.60, 0.05);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);
  
          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(1020), 0, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 300, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 300, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 300, false);
          const rates = [0, 0.1, 0.2];
          await testOptionRange(strikes, times, vols, rates, true, 0.000070, 0.000140, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 300, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 300, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 300, false);
          const rates = [0, 0.1, 0.2];
          await testOptionRange(strikes, times, vols, rates, true, 0.000070, 0.000370, 10, !fastTest);
        });
      });

      describe("regression", function () {
        it("handles when N(d1) == N(d2) for OTM option", async function () {
          const expected = blackScholesWrapped(1000, 1200, 1 / 365, 0.40, 0.05, "call");
          const actualJS = blackScholesJS.getCallOptionPrice(1000, 1200, 1 * SEC_IN_DAY, 0.40, 0.05);
          assertEitherBelow(actualJS, expected, 0.000070, 0.000140);

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(1200), 1 * SEC_IN_DAY, tokens(0.40), (0.05 * 10000))).toString() / 1e18;
            assertEitherBelow(actualSOL, expected, 0.000070, 0.000140);
          }
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getCallOptionPrice(0.00000099, 0.00000099, 50000, 0.6, 0.05)).to.throw("SpotLowerBoundError");
          expect(() => blackScholesJS.getCallOptionPrice(0, 0, 50000, 0.6, 0.05)).to.throw("SpotLowerBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotLowerBoundError");
            await blackScholesNUM.getCallOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotLowerBoundError");
          }
        });

        it("rejects when spot > max spot", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getCallOptionPrice(1e15 + 1, 1e15 + 1, 50000, 1.920000001, 0.05)).to.throw("SpotUpperBoundError");
          expect(() => blackScholesJS.getCallOptionPrice(1e18, 1e18, 50000, 10_000, 0.05)).to.throw("SpotUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotUpperBoundError");
            await blackScholesNUM.getCallOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotUpperBoundError");
          }
        });

        it("rejects when strike < spot / 5", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 199.999999, 50000, 0.6, 0.05)).to.throw("StrikeLowerBoundError");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 0, 50000, 0.6, 0.05)).to.throw("StrikeLowerBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeLowerBoundError");
            await blackScholesNUM.getCallOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000))
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), "0", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeLowerBoundError");
          }
        });

        it("rejects when strike > spot * 5", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 5000.000001, 50000, 1.920000001, 0.05)).to.throw("StrikeUpperBoundError");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 100000, 50000, 10_000, 0.05)).to.throw("StrikeUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeUpperBoundError");
            await blackScholesNUM.getCallOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeUpperBoundError");
          }
        });

        it("rejects when time > max time", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 4294967295, 0.60, 0.05)).to.throw("TimeToExpiryUpperBoundError");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 63072001, 0.60, 0.05)).to.throw("TimeToExpiryUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), Math.round(0.05 * 10_000)), "TimeToExpiryUpperBoundError");
            await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), Math.round(0.05 * 10_000)); // todo: check value when 2 years in another test
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), Math.round(0.05 * 10_000)), "TimeToExpiryUpperBoundError");
          }
        });

        it("rejects when vol < min volatility", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 0.00009999999999, 0.05)).to.throw("VolatilityLowerBoundError");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 0, 0.05)).to.throw("VolatilityLowerBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(930), 50000, "99999999999999", Math.round(0.05 * 10_000)), "VolatilityLowerBoundError");
            await blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(930), 50000, "100000000000000", Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0), Math.round(0.05 * 10_000)), "VolatilityLowerBoundError");
          }
        });
      });
    });

    describe("put", function () {
      it("single", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
        const expected = blackScholesWrapped(1000, 1020, 60 / 365, 0.60, 0.05, "put");
        const actualJS = blackScholesJS.getPutOptionPrice(1000, 1020, 60 * SEC_IN_DAY, 0.60, 0.05);
        assertEitherBelow(actualJS, expected, 0.000070, 0.000370);

        if (duoTest) {
          const actualSOL = (await blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
          assertEitherBelow(actualSOL, expected, 0.000070, 0.000370);
        }
      });

      it("multiple in typical range", async function () {
        const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = blackScholesWrapped(1000, strike, time / 365, vol, rate, "put");
                // console.log(1000, strike, time / 365, vol, rate);
                const actualJS = blackScholesJS.getPutOptionPrice(1000, strike, time * SEC_IN_DAY, vol, rate);
                assertEitherBelow(actualJS, expected, 0.000070, 0.000140);

                if (duoTest) {
                  const actualSOL = (await blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), (rate * 10000))).toString() / 1e18;
                  assertEitherBelow(actualSOL, expected, 0.000070, 0.000140);
                }
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
          const rates = [0, 0.0001, 0.0002, 6.5533, 6.5534, 6.5535];
          await testOptionRange(strikes, times, vols, rates, false, 0.000070, 0.000370, 10, false);
        });

        it("expired ITM", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = blackScholesWrapped(1000, 1020, 0, 0.60, 0.05, "put");
          const actualJS = blackScholesJS.getPutOptionPrice(1000, 1020, 0, 0.60, 0.05);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);
  
          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(1020), 0, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });

        it("expired ATM", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = blackScholesWrapped(1000, 1000, 0, 0.60, 0.05, "put");
          const actualJS = blackScholesJS.getPutOptionPrice(1000, 1000, 0, 0.60, 0.05);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);
  
          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(1000), 0, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });

        it("expired OTM", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };
          const expected = blackScholesWrapped(1000, 980, 0, 0.60, 0.05, "put");
          const actualJS = blackScholesJS.getPutOptionPrice(1000, 980, 0, 0.60, 0.05);
          assertBothBelow(actualJS, expected, 0.000000000001, 0.000000000001);
  
          if (duoTest) {
            const actualSOL = (await blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(980), 0, tokens(0.60), (0.05 * 10000))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000001, 0.000000000001);
          }
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 300, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 300, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 300, false);
          const rates = [0, 0.1, 0.2];
          await testOptionRange(strikes, times, vols, rates, false, 0.000070, 0.000140, 10, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 300, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 300, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 300, false);
          const rates = [0, 0.1, 0.2];
          await testOptionRange(strikes, times, vols, rates, false, 0.000070, 0.000370, 10, !fastTest);
        });
      });

      describe("regression", function () {
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getPutOptionPrice(0.00000099, 0.00000099, 50000, 0.6, 0.05)).to.throw("SpotLowerBoundError");
          expect(() => blackScholesJS.getPutOptionPrice(0, 0, 50000, 0.6, 0.05)).to.throw("SpotLowerBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotLowerBoundError");
            await blackScholesNUM.getPutOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotLowerBoundError");
          }
        });

        it("rejects when spot > max spot", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getPutOptionPrice(1e15 + 1, 1e15 + 1, 50000, 1.920000001, 0.05)).to.throw("SpotUpperBoundError");
          expect(() => blackScholesJS.getPutOptionPrice(1e18, 1e18, 50000, 10_000, 0.05)).to.throw("SpotUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotUpperBoundError");
            await blackScholesNUM.getPutOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "SpotUpperBoundError");
          }
        });

        it("rejects when strike < spot / 5", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 199.999999, 50000, 0.6, 0.05)).to.throw("StrikeLowerBoundError");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 0, 50000, 0.6, 0.05)).to.throw("StrikeLowerBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeLowerBoundError");
            await blackScholesNUM.getPutOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000))
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), "0", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeLowerBoundError");
          }
        });

        it("rejects when strike > spot * 5", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 5000.000001, 50000, 1.920000001, 0.05)).to.throw("StrikeUpperBoundError");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 100000, 50000, 10_000, 0.05)).to.throw("StrikeUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeUpperBoundError");
            await blackScholesNUM.getPutOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), Math.round(0.05 * 10_000)), "StrikeUpperBoundError");
          }
        });

        it("rejects when time > max time", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 4294967295, 0.60, 0.05)).to.throw("TimeToExpiryUpperBoundError");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 63072001, 0.60, 0.05)).to.throw("TimeToExpiryUpperBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), Math.round(0.05 * 10_000)), "TimeToExpiryUpperBoundError");
            await blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), Math.round(0.05 * 10_000)); // todo: check value when 2 years in another test
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), Math.round(0.05 * 10_000)), "TimeToExpiryUpperBoundError");
          }
        });

        it("rejects when vol < min volatility", async function () {
          const { blackScholesNUM } = duoTest ? await loadFixture(deploy) : { blackScholesNUM: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 0.00009999999999, 0.05)).to.throw("VolatilityLowerBoundError");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 0, 0.05)).to.throw("VolatilityLowerBoundError");

          if (duoTest) {
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(930), 50000, "99999999999999", Math.round(0.05 * 10_000)), "VolatilityLowerBoundError");
            await blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(930), 50000, "100000000000000", Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesNUM, blackScholesNUM.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0), Math.round(0.05 * 10_000)), "VolatilityLowerBoundError");
          }
        });
      });
    });
  });
});
