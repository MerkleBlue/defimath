
import { assert, expect } from "chai";
import bs from "black-scholes";
import { generateStrikePoints, generateTimePoints } from "../poc/blackscholes/generateLookupTable.mjs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import hre from "hardhat";
import { BlackScholesNUMJS } from "../poc/blackscholes/BlackScholesNUMJS.mjs";

const SEC_IN_DAY = 24 * 60 * 60;
const SEC_IN_YEAR = 365 * 24 * 60 * 60;

const duoTest = true;
const fastTest = false;

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

function tokens(value) {
  const trimmedValue = Math.round(value * 1e18) / 1e18;
  return hre.ethers.parseUnits(trimmedValue.toString(), 18).toString();
}

async function assertRevertError(contract, method, arg) {
  await expect(method).to.be.revertedWithCustomError(
    contract,
    "OutOfBoundsError"
  ).withArgs(arg);
};

describe("BlackScholesDUO (SOL and JS)", function () {
  let blackScholesJS;
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const [owner] = await ethers.getSigners();

    // deploy contracts
    const BlackScholesNUM = await ethers.getContractFactory("BlackScholesNUM");
    const blackScholesNUM = await BlackScholesNUM.deploy();

    return { owner, blackScholesNUM };
  }

  function getFuturePrice(spot, timeToExpirySec, rate) {
    // future = spot * e^(rT)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
    return futurePrice;
  }

  function getDiscountedStrike(strike, timeToExpirySec, rate) {
    // discounted = strike / e^(rT)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const discountedStrike = strike / Math.exp(rate * timeToExpiryYears);
    return discountedStrike;
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

    console.log("timePoints.length", timePoints.length, "testTimePoints.length", testTimePoints.length);
    console.log("Last time point:", testTimePoints[testTimePoints.length - 1], convertSeconds(testTimePoints[testTimePoints.length - 1]));
    return testTimePoints;
  }

  function generateTestStrikePoints(blackScholesJS, startPoint, endPoint) {
    const strikePoints = generateStrikePoints(blackScholesJS, startPoint, endPoint);

    const testStrikePoints = [];
    for (let i = 0; i < strikePoints.length - 1; i++) {
      const cellDeltaStrike = strikePoints[i + 1] - strikePoints[i];
      const step = cellDeltaStrike / 16;
      for (let j = 0; j < 16; j++) {
        testStrikePoints.push(strikePoints[i] + j * step);
      }
    }

    // console.log("strikePoints.length", strikePoints.length, "testStrikePoints.length", testStrikePoints.length);
  
    return testStrikePoints;
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

  async function testOptionRange(strikePoints, timePoints, volPoints, isCall, allowedRelError = 0.001000, allowedAbsError = 0.000114, multi = 10, log = true) {
    const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

    log && console.log("Allowed abs error: $" + allowedAbsError);
    log && console.log("Allowed rel error:  " + allowedRelError + "%");

    let countTotal = 0, prunedCountJS = 0, prunedCountSOL = 0;
    const totalPoints = strikePoints.length * timePoints.length * volPoints.length;
    let errorsJS = [], errorsSOL = [];
    for (let strike of strikePoints) {
      for(let exp of timePoints) {
        for (let vol of volPoints) {
          for (let rate = 0; rate < 0.01; rate += 0.02) {
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
            // if (duoTest) {
            //   let actualSOL = 0;
            //   if (isCall) {
            //     actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
            //   } else {
            //     actualSOL = (await blackScholesPOC.getPutOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
            //   }

            //   const relErrorSOL = expected !== 0 ? (Math.abs(actualSOL - expected) / expected * 100) : 0;
            //   const absErrorSOL = Math.abs(actualSOL - expected);

            //   const errorParamsSOL = {
            //     expiration: exp, strike: strike * multi, vol, rate, act: actualSOL, exp: expected
            //   }
            //   errorsSOL.push({ absErrorSOL, relErrorSOL, errorParamsSOL });
            // }

            countTotal++;

            // print progress and prune errors
            if (countTotal % Math.round(totalPoints / 20) === 0) {
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

  async function testFuturePriceRange(ratePoints, timePoints, allowedRelError = 0.00125, log = true) { // %0.00125
    const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

    let maxErrorJS = 0, maxErrorSOL = 0, totalErrorJS = 0, totalErrorSOL = 0, count = 0, maxErrorParamsJS = null, maxErrorParamsSOL = null;
    for (const rate of ratePoints) {
      for (const secs of timePoints) {
        const expected = getFuturePrice(100, secs, rate);

        const actualJS = blackScholesJS.getFuturePrice(100, secs, rate);
        const errorJS = (Math.abs(actualJS - expected) / expected * 100);
        totalErrorJS += errorJS;

        if (maxErrorJS < errorJS) {
          maxErrorJS = errorJS;
          maxErrorParamsJS = {
            rate, secs, actual: actualJS, expected
          }
        }

        if (duoTest) {
          const actualSOL = (await blackScholesPOC.getFuturePrice(tokens(100), secs, Math.round(rate * 10_000))).toString() / 1e18;
          const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
          totalErrorSOL += errorSOL;
          
          if (maxErrorSOL < errorSOL) {
            maxErrorSOL = errorSOL;
            maxErrorParamsSOL = {
              rate, secs, actual: actualSOL, expected
            }
          }
        }

        count++;
      }
    }

    if (log) {
      if (maxErrorParamsJS) {
        const { rate, secs, actual, expected } = maxErrorParamsJS;
        console.log("Max error JS:", maxErrorJS.toFixed(6) + "%, rate, ", rate.toFixed(2), "exp:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
      }
      if (duoTest && maxErrorParamsSOL) {
        const { rate, secs, actual, expected } = maxErrorParamsSOL;
        console.log("Max error SOL:", maxErrorJS.toFixed(6) + "%, rate, ", rate.toFixed(2), "exp:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
      }
    }

    assert.isBelow(maxErrorJS, allowedRelError);
    assert.isBelow(maxErrorSOL, allowedRelError);
  }

  // before all tests, called once
  before(async () => {
    blackScholesJS = new BlackScholesNUMJS();
  });

  describe.only("functionality", function () {
    describe("exp", function () {
      it("exp positive < 0.03125", async function () {
        let totalGas = 0, count = 0;
        for (let x = 0; x < 0.03125; x += 0.0003) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          // console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(absError, 0.000000000050); // 1e-12 
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = absError / expected * 100;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", errorSOL.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            assert.isBelow(absError, 0.000000000050); // 1e-12 
            assert.isBelow(relError, 0.000000004200); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.expMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("exp positive [0.03125, 1)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 0.03125; x < 1; x += 0.0010125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          // console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(absError, 0.000000000110); // 1e-12 
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = absError / expected * 100;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", errorSOL.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            assert.isBelow(absError, 0.000000000110); // 1e-12 
            assert.isBelow(relError, 0.000000004200); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.expMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp positive [1, 32)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1; x < 32; x += 0.03200125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          /// console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = absError / expected * 100;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            assert.isBelow(relError, 0.000000004200); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.expMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp positive [32, 50)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 32; x < 50; x += 0.25600125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          //console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.expPositive(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = absError / expected * 100;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            // assert.isBelow(absError, 0.00000001);
            assert.isBelow(relError, 0.000000004200); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.expMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp negative [-50, -0.05]", async function () {
        let totalGas = 0, count = 0;
        for (let x = 0.05; x <= 50; x += 0.05 ) { 
          const expected = Math.exp(-x);
          const actualJS = blackScholesJS.exp(-x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          // console.log("x: ", x.toFixed(2), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(absError, 0.000000000042); // 1e-12 
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.expNegative(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = absError / expected * 100;
            // console.log("x: ", x.toFixed(2), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(18), "exp: " + expected.toFixed(18));
            assert.isBelow(absError, 0.000000000042); // 1e-12 
            // assert.isBelow(relError, 1.510042000000); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.expMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("ln", function () {
      // todo: test all limits like 1.090507732665257659
      it("ln upper [1, 1.0905]", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", rate, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
          assert.isBelow(relError, 0.000000000150); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            assert.isBelow(relError, 0.000000000150); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.lnMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln upper [1.0905, 16]", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
          assert.isBelow(relError, 0.000000000150); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            assert.isBelow(relError, 0.000000000150); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.lnMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln lower [0.0625, 1)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 0.0625; x < 1; x += 0.001) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
          assert.isBelow(relError, 0.000000000150); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            assert.isBelow(relError, 0.000000000150); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.lnMeasureGas(tokens(x))); // todo: measure ln, not lnUpper
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("sqrt", function () {
      // todo: test all limits like 1.04427
      it("sqrt upper [1, 1.0746]", async function () { // root(64, 100) = 1.074607828321317497
        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.074607828321317497; x += 0.0001) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("Rel error for x: ", x.toFixed(4), "SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
            assert.isBelow(relError, 0.000000000072); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.sqrtMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1.04427, 100)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1.074607828321317497; x < 100; x += 0.1) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("Rel error for x: ", x.toFixed(4), "SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
            assert.isBelow(relError, 0.000000000072); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.sqrtMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [100, 10000)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 100; x < 10000; x += 9.89) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("Rel error for x: ", x.toFixed(4), "SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
            assert.isBelow(relError, 0.000000000072); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.sqrtMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1e4, 1e6)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1e4; x < 1e6; x += 1e3) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("Rel error for x: ", x.toFixed(4), "SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
            assert.isBelow(relError, 0.000000000072); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.sqrtMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1e6, 1e8)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1e6; x < 1e8; x += 1e5) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.sqrt(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("Rel error for x: ", x.toFixed(4), "SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
            assert.isBelow(relError, 0.000000000072); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.sqrtMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt lower [1e-6, 1)", async function () { // todo: test better
        let totalGas = 0, count = 0;
        for (let x = 1; x < 1000000; x += 1234) {
          const expected = Math.sqrt(1 / x);
          const actualJS = blackScholesJS.sqrt(1 / x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = await loadFixture(deploy);

            const actualSOL = (await blackScholesNUM.sqrt(tokens(1 / x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("Rel error for x: ", x.toFixed(4), "SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
            assert.isBelow(relError, 0.00000000080); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.sqrtMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe.only("d1", function () {
      it.only("d1 single", async function () {
        const volAdj = 0.6 * Math.sqrt(60 / 365);
        const expected = bs.getW(1000, 980, 60 / 365, 0.6, 0.05);
        const actualJS = blackScholesJS.getD1(1000, 980, 60 / 365, volAdj, 0.05);
        const absError = Math.abs(actualJS - expected);
        const relError = expected !== 0 ? absError / expected * 100 : 0;
        // console.log("Rel error JS: ", relError.toFixed(12) + "%,", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
        assert.isBelow(absError, 0.00000040);
        assert.isBelow(relError, 0.00000006);

        // if (duoTest) {
        //   const { blackScholesNUM } = await loadFixture(deploy);

        //   const actualSOL = (await blackScholesNUM.getD1(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.6), tokens(0.05))).toString() / 1e18;
        //   const absError = Math.abs(actualSOL - expected);
        //   const relError = expected !== 0 ? absError / expected * 100 : 0;
        //   // console.log("Rel error SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
        //   assert.isBelow(relError, 0.00000006); 
        // }
      });

      it.only("d1 multiple", async function () {
        const strikes = [500, 800, 1000, 1200, 1500];
        const times = [30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0, 0.05];

        for (let strike of strikes) {
          for (let time of times) {
            for (let vol of vols) {
              for (let rate of rates) {
                const volAdj = vol * Math.sqrt(time / 365);
                const expected = bs.getW(1000, strike, time / 365, vol, rate);
                const actualJS = blackScholesJS.getD1(1000, strike, time / 365, volAdj, rate);
                const absError = Math.abs(actualJS - expected);
                const relError = expected !== 0 ? Math.abs(absError / expected) * 100 : 0;
                // console.log("Rel error JS: ", relError.toFixed(12) + "%,", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
                assert.isBelow(relError, 0.000000000175); // 1e-12

                // if (duoTest) {
                //   const { blackScholesNUM } = await loadFixture(deploy);
        
                //   const actualSOL = (await blackScholesNUM.getD1(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate))).toString() / 1e18;
                //   const absError = Math.abs(actualSOL - expected);
                //   const relError = expected !== 0 ? Math.abs(absError / expected) * 100 : 0;
                //   // console.log("Rel error SOL:", relError.toFixed(12) + "%,", "act: " + actualSOL.toFixed(12), "exp: " + expected.toFixed(12));
                //   assert.isBelow(relError, 0.000000000160); // 1e-12
                // }
              }
            }
          }
        }
        
        //console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe.only("stdNormCDF", function () {
      it("stdNormCDF single", async function () {
        const d1 = 0.6100358074173348;
        const expected = bs.stdNormCDF(d1);
        const actualJS = blackScholesJS.stdNormCDF(d1);
        const absError = Math.abs(actualJS - expected);
        const relError = expected !== 0 ? Math.abs(absError / expected) * 100 : 0;
        assert.isBelow(relError, 0.0000075);

        console.log("exp: " + expected.toFixed(10));
        console.log("act: " + actualJS.toFixed(10));
        console.log("diff:", Math.abs(expected - actualJS));
      });
    });

    it("getFuturePrice", async function () {
      for (let rate = 0; rate < 4; rate += 0.001) { 
        const expected = getFuturePrice(100, SEC_IN_YEAR, rate);
        const actualJS = blackScholesJS.getFuturePrice(100, SEC_IN_YEAR, rate);
        const absError = Math.abs(actualJS - expected);
        const relError = absError / expected * 100;
        // console.log("Rel error for x: ", rate, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
        assert.isBelow(absError, 0.00000300); // in $ on a $100 spot
        assert.isBelow(relError, 0.00000006); // in %
      }
    });

    it("getDiscountedStrike", async function () {
      for (let rate = 0; rate < 4; rate += 0.001) { 
        const expected = getDiscountedStrike(100, SEC_IN_YEAR, rate);
        const actualJS = blackScholesJS.getDiscountedStrike(100, SEC_IN_YEAR, rate);
        const absError = Math.abs(actualJS - expected);
        const relError = absError / expected * 100;
        // console.log("Rel error for x: ", rate, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
        assert.isBelow(absError, 0.00000300); // in $ on a $100 spot
        assert.isBelow(relError, 0.00000006); // in %
      }
    });



    it("test getCallPrice", async function () {
      for (let i = 0; i < 200; i++) {
        const t = (10 + i) / 365;
        const expected = bs.blackScholes(1000, 1000 - i, t, 0.60, 0, "call");
        const actualJS = blackScholesJS.getCallOptionPrice(1000, 1000 - i, t * SEC_IN_YEAR, 0.60, 0);

        const absError = Math.abs(actualJS - expected);
        const relError = expected !== 0 ? absError / expected * 100 : 0;
        console.log(i, "exp: " + expected.toFixed(8), "act: " + actualJS.toFixed(8),);
        assert.isBelow(absError, 0.000290);
        // assert.isBelow(relError, 0.00000006);
      }
    });

    // todo: if calls more precise on lower strikes, then use this rule: high_call = high_put + future + diff(strike, spot)
    // that requires puts implementation other than getting put from call
    it("gets multiple call prices at lower strikes: random", async function () {
      const strikeSubArray = generateRandomTestPoints(20, 100, 300, false);
      const timeSubArray = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, 300, true);
      await testOptionRange(strikeSubArray, timeSubArray, [0.01, 0.2, 0.6, 0.8, 1.92], true, 0.000070, 0.000140, 10, !fastTest);
    });

    it("gets multiple put prices at lower strikes: random", async function () {
      const strikeSubArray = generateRandomTestPoints(20, 100, 300, false);
      const timeSubArray = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, 300, true);
      await testOptionRange(strikeSubArray, timeSubArray, [0.01, 0.2, 0.6, 0.8, 1.92], false, 0.000070, 0.000140, 10, !fastTest);
    });

    it("gets multiple call prices at higher strikes: random", async function () {
      const strikeSubArray = generateRandomTestPoints(100, 500, 300, false);
      const timeSubArray = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, 300, true);
      await testOptionRange(strikeSubArray, timeSubArray, [0.01, 0.2, 0.6, 0.8, 1.92], true, 0.000070, 0.000370, 10, !fastTest);
    });

    it("gets multiple put prices at higher strikes: random", async function () {
      const strikeSubArray = generateRandomTestPoints(100, 500, 300, false);
      const timeSubArray = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, 300, true);
      await testOptionRange(strikeSubArray, timeSubArray, [0.01, 0.2, 0.6, 0.8, 1.92], false, 0.000070, 0.000370, 10, !fastTest);
    });

    // NOTE: error is in both cases 0.000300, but on put it is smaller relative
    // it.only("gets a call price: debug", async function () {
    //   const expected = blackScholesWrapped(1000, 4974.968111853853, 27492433 / SEC_IN_YEAR, 0.6, 0, "call");

    //   const actualJS = blackScholesJS.getCallOptionPrice(1000, 4974.968111853853, 27492433, 0.6, 0);
    //   console.log("Call expected:", expected, "actual JS :", actualJS);
    // });

    // it.only("gets a put price: debug", async function () {
    //   const expected = blackScholesWrapped(1000, 4974.968111853853, 27492433 / SEC_IN_YEAR, 0.6, 0, "put");

    //   const actualJS = blackScholesJS.getPutOptionPrice(1000, 4974.968111853853, 27492433, 0.6, 0);
    //   console.log("Put expected:", expected, "actual JS :", actualJS);
    // });

    it("test Math.exp limits", async function () {

      console.log(Math.exp(-600));
      console.log(Math.exp(-1e-15))

      // min and max (-z * z) -> -6837683.739105278 and -1.7117711582997589e-13
    });
  });
});
