
import { assert, expect } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, STRIKE_INDEX_MULTIPLIER, STRIKE_MAX, STRIKE_MIN, VOL_FIXED } from "../poc/blackscholes/BlackScholesJS.mjs";
import { generateLookupTable, generateStrikePoints, generateTimePoints } from "../poc/blackscholes/generateLookupTable.mjs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import hre from "hardhat";

const SEC_IN_DAY = 24 * 60 * 60;
const SEC_IN_YEAR = 365 * 24 * 60 * 60;

const duoTest = true;
const fastTest = true;

function tokens(value) {
  return hre.ethers.parseUnits(value.toString(), 18).toString();
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

    // deploy contract
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

  function getFuturePrice(spot, timeToExpirySec, rate) {
    // future = spot * e^(rT)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
    return futurePrice;
  }

  function findMinAndMax(map) {
    // Initialize min and max objects with Infinity and -Infinity respectively
    const inf = Infinity;
    const result = {
        min: { intrinsicPriceAA: inf, intrinsicPriceBAdiff: inf, a1: inf, b1: inf, c1: inf, a2diff: inf, b2diff: inf, c2diff: inf, a3w: inf, b3w: inf, c3w: inf, a4wdiff: inf, b4wdiff: inf, c4wdiff: inf },
        max: { intrinsicPriceAA: -inf, intrinsicPriceBAdiff: -inf, a1: -inf, b1: -inf, c1: -inf, a2diff: -inf, b2diff: -inf, c2diff: -inf, a3w: -inf, b3w: -inf, c3w: -inf, a4wdiff: -inf, b4wdiff: -inf, c4wdiff: -inf },
        absMin: { a1: inf, b1: inf, c1: inf, a2diff: inf, b2diff: inf, c2diff: inf, a3w: inf, b3w: inf, c3w: inf, a4wdiff: inf, b4wdiff: inf, c4wdiff: inf }
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
      if (key % 1000 < 160) { // 160 is actually 2 ^ 16 secs
        nonSmallTimeMap.delete(key);
      }
    }

    const sameIntrinsicPriceMap = new Map(nonZeroMap);
    for (let [key, value] of nonZeroMap) {
      if (value.intrinsicPriceBAdiff !== 0) {
        sameIntrinsicPriceMap.delete(key);
      }
    }

    // print map and nonZero map size
    console.log("map size: ", map.size, "nonZero map size: ", nonZeroMap.size, "sameIntrinsicPriceMap size: ", sameIntrinsicPriceMap.size);

    // Iterate over the map
    nonSmallTimeMap.forEach(obj => {
        // Update min and max for each key
        for (const key of Object.keys(result.min)) {
            if (obj[key] !== undefined) {
                result.min[key] = Math.min(result.min[key], obj[key]);
                result.max[key] = Math.max(result.max[key], obj[key]);
                if (Math.abs(obj[key]) >= 0) {
                  result.absMin[key] = Math.min(result.absMin[key], Math.abs(obj[key]));
                }
            }
        }
    });

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

  async function testOptionRange(strikePoints, timePoints, volPoints, isCall, allowedAbsError = 0.000114, log = true) {
    const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

    // NSV = non small values, we don't care about error below $0.001
    const multi = 10;
    let maxRelErrorJS = 0, maxAbsErrorJS = 0, totalErrorNSVJS = 0, maxRelErrorSOL = 0, maxAbsErrorSOL = 0, totalErrorNSVSOL = 0, countNSV = 0, count = 0, actualJS = 0, actualSOL = 0;
    let maxRelErrorParamsJS = null, maxAbsErrorParamsJS = null, maxRelErrorParamsSOL = null, maxAbsErrorParamsSOL = null;
    const totalPoints = strikePoints.length * timePoints.length * volPoints.length;
    for (let strike of strikePoints) {
      for(let exp of timePoints) {
        for (let vol of volPoints) {
          for (let rate = 0; rate < 0.01; rate += 0.02) {
            // expected
            const expected = Math.max(0, bs.blackScholes(100 * multi, strike * multi, exp / SEC_IN_YEAR, vol, rate, isCall ? "call" : "put"));

            // JS
            {
              if (isCall) {
                actualJS = blackScholesJS.getCallOptionPrice(100 * multi, strike * multi, exp, vol, rate); // todo: multiplier helps lower worst case  * 1.000004;
              } else {
                actualJS = blackScholesJS.getPutOptionPrice(100 * multi, strike * multi, exp, vol, rate); // todo: multiplier helps lower worst case  * 1.000004;
              }

              const errorJS = expected !== 0 ? (Math.abs(actualJS - expected) / expected * 100) : 0;

              // we don't care about small values
              if (expected > 0.001) {
                totalErrorNSVJS += errorJS;
              }
              // relative error is in percentage
              if (maxRelErrorJS < errorJS && expected > 0.001) {
                maxRelErrorJS = errorJS;
                maxRelErrorParamsJS = {
                  exp, strike: strike * multi, vol, rate, actual: actualJS, expected
                }
              }

              // absolute error is in currency
              const absError = Math.abs(actualJS - expected);
              if (maxAbsErrorJS < absError) {
                maxAbsErrorJS = absError;
                // console.log("maxAbsError", maxAbsError, "strike", strike * multi, "exp", exp);
                maxAbsErrorParamsJS = {
                  exp, strike: strike * multi, vol, rate, actual: actualJS, expected
                }
              }
            }

            // SOL
            if (duoTest) {
              if (isCall) {
                actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
              } else {
                actualSOL = (await blackScholesPOC.getPutOptionPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
              }

              const errorSOL = expected !== 0 ? (Math.abs(actualSOL - expected) / expected * 100) : 0;

              // we don't care about small values
              if (expected > 0.001) {
                totalErrorNSVSOL += errorSOL;
                countNSV++;
              }
              // relative error is in percentage
              if (maxRelErrorSOL < errorSOL && expected > 0.001) {
                maxRelErrorSOL = errorSOL;
                maxRelErrorParamsSOL = {
                  exp, strike: strike * multi, vol, rate, actual: actualSOL, expected
                }
              }

              // absolute error is in currency
              const absError = Math.abs(actualSOL - expected);
              if (maxAbsErrorSOL < absError) {
                maxAbsErrorSOL = absError;
                // console.log("maxAbsError", maxAbsError, "strike", strike * multi, "exp", exp);
                maxAbsErrorParamsSOL = {
                  exp, strike: strike * multi, vol, rate, actual: actualSOL, expected
                }
              }
            }

            count++;

            // print progress
            if (count % Math.round(totalPoints / 20) === 0) {
              log && console.log("Progress:", (count / totalPoints * 100).toFixed(0) + "%, Max abs error:", "$" + (maxAbsErrorJS ? maxAbsErrorJS.toFixed(6) : "0"));
            }
          }
        }
      }
    }

    if (log) {
      const avgError = totalErrorNSVJS / countNSV;
      console.log("totalError NSV: " + totalErrorNSVJS, "count NonSmallValue (NSV): " + countNSV);
  
      // console.log("Total tests: " + count);
      // console.log("Table (map) size: ", blackScholesJS.lookupTable.size);
      console.log("Avg rel NSV error: " + avgError.toFixed(6) + "%,", "Max rel NSV error: " + maxRelErrorJS.toFixed(6) + "%,", "Max abs error:", "$" + maxAbsErrorJS.toFixed(6) + ",", "Total tests: ", count, "Total NSV tests: ", countNSV, "NSV/total ratio: ", ((countNSV / count) * 100).toFixed(2) + "%");
      console.log("Max rel error params JS: ", maxRelErrorParamsJS);
      console.log("Max abs error params JS: ", maxAbsErrorParamsJS, convertSeconds(maxAbsErrorParamsJS ? maxAbsErrorParamsJS.exp : 1));
      console.log("Max rel error params SOL: ", maxRelErrorParamsSOL);
      console.log("Max abs error params SOL: ", maxAbsErrorParamsSOL, convertSeconds(maxAbsErrorParamsSOL ? maxAbsErrorParamsSOL.exp : 1));
    }

    assert.isBelow(maxAbsErrorJS, allowedAbsError); // max error is below max allowed absolute error
    assert.isBelow(maxAbsErrorSOL, allowedAbsError); // max error is below max allowed absolute error
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
    testTimePoints = generateTestTimePoints();
    testStrikePoints = generateTestStrikePoints(new BlackScholesJS(), STRIKE_MIN, STRIKE_MAX);
    const { lookupTable, rows } = await generateLookupTable(new BlackScholesJS(), true);
    blackScholesJS = new BlackScholesJS(lookupTable);

    // profile factors
    let count = 0, intrinsicZeroCount = 0;
    for (let [key, value] of lookupTable) {
      // console.log(key + " is ", value);
      if (value.intrinsicPriceAA === 0 && value.intrinsicPriceBA === 0) {
        intrinsicZeroCount++;
      }
      count++;
    }
    console.log("lookupTable size: ", count, "intrinsic zero count: ", intrinsicZeroCount, (intrinsicZeroCount / count * 100).toFixed(2) + "%");

    // find min and max for parameters
    const result = findMinAndMax(lookupTable);

    // for each attribute in result.min and result.max, print min and max
    for (const key of Object.keys(result.min)) {
      if (key !== undefined) {
        console.log(key, "[", result.min[key], "-", result.max[key], "]");
      }
    }

    // reduce decimals to 6 decimals, all but c3w which is 5 decimals, with almost same precision
    lookupTable.forEach((value, key) => {
      value.intrinsicPriceBAdiff =  Math.round(value.intrinsicPriceBAdiff * 1e6) / 1e6,

      value.a1 = Math.round(value.a1 * 1e6) / 1e6,
      value.b1 = Math.round(value.b1 * 1e6) / 1e6,
      value.c1 = Math.round(value.c1 * 1e6) / 1e6,
      value.a2diff = Math.round(value.a2diff * 1e6) / 1e6,
      value.b2diff = Math.round(value.b2diff * 1e6) / 1e6,
      value.c2diff = Math.round(value.c2diff * 1e6) / 1e6,

      value.a3w = Math.round(value.a3w * 1e6) / 1e6,
      value.b3w = Math.round(value.b3w * 1e6) / 1e6,
      value.c3w = Math.round(value.c3w * 1e5) / 1e5,
      value.a4wdiff = Math.round(value.a4wdiff * 1e6) / 1e6,
      value.b4wdiff = Math.round(value.b4wdiff * 1e6) / 1e6,
      value.c4wdiff = Math.round(value.c4wdiff * 1e6) / 1e6
    });
  });

  duoTest && describe("deployment", function () {
    it("deploys contract", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);
      console.log(blackScholesPOC.target);
    });
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

    it("getIndexFromTime gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let count = 0;
      let totalGas = 0;
      for (let i = 4; i < 32; i++) {
        const gasUsed = await blackScholesPOC.getIndexFromTimeMeasureGas(2 ** i + 1);
        totalGas += parseInt(gasUsed);
        count++;
      }
      console.log("Gas spent [avg]: ", parseInt(totalGas / count), "tests:", count);
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
          it("gets a single call price when time > 2 ^ 16", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 930, 60 * SEC_IN_DAY, 0.60, 0.05);
            const errorJS = (Math.abs(actualJS - expected) / expected * 100);
            assert.isBelow(errorJS, 0.0001); // is below 0.0001%
            console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));

            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 60 * SEC_IN_DAY, tokens(0.60), Math.round(0.05 * 10_000))).toString() / 1e18;
              const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
              assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
              console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
            }
          });

          it("gets a single call price when time < 2 ^ 16", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = bs.blackScholes(1000, 990, 0.05 / 365, 0.40, 0.05, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 990, 0.05 * SEC_IN_DAY, 0.40, 0.05);
            const errorJS = (Math.abs(actualJS - expected) / expected * 100);
            assert.isBelow(errorJS, 0.0001); // is below 0.0001%
            // console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));

            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(990), 0.05 * SEC_IN_DAY, tokens(0.40), Math.round(0.05 * 10_000))).toString() / 1e18;
              const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
              assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
              // console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
            }
          });

          it("gets a single call price when time > 2 ^ 16", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = bs.blackScholes(1000, 990, 50 / 365, 0.40, 0.05, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 990, 50 * SEC_IN_DAY, 0.40, 0.05);
            const errorJS = (Math.abs(actualJS - expected) / expected * 100);
            assert.isBelow(errorJS, 0.0001); // is below 0.0001%
            // console.log("expected:", expected.toFixed(6), "actual JS :", actualJS.toFixed(6));

            if (duoTest) {
              const actualSOL = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(990), 50 * SEC_IN_DAY, tokens(0.40), Math.round(0.05 * 10_000))).toString() / 1e18;
              const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
              assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
              // console.log("expected:", expected.toFixed(6), "actual SOL:", actualSOL.toFixed(6));
            }
          });

          it("gets a single call price: debug", async function () {
            const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

            const expected = bs.blackScholes(1000, 901.9375000000001, 144 / SEC_IN_YEAR, 0.01, 0, "call");

            const actualJS = blackScholesJS.getCallOptionPrice(1000, 901.9375000000001, 144, 0.01, 0);
            // console.log("expected:", expected, "actual JS :", actualJS);

            if (duoTest) {
              const actualSOL = await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(901.9375000000001), 145, tokens(0.01), 0);
              // console.log("expected:", expected, "actual SOL:", actualSOL.toString() / 1e18);
            }
          });
        });


        describe("random tests", function () {
          it("gets multiple call prices: random " + (fastTest ? "FAST" : "SLOW"), async function () {
            const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 20 : 600, false);
            const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 20 : 600, true);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000094, !fastTest);
          });
        });

        describe("limit tests", function () {
          it("gets multiple call prices: $200 - $900, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, 0.000023, false);
          });

          it("gets multiple call prices: $900 - $990, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, 0.000014, false);
          });

          it("gets multiple call prices: $990 - $1010, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, 0.000021, false);
          });

          it("gets multiple call prices: $1010 - $1100, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, 0.000015, false);
          });

          it("gets multiple call prices: $1100 - $1300, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, 0.000015, false);
          });

          it("gets multiple call prices: $1300 - $2000, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, 0.000018, false);
          });

          it("gets multiple call prices: $2000 - $5000, limit time and vol %", async function () {
            const strikes1 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(0, 10);
            const strikes2 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(-10);
            const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
            const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
            await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], true, 0.000016, false);
          });
        });

        !fastTest && describe("multiple call options - 16x16 per cell", function () {
          it("gets multiple call prices: $200 - $900, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 20 && value <= 90);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 500);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000052);
          });

          it("gets multiple call prices: $900 - $990, 1s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 90 && value <= 99);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 500);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000073);
          });

          it("gets multiple call prices: $990 - $1010, 500s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 99 && value <= 101);
            const timeSubArray = testTimePoints.filter(value => value >= 900);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000072); // todo [0.01, VOL_FIXED, 1.92]
          });

          it("gets multiple call prices: $1010 - $1100, 240s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 101 && value <= 110);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 500);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000075);
          });

          it("gets multiple call prices: $1100 - $1300, 240s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 110 && value <= 130);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 500);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000092);
          });

          it("gets multiple call prices: $1300 - $2000, 240s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 130 && value <= 200);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 500);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000091);
          });

          it("gets multiple call prices: $2000 - $5000, 240s - 2y, 12%", async function () {
            const strikeSubArray = testStrikePoints.filter(value => value >= 200 && value < 500);
            const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 500);
            await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000066);
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

          const expected = bs.blackScholes(1000, 1070, 60 / 365, 0.60, 0.05, "put");

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

          const expected = bs.blackScholes(1000, 1010, 0.05 / 365, 0.40, 0.05, "put");

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

          const expected = bs.blackScholes(1000, 990, 50 / 365, 0.40, 0.05, "put");

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

          const expected = bs.blackScholes(1000, 901.9375000000001, 144 / SEC_IN_YEAR, 0.01, 0, "put");

          const actualJS = blackScholesJS.getPutOptionPrice(1000, 901.9375000000001, 144, 0.01, 0);
          // console.log("expected:", expected, "actual JS :", actualJS);

          if (duoTest) {
            const actualSOL = await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(901.9375000000001), 145, tokens(0.01), 0);
            // console.log("expected:", expected, "actual SOL:", actualSOL.toString() / 1e18);
          }
        });
      });

      describe("random tests", function () {
        it("gets multiple put prices: random " + (fastTest ? "FAST" : "SLOW"), async function () {
          const strikeSubArray = generateRandomTestPoints(20, 500, fastTest ? 20 : 600, false);
          const timeSubArray = generateRandomTestPoints(500, 2 * SEC_IN_YEAR, fastTest ? 20 : 600, true);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], false, 0.000110, !fastTest);
        });
      });

      describe("limit tests", function () {
        it("gets multiple put prices: $200 - $900, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 20 && value <= 90)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, 0.000023, false);
        });

        it("gets multiple put prices: $900 - $990, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 90 && value <= 99)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, 0.000014, false);
        });

        it("gets multiple put prices: $990 - $1010, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 99 && value <= 101)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, 0.000021, false);
        });

        it("gets multiple put prices: $1010 - $1100, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 101 && value <= 110)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, 0.000015, false);
        });

        it("gets multiple put prices: $1100 - $1300, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 110 && value <= 130)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, 0.000015, false);
        });

        it("gets multiple put prices: $1300 - $2000, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 130 && value <= 200)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, 0.000018, false);
        });

        it("gets multiple put prices: $2000 - $5000, limit time and vol %", async function () {
          const strikes1 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(0, 10);
          const strikes2 = (testStrikePoints.filter(value => value >= 200 && value <= 500)).slice(-10);
          const times1 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(0, 10);
          const times2 = testTimePoints.filter(value => value <= 2 * SEC_IN_YEAR).slice(-10);
          await testOptionRange([...strikes1, ...strikes2], [...times1, ...times2], [0.01, 1.92], false, 0.000016, false);
        });
      });

      !fastTest && describe("multiple put options - 16x16 per cell", function () {
        it("gets multiple put prices: $200 - $900, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 20 && value <= 90);
          const timeSubArray = testTimePoints.filter(value => value >= 1 && value <= 200);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000052);
        });

        it("gets multiple put prices: $900 - $990, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 90 && value <= 99);
          const timeSubArray = testTimePoints.filter(value => value >= 145);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000073);
        });

        it("gets multiple put prices: $990 - $1010, 500s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 99 && value <= 101);
          const timeSubArray = testTimePoints.filter(value => value >= 900);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000072); // todo [0.01, VOL_FIXED, 1.92]
        });

        it("gets multiple put prices: $1010 - $1100, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 101 && value <= 110);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000075);
        });

        it("gets multiple put prices: $1100 - $1300, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 110 && value <= 130);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000092);
        });

        it("gets multiple put prices: $1300 - $2000, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 130 && value <= 200);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000091);
        });

        it("gets multiple put prices: $2000 - $5000, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 200 && value < 500);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          await testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000066);
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
        const actualJS = blackScholesJS.getIndexFromTime(time);

        const actualSOL = await blackScholesPOC.getIndexFromTime(time);

        // check index against log2, which we don't have in JS
        const major = Math.floor(Math.log2(time));
        const minor = Math.floor((time - 2 ** major) / 2 ** (major - 3));
        const expected = major * 10 + minor;
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
        assert.equal(await blackScholesPOC.getIndexFromTime(0), 0);
        assert.equal(await blackScholesPOC.getIndexFromTime(1), 1);
        assert.equal(await blackScholesPOC.getIndexFromTime(2), 2);
        assert.equal(await blackScholesPOC.getIndexFromTime(3), 3);
        assert.equal(await blackScholesPOC.getIndexFromTime(4), 4);
        assert.equal(await blackScholesPOC.getIndexFromTime(5), 5);
        assert.equal(await blackScholesPOC.getIndexFromTime(6), 6);
        assert.equal(await blackScholesPOC.getIndexFromTime(7), 7);
      });

      it("calculates index for time [2^3, 2^16)", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        let count = 0;
        let step = fastTest ? 32 : 1;
        for (let time = 8; time < 2 ** 16; time += step) {
          const { actualJS, actualSOL, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actualJS, expected);
          assert.equal(actualSOL, expected);
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
          assert.equal(actualSOL, expected);
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
          assert.equal(actualSOL, expected);
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
          assert.equal(actualSOL, expected);
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
            const actualSOL = (await blackScholesPOC.getIndexAndWeightFromStrike(tokens(testStrikePoints[i]))).index;

            assert.equal(actualJS, actualSOL);
          }
        });
      });

      describe("specific values", function () {
        async function testSpecificValue(index, strike, blackScholesPOC) {
          assert.equal(index * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexAndWeightFromStrike(strike).strikeIndex);
          assert.equal(index * STRIKE_INDEX_MULTIPLIER, (await blackScholesPOC.getIndexAndWeightFromStrike(tokens(strike))).index);
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
