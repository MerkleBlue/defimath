
import { assert, expect } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, STRIKE_INDEX_MULTIPLIER, STRIKE_MAX, STRIKE_MIN, VOL_FIXED } from "../poc/blackscholes/BlackScholesJS.mjs";
import { generateCurvedAreaLookupTable, generateLookupTable, generateStrikePoints, generateTimePoints } from "../poc/blackscholes/generateLookupTable.mjs";
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
  let blackScholesNUMJS;
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const [owner] = await ethers.getSigners();

    // deploy contracts
    const BlackScholesPOC = await ethers.getContractFactory("BlackScholesPOC");
    const blackScholesPOC = await BlackScholesPOC.deploy();

    // populate lookup table
    const { lookupTableSOL } = await generateLookupTable(new BlackScholesJS(), true);

    console.log("Init lookup table in contract...");
    let totalGas = 0, count = 0;
    let indexArray = [], dataArray = [];
    for (const [key, value] of lookupTableSOL) {
      if (value > 0) {
        indexArray.push(key);
        dataArray.push(value);
      }

      // batch 200 elements
      if (indexArray.length >= 200) {
        if (!fastTest) {
          const gas = await blackScholesPOC.setLookupTableElements.estimateGas(indexArray, dataArray);
          // console.log("gas in batch", parseInt(gas));
          totalGas += parseInt(gas);
        }
        await blackScholesPOC.setLookupTableElements(indexArray, dataArray);
        indexArray = [];
        dataArray = [];
      }

      if (count++ % Math.round(lookupTableSOL.size / 10) === 0) {
        console.log("Progress:", (count / lookupTableSOL.size * 100).toFixed(0) + "%");
      }
    }
    // set remaining elements
    if (indexArray.length > 0) {
      if (!fastTest) {
        const gas = await blackScholesPOC.setLookupTableElements.estimateGas(indexArray, dataArray);
        // console.log("gas in last batch", parseInt(gas));
        totalGas += parseInt(gas);
      }
      await blackScholesPOC.setLookupTableElements(indexArray, dataArray);
    }

    console.log("Init done. Total gas spent:", Math.round(totalGas / 1e6), "M");

    return { owner, blackScholesPOC };
  }

  async function deployNUM() {
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

  function findMinAndMax(map, timeLimit, lowerThanLimit) {
    // Initialize min and max objects with Infinity and -Infinity respectively
    console.log("Interpolation parameters: timeIndex", (lowerThanLimit ? "< " : ">= ") + timeLimit);
    const inf = Infinity;
    const result = {
        min: { intrinsicPriceAA: inf, intrinsicPriceBAdiff: inf, a1: inf, b1: inf, c1: inf, a2diff: inf, b2diff: inf, c2diff: inf, a3w: inf, b3w: inf, c3w: inf, d3w: inf, a4wdiff: inf, b4wdiff: inf, c4wdiff: inf, d4wdiff: inf },
        max: { intrinsicPriceAA: -inf, intrinsicPriceBAdiff: -inf, a1: -inf, b1: -inf, c1: -inf, a2diff: -inf, b2diff: -inf, c2diff: -inf, a3w: -inf, b3w: -inf, c3w: -inf, d3w: -inf, a4wdiff: -inf, b4wdiff: -inf, c4wdiff: -inf, d4wdiff: -inf }
        // absMin: { a1: inf, b1: inf, c1: inf, a2diff: inf, b2diff: inf, c2diff: inf, a3w: inf, b3w: inf, c3w: inf, a4wdiff: inf, b4wdiff: inf, c4wdiff: inf }
    };

    // make map copy and remove elements with intrinsic price 0
    const nonZeroMap = new Map(map);
    for (let [key, value] of map) {
      if (value.intrinsicPriceAA === 0 && value.intrinsicPriceBAdiff === 0) {
        nonZeroMap.delete(key);
      }
    }

    const nonSmallTimeMap = new Map(nonZeroMap);
    for (let [key, value] of map) {
      if (lowerThanLimit && (key % 1000 >= timeLimit)) { // 160 is actually 2 ^ 16 secs
        nonSmallTimeMap.delete(key);
      }
      if (!lowerThanLimit && (key % 1000 < timeLimit)) { // 160 is actually 2 ^ 16 secs
        nonSmallTimeMap.delete(key);
      }
    }

    // const sameIntrinsicPriceMap = new Map(nonZeroMap);
    // for (let [key, value] of nonZeroMap) {
    //   if (value.intrinsicPriceBAdiff !== 0) {
    //     sameIntrinsicPriceMap.delete(key);
    //   }
    // }

    // print map and nonZero map size
    console.log("map size: ", map.size, "nonZero map size: ", nonZeroMap.size);

    // Iterate over the map
    nonSmallTimeMap.forEach(obj => {
        // Update min and max for each key
        for (const key of Object.keys(result.min)) {
            if (obj[key] !== undefined) {
                result.min[key] = Math.min(result.min[key], obj[key]);
                result.max[key] = Math.max(result.max[key], obj[key]);
                // if (Math.abs(obj[key]) >= 0) {
                //   result.absMin[key] = Math.min(result.absMin[key], Math.abs(obj[key]));
                // }
            }
        }
    });

    // for each attribute in result.min and result.max, print min and max
    for (const key of Object.keys(result.min)) {
      if (key !== undefined) {
        console.log(key, "[", result.min[key], "-", result.max[key], "]");
      }
    }

    return result;
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
            if (duoTest) {
              let actualSOL = 0;
              if (isCall) {
                actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
              } else {
                actualSOL = (await blackScholesPOC.getPutOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
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
    // todo: uncomment if we go back to lookup table
    // testTimePoints = generateTestTimePoints();
    // testStrikePoints = generateTestStrikePoints(new BlackScholesJS(), STRIKE_MIN, STRIKE_MAX);
    // const { lookupTable } = await generateLookupTable(new BlackScholesJS(), true);
    // const curvedLookupTable  = (await generateCurvedAreaLookupTable(new BlackScholesJS())).lookupTable;
    // // console.log("curvedLookupTable");
    // // console.log(curvedLookupTable);
    blackScholesJS = new BlackScholesNUMJS(); //new BlackScholesJS(lookupTable);
    blackScholesNUMJS = new BlackScholesNUMJS();


    // // profile factors
    // let count = 0, intrinsicZeroCount = 0;
    // for (let [key, value] of lookupTable) {
    //   // console.log(key + " is ", value);
    //   if (value.intrinsicPriceAA === 0 && value.intrinsicPriceBA === 0) {
    //     intrinsicZeroCount++;
    //   }
    //   count++;
    // }
    // console.log("lookupTable size: ", count, "intrinsic zero count: ", intrinsicZeroCount, (intrinsicZeroCount / count * 100).toFixed(2) + "%");

    // // find min and max for parameters, 160 is hardcoded in contract
    // findMinAndMax(lookupTable, 160, true);
    // findMinAndMax(lookupTable, 160, false);

    // // console.log(curvedLookupTable);
    // findMinAndMax(curvedLookupTable, 1000000, true);

    // // find intrinsicPriceBAdiff NaN values in curved lookup table
    // const nanCurvedMap = new Map(
    //   [...curvedLookupTable]
    //   .filter(([k, v]) => isNaN(v.intrinsicPriceBAdiff))
    // );
    // console.log("-------- NaN curved values --------", nanCurvedMap.size);
    // console.log(nanCurvedMap);

    // // find intrinsicPriceBAdiff NaN values in curved lookup table
    // const nanMap = new Map(
    //   [...lookupTable]
    //   .filter(([k, v]) => v.intrinsicPriceBAdiff == null)
    // );
    // console.log("-------- null values --------", nanMap.size);

    // // overwrite lookup table with curved lookup table
    // curvedLookupTable.forEach((value, key) => {
    //   lookupTable.set(key, value);
    // });     


    // // reduce decimals to 6 decimals
    // lookupTable.forEach((value, key) => {
    //   value.intrinsicPriceBAdiff =  Math.round(value.intrinsicPriceBAdiff * 1e6) / 1e6,

    //   value.a1 = Math.round(value.a1 * 1e6) / 1e6,
    //   value.b1 = Math.round(value.b1 * 1e6) / 1e6,
    //   value.c1 = Math.round(value.c1 * 1e6) / 1e6,
    //   value.a2diff = Math.round(value.a2diff * 1e6) / 1e6,
    //   value.b2diff = Math.round(value.b2diff * 1e6) / 1e6,
    //   value.c2diff = Math.round(value.c2diff * 1e6) / 1e6,

    //   value.a3w = Math.round(value.a3w * 1e6) / 1e6,
    //   value.b3w = Math.round(value.b3w * 1e6) / 1e6,
    //   value.c3w = Math.round(value.c3w * 1e6) / 1e6,
    //   value.a4wdiff = Math.round(value.a4wdiff * 1e6) / 1e6,
    //   value.b4wdiff = Math.round(value.b4wdiff * 1e6) / 1e6,
    //   value.c4wdiff = Math.round(value.c4wdiff * 1e6) / 1e6
    // });
  });

  duoTest && describe("deployment", function () {
    it("deploys contract", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);
      console.log(blackScholesPOC.target);
    });
  });

  describe.only("numerical", function () {
    describe.only("exp", function () {
      it("exp upper < 0.03125", async function () {
        let totalGas = 0, count = 0;
        for (let x = 0; x < 0.03125; x += 0.0003) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesNUMJS.expUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          // console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(absError, 0.000000000050); // 1e-12 
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

            const actualSOL = (await blackScholesNUM.exp(tokens(x))).toString() / 1e18;
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

      it("exp upper [0.03125, 1)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 0.03125; x < 1; x += 0.0010125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesNUMJS.expUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          // console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(absError, 0.000000000110); // 1e-12 
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

            const actualSOL = (await blackScholesNUM.exp(tokens(x))).toString() / 1e18;
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

      it("exp upper [1, 32)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1; x < 32; x += 0.03200125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesNUMJS.expUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          /// console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

            const actualSOL = (await blackScholesNUM.exp(tokens(x))).toString() / 1e18;
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

      it("exp upper [32, 50)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 32; x < 50; x += 0.25600125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesNUMJS.expUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          //console.log("x: ", x.toFixed(4), "rel error JS :", relError.toFixed(8) + "%,", "act: " + actualJS.toFixed(10), "exp: " + expected.toFixed(10));
          assert.isBelow(relError, 0.000000004200); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

            const actualSOL = (await blackScholesNUM.exp(tokens(x))).toString() / 1e18;
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

      it("exp lower [-50, -0.05]", async function () {
        for (let x = 0.05; x >= 50; x += 0.05 ) { 
          const expected = Math.exp(-x);
          const actualJS = blackScholesNUMJS.exp(-x);
          const absError = Math.abs(actualJS - expected);
          const relError = absError / expected * 100;
          // console.log("Rel error for x: ", rate, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
          // assert.isBelow(absError, 0.00000003);
          assert.isBelow(relError, 0.00000006);
        }
      });
    });

    describe.only("ln", function () {
      // todo: test all limits like 1.090507732665257659
      it("ln upper [1, 1.0905]", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          const expected = Math.log(x);
          const actualJS = blackScholesNUMJS.lnUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", rate, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
          // assert.isBelow(absError, 0.00000001);
          assert.isBelow(relError, 0.000000000150); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            // assert.isBelow(absError, 0.00000001);
            assert.isBelow(relError, 0.000000000150); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.lnMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln [1.0905, 16]", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          const expected = Math.log(x);
          const actualJS = blackScholesNUMJS.lnUpper(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
          // assert.isBelow(absError, 0.00000001);
          assert.isBelow(relError, 0.000000000150); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

            const actualSOL = (await blackScholesNUM.ln(tokens(x))).toString() / 1e18;
            const absError = Math.abs(actualSOL - expected);
            const relError = expected !== 0 ? absError / expected * 100 : 0;
            // console.log("x: ", x.toFixed(3), "rel error SOL:", relError.toFixed(8) + "%,", "act: " + actualSOL.toFixed(10), "exp: " + expected.toFixed(10));
            // assert.isBelow(absError, 0.00000001);
            assert.isBelow(relError, 0.000000000150); // 1e-12 

            totalGas += parseInt(await blackScholesNUM.lnMeasureGas(tokens(x)));
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe.only("sqrt", function () {
      // todo: test all limits like 1.04427
      it("sqrt [1, 1.0746]", async function () { // root(64, 100) = 1.074607828321317497
        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.074607828321317497; x += 0.0001) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesNUMJS.sqrt(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

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

      it("sqrt [1.04427, 100)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1.074607828321317497; x < 100; x += 0.1) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesNUMJS.sqrt(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

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

      it("sqrt [100, 10000)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 100; x < 10000; x += 9.89) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesNUMJS.sqrt(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

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

      it("sqrt [1e4, 1e6)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1e4; x < 1e6; x += 1e3) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesNUMJS.sqrt(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

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

      it("sqrt [1e6, 1e8)", async function () {
        let totalGas = 0, count = 0;
        for (let x = 1e6; x < 1e8; x += 1e5) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesNUMJS.sqrt(x);
          const absError = Math.abs(actualJS - expected);
          const relError = expected !== 0 ? absError / expected * 100 : 0;
          // console.log("Rel error for x: ", x.toFixed(4), "JS:", relError.toFixed(12) + "%, ", "act: " + actualJS.toFixed(12), "exp: " + expected.toFixed(12));
          assert.isBelow(relError, 0.000000000072); // 1e-12 

          if (duoTest) {
            const { blackScholesNUM } = duoTest ? await loadFixture(deployNUM) : { blackScholesNUM: null };

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
    });

    it("getFuturePrice", async function () {
      for (let rate = 0; rate < 4; rate += 0.001) { 
        const expected = getFuturePrice(100, SEC_IN_YEAR, rate);
        const actualJS = blackScholesNUMJS.getFuturePrice(100, SEC_IN_YEAR, rate);
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
        const actualJS = blackScholesNUMJS.getDiscountedStrike(100, SEC_IN_YEAR, rate);
        const absError = Math.abs(actualJS - expected);
        const relError = absError / expected * 100;
        // console.log("Rel error for x: ", rate, "JS:", relError.toFixed(8) + "%, ", "act: " + actualJS.toFixed(8), "exp: " + expected.toFixed(8));
        assert.isBelow(absError, 0.00000300); // in $ on a $100 spot
        assert.isBelow(relError, 0.00000006); // in %
      }
    });

    it("test stdCDF", async function () {

      let expected = bs.stdNormCDF(0.6100358074173348);
      let actualJS = blackScholesNUMJS.stdNormCDF(0.6100358074173348);
      console.log("exp: " + expected.toFixed(10));
      console.log("act: " + actualJS.toFixed(10));
      console.log("diff:", Math.abs(expected - actualJS));

      expected = bs.stdNormCDF(0.6100358074173348);
      actualJS = blackScholesNUMJS.stdNormCDF2(0.6100358074173348);
      console.log("exp: " + expected.toFixed(10));
      console.log("act: " + actualJS.toFixed(10));
      console.log("diff:", Math.abs(expected - actualJS));
      // d1 0.6100358074173348 d2 0.2115455057186043
    });

    it("test getD1", async function () {
      for (let i = 0; i < 200; i++) { 
        const t = (10 + i) / 365;
        const expected = bs.getW(1000, 1000 - i, t, 0.60, 0);
        const actualJS = blackScholesNUMJS.getD1(1000, 1000 - i, t, 0.60, 0);

        const absError = Math.abs(actualJS - expected);
        const relError = expected !== 0 ? absError / expected * 100 : 0;
        console.log(i, "exp: " + expected.toFixed(8), "act: " + actualJS.toFixed(8),);
        assert.isBelow(absError, 0.00000040);
        assert.isBelow(relError, 0.00000006);
      }
    });

    it("test getD2", async function () {
      for (let i = 0; i < 200; i++) {
        const t = (10 + i) / 365;
        const expectedD1 = bs.getW(1000, 1000 - i, t, 0.60, 0);
        const expected = expectedD1 - 0.60 * Math.sqrt(t);

        const actualD1 = blackScholesNUMJS.getD1(1000, 1000 - i, t, 0.60, 0);
        const actualJS = blackScholesNUMJS.getD2(actualD1, t, 0.60);

        const absError = Math.abs(actualJS - expected);
        const relError = expected !== 0 ? absError / expected * 100 : 0;
        // console.log(i, "exp: " + expected.toFixed(8), "act: " + actualJS.toFixed(8),);
        assert.isBelow(absError, 0.00000040);
        assert.isBelow(relError, 0.00000006);
      }
    });

    it("test getCallPrice", async function () {
      for (let i = 0; i < 200; i++) {
        const t = (10 + i) / 365;
        const expected = bs.blackScholes(1000, 1000 - i, t, 0.60, 0, "call");
        const actualJS = blackScholesNUMJS.getCallOptionPrice(1000, 1000 - i, t * SEC_IN_YEAR, 0.60, 0);

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

        // it.only("standardDistributionFunction gas", async function () {
  //   const { blackScholesPOC } = await loadFixture(deploy);

  //   let count = 0;
  //   let totalGas = 0;
  //   for (let i = 4; i < 32; i++) {
  //     const gasUsed = await blackScholesPOC.standardDistributionFunctionMeasureGas(2 ** i + 1);
  //     totalGas += parseInt(gasUsed);
  //     count++;
  //   }
  //   console.log("Gas spent [avg]: ", parseInt(totalGas / count), "tests:", count);
  // });

  // it.only("ln gas", async function () {
  //   const { blackScholesPOC } = await loadFixture(deploy);

  //   let count = 0;
  //   let totalGas = 0;
  //   for (let i = 4; i < 32; i++) {
  //     const gasUsed = await blackScholesPOC.lnMeasureGas(tokens(i));
  //     totalGas += parseInt(gasUsed);
  //     count++;
  //   }
  //   console.log("Gas spent [avg]: ", parseInt(totalGas / count), "tests:", count);
  // });

  // it.only("ln accuracy", async function () {
  //   const { blackScholesPOC } = await loadFixture(deploy);

  //   for (let i = 0; i < 10; i++) {
  //     const result = await blackScholesPOC.ln.staticCallResult();
  //     console.log(result.toString(), Math.log(i));
  //   }
  // });

  });

  duoTest && describe("performance", function () {
    it("getCallOptionPrice gas single call", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      const gas = parseInt(await blackScholesPOC.getCallOptionPrice.estimateGas(tokens(1000), tokens(930), 30 * SEC_IN_DAY, tokens(0.6), Math.round(0.05 * 10_000))) - 21000;
      await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 30 * SEC_IN_DAY, tokens(0.6), Math.round(0.05 * 10_000));
      console.log("Gas spent:", Math.round(gas));
    });

    it("getCallOptionPrice gas multiple calls", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for(let exp = 10; exp < 400; exp += 60) {
        for (let strike = 700; strike < 1300; strike += 100) {
          for (let vol = 0.5; vol < 1; vol += 0.1) {
            for (let rate = 0; rate < 0.06; rate += 0.02) {
              totalGas += parseInt(await blackScholesPOC.getCallOptionPrice.estimateGas(tokens(1000), tokens(strike), exp * SEC_IN_DAY, tokens(vol), Math.round(rate * 10_000))) - 21000;
              count++;
            }
          }
        }
      }
      console.log("Gas spent [avg]:", Math.round(totalGas / count), "tests:", count);
    });

    it("getPutOptionPrice gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for(let exp = 10; exp < 400; exp += 60) {
        for (let strike = 700; strike < 1300; strike += 100) {
          for (let vol = 0.5; vol < 1; vol += 0.1) {
            for (let rate = 0; rate < 0.06; rate += 0.02) {
              totalGas += parseInt(await blackScholesPOC.getPutOptionPrice.estimateGas(tokens(1000), tokens(strike), exp * SEC_IN_DAY, tokens(vol), Math.round(rate * 10_000))) - 21000;
              count++;
            }
          }
        }
      }
      console.log("Gas spent [avg]:", Math.round(totalGas / count), "tests:", count);
    });

    it("getFuturePrice gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for (let rate = 0; rate <= 0.2; rate += 0.04) {
        for (let days = 0; days <= 2 * 365; days += 10) {
          const gasUsed = await blackScholesPOC.getFuturePriceMeasureGas(tokens(100), days * SEC_IN_DAY, Math.round(rate * 10_000));
          totalGas += parseInt(gasUsed);
          count++;
        }
      }
      console.log("Gas spent [avg]: ", parseInt(totalGas / count), "tests:", count);
    });

    // it("test gas", async function () {
    //   const { blackScholesPOC } = await loadFixture(deploy);

    //   const callPriceMap = await blackScholesPOC.measureGas();
    //   console.log(callPriceMap);
    // });
  });

  describe("functionality", async function () {
    describe("getFuturePrice " + (fastTest ? "FAST" : "SLOW"), function () {
      it("calculates future price for lowest time and rate", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        const expected = getFuturePrice(100, 1, 0.0001);
        const actualJS = blackScholesJS.getFuturePrice(100, 1, 1);
        const errorJS = (Math.abs(actualJS - expected) / expected * 100);
        // console.log("Max error JS:", errorJS.toFixed(6) + "%, ", "actual: " + actualJS.toFixed(6), "expected: " + expected.toFixed(6));
        assert.isBelow(errorJS, 0.0001); // is below 0.0001%

        if (duoTest) {
          const actualSOL = (await blackScholesPOC.getFuturePrice(tokens(100), 1, 1)).toString() / 1e18;
          const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
          // console.log("Max error SOL:", errorSOL.toFixed(6) + "%, ", "actual: " + actualSOL.toFixed(6), "expected: " + expected.toFixed(6));
          assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
        }
      });

      it("calculates future price [0s, 10m]", async function () {
        const step = fastTest ? 0.04 : 0.005;
        const filterEvery = fastTest ? 4 : 1;
        const testRatePoints = generateTestRatePoints(0, 0.2, step);
        const timeSubArray = testTimePoints.filter(value => value <= 600).filter((_, i) => i % filterEvery === 0);
        await testFuturePriceRange(testRatePoints, timeSubArray, 0.0001, !fastTest);
      });

      it("calculates future price [10m, 1d]", async function () {
        const step = fastTest ? 0.04 : 0.005;
        const filterEvery = fastTest ? 6 : 1;
        const testRatePoints = generateTestRatePoints(0, 0.2, step);
        const timeSubArray = testTimePoints.filter(value => value >= 600 && value <= SEC_IN_DAY).filter((_, i) => i % filterEvery === 0);
        await testFuturePriceRange(testRatePoints, timeSubArray, 0.0001, !fastTest);
      });

      it("calculates future price [1d, 730d]", async function () {
        const step = fastTest ? 0.04 : 0.005;
        const filterEvery = fastTest ? 7 : 1;
        const testRatePoints = generateTestRatePoints(0, 0.2, step);
        const timeSubArray = testTimePoints.filter(value => value >= SEC_IN_DAY && value <= 730 * SEC_IN_DAY).filter((_, i) => i % filterEvery === 0);
        await testFuturePriceRange(testRatePoints, timeSubArray, 0.00142, !fastTest); // 0.00142%
      });
    });

    describe("getCallOptionPrice " + (fastTest ? "FAST" : "SLOW"), function () {
      describe("success", function () {
        describe("single option test", function () {

          it("gets multiple call prices: $999 - $999.5, find worst case", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 99.9 && value <= 99.95);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 480);
            await testOptionRange(strikeSubArray, timeSubArray, [0.12], true, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $999.5 - $1000, find worst case", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 99.95 && value <= 100);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 480);
            await testOptionRange(strikeSubArray, timeSubArray, [0.12], true, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $1000 - $1000.05, find worst case", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 100 && value <= 100.05);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 480);
            await testOptionRange(strikeSubArray, timeSubArray, [0.12], true, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $1000.05 - $1000.1, find worst case", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 100.05 && value <= 100.1);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 480);
            await testOptionRange(strikeSubArray, timeSubArray, [0.12], true, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $999.5 - $1000, find worst case", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 99.95 && value <= 100);
            const timeSubArray = testTimePoints.filter(value => value >= 90 && value <= 110);
            await testOptionRange(strikeSubArray, timeSubArray, [0.12], true, maxRelError, maxAbsError, 10);
          });

          // this is what I am testing, don't delete this test
          it("gets a single call price in curved area", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = blackScholesWrapped(1000, 999.9375, 90 / (365 * SEC_IN_DAY), 0.12, 0, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 999.9375, 90, 0.12, 0);
            const errorJS = Math.abs(actualJS - expected);
            console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));
            assert.isBelow(errorJS, maxAbsError);

            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(999.9375), 90, tokens(0.12), 0)).toString() / 1e18;
              const errorSOL = Math.abs(actualSOL - expected);
              console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
              assert.isBelow(errorSOL, maxAbsError);
            }
          });

          it("gets a single call price when time > 2 ^ 16", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = blackScholesWrapped(1000, 930, 60 / 365, 0.60, 0.05, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 930, 60 * SEC_IN_DAY, 0.60, 0.05);
            const errorJS = Math.abs(actualJS - expected);
            console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));
            assert.isBelow(errorJS, maxAbsError);

            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 60 * SEC_IN_DAY, tokens(0.60), Math.round(0.05 * 10_000))).toString() / 1e18;
              const errorSOL = Math.abs(actualSOL - expected);
              console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
              assert.isBelow(errorSOL, maxAbsError);
            }
          });

          it("gets a single call price when time < 2 ^ 16", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = blackScholesWrapped(1000, 990, 0.05 / 365, 0.40, 0.05, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 990, 0.05 * SEC_IN_DAY, 0.40, 0.05);
            const errorJS = Math.abs(actualJS - expected);
            console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));
            assert.isBelow(errorJS, maxAbsError);


            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(990), 0.05 * SEC_IN_DAY, tokens(0.40), Math.round(0.05 * 10_000))).toString() / 1e18;
              const errorSOL = Math.abs(actualSOL - expected);
              console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
              assert.isBelow(errorSOL, maxAbsError);
            }
          });

          it("gets a single call price when time > 2 ^ 16", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = blackScholesWrapped(1000, 990, 50 / 365, 0.40, 0.05, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 990, 50 * SEC_IN_DAY, 0.40, 0.05);
            const errorJS = Math.abs(actualJS - expected);
            console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));
            assert.isBelow(errorJS, maxAbsError);

            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(990), 50 * SEC_IN_DAY, tokens(0.40), Math.round(0.05 * 10_000))).toString() / 1e18;
              const errorSOL = Math.abs(actualSOL - expected);
              console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
              assert.isBelow(errorSOL, maxAbsError);
            }
          });

          it("gets a single call price: debug", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = blackScholesWrapped(1000, 1000.7187499999999, 77312 / SEC_IN_YEAR, 0.01, 0, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 1000.7187499999999, 77312, 0.01, 0);
            console.log("expected:", expected, "actual JS :", actualJS);

            if (duoTest) {
              const actualSOL = await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(1000.7187499999999), 77312, tokens(0.01), 0);
              console.log("expected:", expected, "actual SOL:", actualSOL.toString() / 1e18);
            }
          });
        });

        describe("random tests", function () {
          it("gets multiple call prices at smallest scale: random " + (fastTest ? "FAST" : "SLOW"), async function () {
            const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 25 : 500, false);
            const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 25 : 500, true);
            const smallScale = 0.000001;
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, maxRelError, maxAbsError * smallScale, 10 * smallScale, !fastTest);
          });

          it("gets multiple call prices at normal scale: random " + (fastTest ? "FAST" : "SLOW"), async function () {
            const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 25 : 500, false);
            const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 25 : 500, true);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, maxRelError, maxAbsError, 10, !fastTest);
          });

          it("gets multiple call prices at largest scale: random " + (fastTest ? "FAST" : "SLOW"), async function () {
            const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 25 : 500, false);
            const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 25 : 500, true);
            const largeScale = 1e12;
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, maxRelError, maxAbsError * largeScale, 10 * largeScale, !fastTest);
          });
        });

        describe("limit tests", function () {
          it("gets multiple call prices: $200 - $900, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, maxRelError, maxAbsError, 10, false);
          });

          it("gets multiple call prices: $900 - $990, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, maxRelError, maxAbsError, 10, false);
          });

          it("gets multiple call prices: $990 - $1010, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, maxRelError, maxAbsError, 10, false);
          });

          it("gets multiple call prices: $1010 - $1100, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, maxRelError, maxAbsError, 10, false);
          });

          it("gets multiple call prices: $1100 - $1300, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, maxRelError, maxAbsError, 10, false);
          });

          it("gets multiple call prices: $1300 - $2000, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, maxRelError, maxAbsError, 10, false);
          });

          it("gets multiple call prices: $2000 - $5000, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, maxRelError, maxAbsError, 10, false);
          });
        });

        !fastTest && describe("multiple call options - 16x16 per cell", function () {
          const isCall = true;
          it("gets multiple call prices: $200 - $900, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 20 && value <= 90);
            const timeSubArray = testTimePoints.filter(value => value >= 1 );
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $900 - $990, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 90 && value <= 99);
            const timeSubArray = testTimePoints.filter(value => value >= 1);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $990 - $999, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 99 && value <= 99.9);
            const timeSubArray = testTimePoints.filter(value => value >= 1);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $999 - $1001, Xs - 2y, 12%", async function () { // todo: < 480
            const strikeSubArray = testStrikePoints.filter(value => value >= 99.9 && value <= 100.1);
            const timeSubArray = testTimePoints.filter(value => value >= 480 * 144);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, 0.02, 0.03], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $999 - $1001, 480s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 99.9 && value <= 100.1);
            const timeSubArray = testTimePoints.filter(value => value >= 480); // todo: < 480
            await testOptionRange(strikeSubArray, timeSubArray, [VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $1001 - $1010, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 100.1 && value <= 101);
            const timeSubArray = testTimePoints.filter(value => value >= 1);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $1010 - $1100, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 101 && value <= 110);
            const timeSubArray = testTimePoints.filter(value => value >= 1);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $1100 - $1300, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 110 && value <= 130);
            const timeSubArray = testTimePoints.filter(value => value >= 1);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $1300 - $2000, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 130 && value <= 200);
            const timeSubArray = testTimePoints.filter(value => value >= 1);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });

          it("gets multiple call prices: $2000 - $5000, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 200 && value < 500);
            const timeSubArray = testTimePoints.filter(value => value >= 1);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
          });
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(0.00000099, 0.00000099, 50000, 0.6, 0.05)).to.throw("1");
          expect(() => blackScholesJS.getCallOptionPrice(0, 0, 50000, 0.6, 0.05)).to.throw("1");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), 1);
            await blackScholesPOC.getCallOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), 1);
          }
        });

        it("rejects when spot > max spot", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(1e15 + 1, 1e15 + 1, 50000, 1.920000001, 0.05)).to.throw("2");
          expect(() => blackScholesJS.getCallOptionPrice(1e18, 1e18, 50000, 10_000, 0.05)).to.throw("2");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 2);
            await blackScholesPOC.getCallOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 2);
          }
        });

        it("rejects when strike < spot / 5", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 199.999999, 50000, 0.6, 0.05)).to.throw("3");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 0, 50000, 0.6, 0.05)).to.throw("3");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 3);
            await blackScholesPOC.getCallOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000))
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), "0", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 3);
          }
        });

        it("rejects when strike > spot * 5", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 5000.000001, 50000, 1.920000001, 0.05)).to.throw("4");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 100000, 50000, 10_000, 0.05)).to.throw("4");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 4);
            await blackScholesPOC.getCallOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), Math.round(0.05 * 10_000)), 4);
          }
        });

        it("rejects when time > max time", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 4294967295, 0.60, 0.05)).to.throw("5");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 63072001, 0.60, 0.05)).to.throw("5");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), Math.round(0.05 * 10_000)), 5);
            await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), Math.round(0.05 * 10_000)); // todo: check value when 2 years in another test
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), Math.round(0.05 * 10_000)), 5);
          }
        });

        it("rejects when vol < min volatility", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 0.009999999999, 0.05)).to.throw("6");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 0, 0.05)).to.throw("6");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, "9999999999999999", Math.round(0.05 * 10_000)), 6);
            await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, "10000000000000000", Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0), Math.round(0.05 * 10_000)), 6);
          }
        });

        it("rejects when vol > max volatility", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 1.920000001, 0.05)).to.throw("7");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 10_000, 0.05)).to.throw("7");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, "1920000000000000001", Math.round(0.05 * 10_000)), 7);
            await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, "1920000000000000000", Math.round(0.05 * 10_000))
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(10_000), Math.round(0.05 * 10_000)), 7);
          }
        });

        it("rejects when rate > max volatility", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 0.6, 0.200000001)).to.throw("8");
          expect(() => blackScholesJS.getCallOptionPrice(1000, 930, 50000, 0.6, 50)).to.throw("8");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), 2001), 8);
            await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), 2000);
            await assertRevertError(blackScholesPOC, blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), 65535), 8);
          }
        });
      });
    });

    describe("getPutOptionPrice " + (fastTest ? "FAST" : "SLOW"), function () {
      describe("single option test", function () {
        it("gets a single put price when time > 2 ^ 16", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          const expected = blackScholesWrapped(1000, 1070, 60 / 365, 0.60, 0.05, "put");

          const actualJS = blackScholesJS.getPutOptionPrice(1000, 1070, 60 * SEC_IN_DAY, 0.60, 0.05);
          const errorJS = (Math.abs(actualJS - expected) / expected * 100);
          assert.isBelow(errorJS, 0.0001); // is below 0.0001%
          // console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));

          if (duoTest) {
            const actualSOL = (await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(1070), 60 * SEC_IN_DAY, tokens(0.60), Math.round(0.05 * 10_000))).toString() / 1e18;
            const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
            assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
            // console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
          }
        });

        it("gets a single put price when time < 2 ^ 16", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          const expected = blackScholesWrapped(1000, 1010, 0.05 / 365, 0.40, 0.05, "put");

          const actualJS = blackScholesJS.getPutOptionPrice(1000, 1010, 0.05 * SEC_IN_DAY, 0.40, 0.05);
          const errorJS = (Math.abs(actualJS - expected) / expected * 100);
          assert.isBelow(errorJS, 0.0001); // is below 0.0001%
          // console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));

          if (duoTest) {
            const actualSOL = (await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(1010), 0.05 * SEC_IN_DAY, tokens(0.40), Math.round(0.05 * 10_000))).toString() / 1e18;
            const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
            assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
            // console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
          }
        });

        it("gets a single call price when time > 2 ^ 16", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          const expected = blackScholesWrapped(1000, 990, 50 / 365, 0.40, 0.05, "put");

          const actualJS = blackScholesJS.getPutOptionPrice(1000, 990, 50 * SEC_IN_DAY, 0.40, 0.05);
          const errorJS = (Math.abs(actualJS - expected) / expected * 100);
          assert.isBelow(errorJS, 0.0001); // is below 0.0001%
          // console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));

          if (duoTest) {
            const actualSOL = (await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(990), 50 * SEC_IN_DAY, tokens(0.40), Math.round(0.05 * 10_000))).toString() / 1e18;
            const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
            assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
            // console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
          }
        });

        it("gets a single put price: debug", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          const expected = blackScholesWrapped(1000, 901.9375000000001, 144 / SEC_IN_YEAR, 0.01, 0, "put");

          const actualJS = blackScholesJS.getPutOptionPrice(1000, 901.9375000000001, 144, 0.01, 0);
          // console.log("expected:", expected, "actual JS :", actualJS);

          if (duoTest) {
            const actualSOL = await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(901.9375000000001), 145, tokens(0.01), 0);
            // console.log("expected:", expected, "actual SOL:", actualSOL.toString() / 1e18);
          }
        });
      });

      describe("random tests", function () {
        it("gets multiple put prices at smallest scale: random " + (fastTest ? "FAST" : "SLOW"), async function () {
          const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 25 : 500, false);
          const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 25 : 500, true);
          const smallScale = 0.000001;
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], false, maxRelError, maxAbsError * smallScale, 10 * smallScale, !fastTest);
        });

        it("gets multiple put prices at normal scale: random " + (fastTest ? "FAST" : "SLOW"), async function () {
          const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 25 : 500, false);
          const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 25 : 500, true);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], false, maxRelError, maxAbsError, 10, !fastTest);
        });

        it("gets multiple put prices at largest scale: random " + (fastTest ? "FAST" : "SLOW"), async function () {
          const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 25 : 500, false);
          const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 25 : 500, true);
          const largeScale = 1e12;
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], false, maxRelError, maxAbsError * largeScale, 10 * largeScale, !fastTest);
        });
      });

      describe("limit tests", function () {
        it("gets multiple put prices: $200 - $900, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, maxRelError, maxAbsError, 10, false);
        });

        it("gets multiple put prices: $900 - $990, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, maxRelError, maxAbsError, 10, false);
        });

        it("gets multiple put prices: $990 - $1010, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, maxRelError, maxAbsError, 10, false);
        });

        it("gets multiple put prices: $1010 - $1100, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, maxRelError, maxAbsError, 10, false);
        });

        it("gets multiple put prices: $1100 - $1300, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, maxRelError, maxAbsError, 10, false);
        });

        it("gets multiple put prices: $1300 - $2000, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, maxRelError, maxAbsError, 10, false);
        });

        it("gets multiple put prices: $2000 - $5000, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, maxRelError, maxAbsError, 10, false);
        });
      });

      !fastTest && describe("multiple put options - 16x16 per cell", function () {
        const isCall = false;
        it("gets multiple put prices: $200 - $900, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 20 && value <= 90);
          const timeSubArray = testTimePoints.filter(value => value >= 1 );
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $900 - $990, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 90 && value <= 99);
          const timeSubArray = testTimePoints.filter(value => value >= 1);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $990 - $999, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 99 && value <= 99.9);
          const timeSubArray = testTimePoints.filter(value => value >= 1);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $999 - $1001, Xs - 2y, 12%", async function () { // todo: < 480
          const strikeSubArray = testStrikePoints.filter(value => value >= 99.9 && value <= 100.1);
          const timeSubArray = testTimePoints.filter(value => value >= 480 * 144);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, 0.02, 0.03], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $999 - $1001, 480s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 99.9 && value <= 100.1);
          const timeSubArray = testTimePoints.filter(value => value >= 480); // todo: < 480
          await testOptionRange(strikeSubArray, timeSubArray, [VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $1001 - $1010, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 100.1 && value <= 101);
          const timeSubArray = testTimePoints.filter(value => value >= 1);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $1010 - $1100, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 101 && value <= 110);
          const timeSubArray = testTimePoints.filter(value => value >= 1);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $1100 - $1300, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 110 && value <= 130);
          const timeSubArray = testTimePoints.filter(value => value >= 1);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $1300 - $2000, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 130 && value <= 200);
          const timeSubArray = testTimePoints.filter(value => value >= 1);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });

        it("gets multiple put prices: $2000 - $5000, 1s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 200 && value < 500);
          const timeSubArray = testTimePoints.filter(value => value >= 1);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], isCall, maxRelError, maxAbsError, 10);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(0.00000099, 0.00000099, 50000, 0.6, 0.05)).to.throw("1");
          expect(() => blackScholesJS.getPutOptionPrice(0, 0, 50000, 0.6, 0.05)).to.throw("1");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice("999999999999", tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), 1);
            await blackScholesPOC.getPutOptionPrice("1000000000000", "1000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(0), tokens(930), 50000, tokens(0.6), Math.round(0.05 * 10_000)), 1);
          }
        });

        it("rejects when spot > max spot", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(1e15 + 1, 1e15 + 1, 50000, 1.920000001, 0.05)).to.throw("2");
          expect(() => blackScholesJS.getPutOptionPrice(1e18, 1e18, 50000, 10_000, 0.05)).to.throw("2");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 2);
            await blackScholesPOC.getPutOptionPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 2);
          }
        });

        it("rejects when strike < spot / 5", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 199.999999, 50000, 0.6, 0.05)).to.throw("3");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 0, 50000, 0.6, 0.05)).to.throw("3");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 3);
            await blackScholesPOC.getPutOptionPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000))
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), "0", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 3);
          }
        });

        it("rejects when strike > spot * 5", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 5000.000001, 50000, 1.920000001, 0.05)).to.throw("4");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 100000, 50000, 10_000, 0.05)).to.throw("4");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), Math.round(0.05 * 10_000)), 4);
            await blackScholesPOC.getPutOptionPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), Math.round(0.05 * 10_000)), 4);
          }
        });

        it("rejects when time > max time", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 4294967295, 0.60, 0.05)).to.throw("5");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 63072001, 0.60, 0.05)).to.throw("5");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), Math.round(0.05 * 10_000)), 5);
            await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), Math.round(0.05 * 10_000)); // todo: check value when 2 years in another test
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), Math.round(0.05 * 10_000)), 5);
          }
        });

        it("rejects when vol < min volatility", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 0.009999999999, 0.05)).to.throw("6");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 0, 0.05)).to.throw("6");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, "9999999999999999", Math.round(0.05 * 10_000)), 6);
            await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, "10000000000000000", Math.round(0.05 * 10_000));
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0), Math.round(0.05 * 10_000)), 6);
          }
        });

        it("rejects when vol > max volatility", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 1.920000001, 0.05)).to.throw("7");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 10_000, 0.05)).to.throw("7");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, "1920000000000000001", Math.round(0.05 * 10_000)), 7);
            await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, "1920000000000000000", Math.round(0.05 * 10_000))
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(10_000), Math.round(0.05 * 10_000)), 7);
          }
        });

        it("rejects when rate > max volatility", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 0.6, 0.200000001)).to.throw("8");
          expect(() => blackScholesJS.getPutOptionPrice(1000, 930, 50000, 0.6, 50)).to.throw("8");

          if (duoTest) {
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), 2001), 8);
            await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), 2000);
            await assertRevertError(blackScholesPOC, blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 50000, tokens(0.6), 65535), 8);
          }
        });
      });
    });

    describe("getIndexFromTime " + (fastTest ? "FAST" : "SLOW"), function () {
      async function getActualExpected(blackScholesPOC, time) {
        // check index against log2, which we don't have in JS
        const major = Math.floor(Math.log2(time));
        const minor = Math.floor((time - 2 ** major) / 2 ** (major - 3));
        const expected = major * 10 + minor;

        const actualJS = blackScholesJS.getIndexFromTime(time);

        let actualSOL;
        if (duoTest) {
          actualSOL = await blackScholesPOC.getIndexFromTime(time);
        }

        return { actualJS, actualSOL, expected };
      }

      it("calculates index for time [0, 2^3)", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        // JS
        assert.equal(blackScholesJS.getIndexFromTime(0), 0);
        assert.equal(blackScholesJS.getIndexFromTime(1), 1);
        assert.equal(blackScholesJS.getIndexFromTime(2), 2);
        assert.equal(blackScholesJS.getIndexFromTime(3), 3);
        assert.equal(blackScholesJS.getIndexFromTime(4), 4);
        assert.equal(blackScholesJS.getIndexFromTime(5), 5);
        assert.equal(blackScholesJS.getIndexFromTime(6), 6);
        assert.equal(blackScholesJS.getIndexFromTime(7), 7);

        // SOL
        if (duoTest) {
          assert.equal(await blackScholesPOC.getIndexFromTime(0), 0);
          assert.equal(await blackScholesPOC.getIndexFromTime(1), 1);
          assert.equal(await blackScholesPOC.getIndexFromTime(2), 2);
          assert.equal(await blackScholesPOC.getIndexFromTime(3), 3);
          assert.equal(await blackScholesPOC.getIndexFromTime(4), 4);
          assert.equal(await blackScholesPOC.getIndexFromTime(5), 5);
          assert.equal(await blackScholesPOC.getIndexFromTime(6), 6);
          assert.equal(await blackScholesPOC.getIndexFromTime(7), 7);
        }
      });

      it("calculates index for time [2^3, 2^16)", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        let count = 0;
        let step = fastTest ? 32 : 1;
        for (let time = 8; time < 2 ** 16; time += step) {
          const { actualJS, actualSOL, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actualJS, expected);

          if (duoTest) {
            assert.equal(actualSOL, expected);
          }
          count++;
        }
        // console.log("values tested: ", count);
      });

      it("calculates index for time [2^16, 2^24)", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        let count = 0;
        let step = fastTest ? 32 : 1;
        for (let time = 2 ** 16; time < 2 ** 24; time += 2 ** 8 * step) {
          const { actualJS, actualSOL, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actualJS, expected);

          if (duoTest) {
            assert.equal(actualSOL, expected);
          }
          count++;
        }
        // console.log("values tested: ", count);
      });

      it("calculates index for time [2^24, 2^32)", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        let count = 0;
        let step = fastTest ? 32 : 1;
        for (let time = 2 ** 24; time < 2 ** 32; time += 2 ** 16 * step) {
          const { actualJS, actualSOL, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actualJS, expected);

          if (duoTest) {
            assert.equal(actualSOL, expected);
          }
          count++;
        }
        // console.log("values tested: ", count);
      });

      it("calculates index for time [2^32, 2^34)", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        let count = 0;
        let step = fastTest ? 32 : 1;
        for (let time = 2 ** 32; time < 2 ** 34; time += 2 ** 18 * step) {
          const { actualJS, actualSOL, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actualJS, expected);

          if (duoTest) {
            assert.equal(actualSOL, expected);
          }
          count++;
        }
        // console.log("values tested: ", count);
      });
    });

    describe("getIndexAndWeightFromStrike " + (fastTest ? "FAST" : "SLOW"), function () {
      describe("multiple", function () {
        it("calculates indexes for strike [20, 500]", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          const filterEvery = fastTest ? 7 : 1;
          const testStrikePoints = generateTestStrikePoints(blackScholesJS, 20, 501).filter((_, i) => i % filterEvery === 0);
          for (let i = 0; i < testStrikePoints.length - 1; i++) {
            const actualJS = blackScholesJS.getIndexAndWeightFromStrike(testStrikePoints[i]).strikeIndex;
            assert.equal(true, actualJS <= testStrikePoints[i] * 100);

            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getIndexAndWeightFromStrike(tokens(testStrikePoints[i]))).index;
              assert.equal(true, actualSOL <= testStrikePoints[i] * 100);
              assert.equal(actualJS, actualSOL);
            }
          }
        });
      });

      describe("specific values", function () {
        async function testSpecificValue(index, strike, blackScholesPOC) {
          assert.equal(index * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexAndWeightFromStrike(strike).strikeIndex);
          if (duoTest) {
            assert.equal(index * STRIKE_INDEX_MULTIPLIER, (await blackScholesPOC.getIndexAndWeightFromStrike(tokens(strike))).index);
          }
        }

        it("calculates index for strike [20, 90)", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          await testSpecificValue(20, 20, blackScholesPOC);
          await testSpecificValue(20, 20.1, blackScholesPOC);
          await testSpecificValue(20, 20.499999, blackScholesPOC);
          await testSpecificValue(20.5, 20.5, blackScholesPOC);
          await testSpecificValue(20.5, 20.50001, blackScholesPOC);
          await testSpecificValue(89.5, 89.5, blackScholesPOC);
          await testSpecificValue(89.5, 89.9, blackScholesPOC);
          await testSpecificValue(89.5, 89.999999, blackScholesPOC);
        });

        it("calculates index for strike [90, 99)", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          await testSpecificValue(90, 90, blackScholesPOC);
          await testSpecificValue(90, 90.01, blackScholesPOC);
          await testSpecificValue(90, 90.099999, blackScholesPOC);
          await testSpecificValue(90.1, 90.1, blackScholesPOC);
          await testSpecificValue(90.1, 90.100001, blackScholesPOC);
          await testSpecificValue(98.9, 98.9, blackScholesPOC);
          await testSpecificValue(98.9, 98.999999, blackScholesPOC);
        });

        it("calculates index for strike [99, 101)", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          await testSpecificValue(99, 99, blackScholesPOC);
          await testSpecificValue(99, 99.01, blackScholesPOC);
          await testSpecificValue(99, 99.049999, blackScholesPOC);
          await testSpecificValue(99.05, 99.05, blackScholesPOC);
          await testSpecificValue(100.95, 100.95, blackScholesPOC);
          await testSpecificValue(100.95, 100.99, blackScholesPOC);
          await testSpecificValue(100.95, 100.999999, blackScholesPOC);
        });

        it("calculates index for strike [101, 110)", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          await testSpecificValue(101, 101, blackScholesPOC);
          await testSpecificValue(101, 101.01, blackScholesPOC);
          await testSpecificValue(101, 101.099999, blackScholesPOC);
          await testSpecificValue(101.1, 101.1, blackScholesPOC);
          await testSpecificValue(101.1, 101.100001, blackScholesPOC);
          await testSpecificValue(109.9, 109.9, blackScholesPOC);
          await testSpecificValue(109.9, 109.999999, blackScholesPOC);
        });

        it("calculates index for strike [110, 130)", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          await testSpecificValue(110, 110, blackScholesPOC);
          await testSpecificValue(110, 110.1, blackScholesPOC);
          await testSpecificValue(110, 110.499999, blackScholesPOC);
          await testSpecificValue(110.5, 110.5, blackScholesPOC);
          await testSpecificValue(110.5, 110.50001, blackScholesPOC);
          await testSpecificValue(129.5, 129.5, blackScholesPOC);
          await testSpecificValue(129.5, 129.9, blackScholesPOC);
          await testSpecificValue(129.5, 129.999999, blackScholesPOC);
        });

        it("calculates index for strike [130, 200)", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          await testSpecificValue(130, 130, blackScholesPOC);
          await testSpecificValue(130, 130.1, blackScholesPOC);
          await testSpecificValue(130, 130.999999, blackScholesPOC);
          await testSpecificValue(131, 131, blackScholesPOC);
          await testSpecificValue(131, 131.000001, blackScholesPOC);
          await testSpecificValue(199, 199, blackScholesPOC);
          await testSpecificValue(199, 199.9, blackScholesPOC);
          await testSpecificValue(199, 199.999999, blackScholesPOC);
        });

        it("calculates index for strike [200, 500)", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          await testSpecificValue(200, 200, blackScholesPOC);
          await testSpecificValue(200, 202, blackScholesPOC);
          await testSpecificValue(200, 203.999999, blackScholesPOC);
          await testSpecificValue(204, 204, blackScholesPOC);
          await testSpecificValue(204, 204.000001, blackScholesPOC);
          await testSpecificValue(496, 496, blackScholesPOC);
          await testSpecificValue(496, 499, blackScholesPOC);
          await testSpecificValue(496, 499.999999, blackScholesPOC);
        });
      });
    });
  });
});
