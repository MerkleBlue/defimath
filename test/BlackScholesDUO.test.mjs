
import { assert } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, STRIKE_INDEX_MULTIPLIER, STRIKE_MAX, STRIKE_MIN, VOL_FIXED } from "../poc/blackscholes/BlackScholesJS.mjs";
import { generateLookupTable, generateStrikePoints, generateTimePoints } from "../poc/blackscholes/generateLookupTable.mjs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import hre from "hardhat";

const SEC_IN_DAY = 24 * 60 * 60;
const SEC_IN_YEAR = 365 * 24 * 60 * 60;


const duoTest = true;

function tokens(value) {
  return hre.ethers.parseUnits(value.toString(), 18).toString();
}

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

    console.log("Initializing lookup table in contract...");
    let totalGas = 0;
    let indexArray = [], dataArray = [];
    for (const [key, value] of lookupTableSOL) {
      indexArray.push(key);
      dataArray.push(value);
      if (indexArray.length >= 100) {
        // todo: don't set 0 values, once tests for option price are done, it will lower gas cost, and speedup tests
        // console.log(value);
        // if (value === 0) {
        //   console.log("Skipping zero value at index", key);
        // } else {

        // }
        const gas = await blackScholesPOC.setLookupTableElements.estimateGas(indexArray, dataArray);
        totalGas += parseInt(gas);
        await blackScholesPOC.setLookupTableElements(indexArray, dataArray);
        indexArray = [];
        dataArray = [];
      }
    }

    console.log("Total gas spent:", Math.round(totalGas / 1e6), "M");

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
      if (key % 1000 < 144) {
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

    console.log("strikePoints.length", strikePoints.length, "testStrikePoints.length", testStrikePoints.length);
  
    return testStrikePoints;
  }

  function generateTestRatePoints() {
    const testRatePoints = [];
    for (let rate = 0; rate <= 0.2; rate += 0.005) { // up to 20%
      testRatePoints.push(rate);
    }
  
    return testRatePoints;
  }

  async function testOptionRange(strikePoints, timePoints, volPoints, isCall, allowedAbsError = 0.000114, multi = 10) {
    const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

    // NSV = non small values, we don't care about error below $0.001
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
              console.log("Progress:", (count / totalPoints * 100).toFixed(0) + "%, Max abs error:", "$" + (maxAbsErrorJS ? maxAbsErrorJS.toFixed(6) : "0"));
            }
          }
        }
      }
    }

    const avgError = totalErrorNSVJS / countNSV;
    console.log("totalError NSV: " + totalErrorNSVJS, "count NonSmallValue (NSV): " + countNSV);

    // console.log("Total tests: " + count);
    // console.log("Table (map) size: ", blackScholesJS.lookupTable.size);
    console.log("Avg rel NSV error: " + avgError.toFixed(6) + "%,", "Max rel NSV error: " + maxRelErrorJS.toFixed(6) + "%,", "Max abs error:", "$" + maxAbsErrorJS.toFixed(6) + ",", "Total tests: ", count, "Total NSV tests: ", countNSV, "NSV/total ratio: ", ((countNSV / count) * 100).toFixed(2) + "%");
    console.log("Max rel error params JS: ", maxRelErrorParamsJS);
    console.log("Max abs error params JS: ", maxAbsErrorParamsJS, convertSeconds(maxAbsErrorParamsJS ? maxAbsErrorParamsJS.exp : 1));
    console.log("Max rel error params SOL: ", maxRelErrorParamsSOL);
    console.log("Max abs error params SOL: ", maxAbsErrorParamsSOL, convertSeconds(maxAbsErrorParamsSOL ? maxAbsErrorParamsSOL.exp : 1));

    assert.isBelow(maxAbsErrorJS, allowedAbsError); // max error is below max allowed absolute error
    assert.isBelow(maxAbsErrorSOL, allowedAbsError); // max error is below max allowed absolute error
  }

  async function testFuturePriceRange(ratePoints, timePoints, allowedRelError = 0.00125) { // %0.00125
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
    if (maxErrorParamsJS) {
      const { rate, secs, actual, expected } = maxErrorParamsJS;
      console.log("Worst case error JS:", maxErrorJS.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
    }
    if (duoTest && maxErrorParamsSOL) {
      const { rate, secs, actual, expected } = maxErrorParamsSOL;
      console.log("Worst case error SOL:", maxErrorJS.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
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
    it("getCallOptionPrice gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for(let exp = 20; exp < 180; exp += 8) {
        for (let strike = 600; strike < 1400; strike += 80) {
          for (let vol = 0.8; vol < 1.2; vol += 0.08) {
            for (let rate = 0; rate < 0.05; rate += 0.02) {
              totalGas += parseInt(await blackScholesPOC.getCallOptionPrice.estimateGas(tokens(1000), tokens(strike), exp * SEC_IN_DAY, tokens(vol), Math.round(rate * 10_000))) - 21000;
              count++;
            }
          }
        }
      }
      console.log("Total tests: " + count);
      console.log("Gas spent [avg]:", Math.round(totalGas / count));
    });

    it("getPutOptionPrice gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for(let exp = 20; exp < 180; exp += 8) {
        for (let strike = 600; strike < 1400; strike += 80) {
          for (let vol = 0.8; vol < 1.2; vol += 0.08) {
            for (let rate = 0; rate < 0.05; rate += 0.02) {
              totalGas += parseInt(await blackScholesPOC.getPutOptionPrice.estimateGas(tokens(1000), tokens(strike), exp * SEC_IN_DAY, tokens(vol), Math.round(rate * 10_000))) - 21000;
              count++;
            }
          }
        }
      }
      console.log("Total tests: " + count);
      console.log("Gas spent [avg]:", Math.round(totalGas / count));
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
      console.log("Gas spent [avg]: ", parseInt(totalGas / count));
    });

    it("getFuturePrice gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for (let rate = 0; rate <= 0.1; rate += 0.01) {
        for (let days = 0; days <= 2 * 365; days += 1) {
          const gasUsed = await blackScholesPOC.getFuturePriceMeasureGas(tokens(100), days * SEC_IN_DAY, Math.round(rate * 10_000));
          totalGas += parseInt(gasUsed);
          count++;
        }
      }
      console.log("Gas spent [avg]: ", parseInt(totalGas / count));
    });

    it("test gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      const callPriceMap = await blackScholesPOC.measureGas();
      console.log(callPriceMap);
    });
  });

  describe("functionality", async function () {
    describe("getFuturePrice", function () {
      it("calculates future price for lowest time and rate", async function () {
        const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

        const expected = getFuturePrice(100, 1, 0.0001);
        const actualJS = blackScholesJS.getFuturePrice(100, 1, 1);
        const errorJS = (Math.abs(actualJS - expected) / expected * 100);
        console.log("Worst case JS: error:", errorJS.toFixed(12) + "%, rate, ", "actual: " + actualJS.toFixed(12), "expected: " + expected.toFixed(12));
        assert.isBelow(errorJS, 0.0001); // is below 0.0001%

        if (duoTest) {
          const actualSOL = (await blackScholesPOC.getFuturePrice(tokens(100), 1, 1)).toString() / 1e18;
          const errorSOL = (Math.abs(actualSOL - expected) / expected * 100);
          console.log("Worst case SOL: error:", errorSOL.toFixed(12) + "%, rate, ", "actual: " + actualSOL.toFixed(12), "expected: " + expected.toFixed(12));
          assert.isBelow(errorSOL, 0.0001); // is below 0.0001%
        }
      });

      it("calculates future price [0s, 10m]", async function () {
        const testRatePoints = generateTestRatePoints();
        const timeSubArray = testTimePoints.filter(value => value <= 600);
        await testFuturePriceRange(testRatePoints, timeSubArray, 0.0001);
      });

      it("calculates future price [10m, 1d]", async function () {
        const testRatePoints = generateTestRatePoints();
        const timeSubArray = testTimePoints.filter(value => value >= 600 && value <= SEC_IN_DAY);
        await testFuturePriceRange(testRatePoints, timeSubArray, 0.0001);
      });

      it("calculates future price [1d, 730d]", async function () {
        const testRatePoints = generateTestRatePoints();
        const timeSubArray = testTimePoints.filter(value => value >= SEC_IN_DAY && value <= 730 * SEC_IN_DAY);
        await testFuturePriceRange(testRatePoints, timeSubArray, 0.00125);
      });
    });

    describe("getCallOptionPrice", function () {
      describe("single option test", function () {
        it("gets a single call price", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          const expected = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "call");

          const actualJS = blackScholesJS.getCallOptionPrice(1000, 930, 60 * SEC_IN_DAY, 0.60, 0.05);
          console.log("expected:", expected, "actual JS :", actualJS);

          if (duoTest) {
            const actualSOL = await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 60 * SEC_IN_DAY, tokens(0.60), Math.round(0.05 * 10_000));
            console.log("expected:", expected, "actual SOL:", actualSOL.toString() / 1e18);
          }
        });

        it.only("gets a single call price: debug", async function () {
          const { blackScholesPOC } = duoTest ? await loadFixture(deploy) : { blackScholesPOC: null };

          const expected = bs.blackScholes(1000, 999.1822550426883, 54263808 / SEC_IN_YEAR, 0.12, 0, "call");

          const actualJS = blackScholesJS.getCallOptionPrice(1000, 999.1822550426883, 54263808, 0.12, 0);
          console.log("expected:", expected, "actual JS :", actualJS);

          if (duoTest) {
            const actualSOL = await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(999.1822550426883), 54263808, tokens(0.12), 0);
            console.log("expected:", expected, "actual SOL:", actualSOL.toString() / 1e18);
          }
        });
      });

      describe.only("random tests", function () {
        function generateRandomTestStrikePoints(startPoint, endPoint, count) {
          const testStrikePoints = [];
          for (let i = 0; i < count; i++) {
            const strikePoint = Math.random() * (endPoint - startPoint) + startPoint;
            testStrikePoints.push(strikePoint);
          }
        
          return testStrikePoints;
        }

        it("gets multiple call prices: random", async function () {
          const strikeSubArray = generateRandomTestStrikePoints(99, 101, 100);
          const timeSubArray = testTimePoints.filter(value => value >= 500);
          await testOptionRange(strikeSubArray, timeSubArray, [VOL_FIXED], true, 0.00062);
        });
      });

      describe("multiple call options - 16x16 per cell", function () {
        // it.only("gets multiple call prices: one specific max error", async function () {
        //   const strikeSubArray = [99.95625];
        //   const timeSubArray = [60];
        //   testRange(strikeSubArray, timeSubArray, [VOL_FIXED], true, 0.000001);
        // });

        it("gets multiple call prices: $200 - $900, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 20 && value <= 90);
          const timeSubArray = testTimePoints.filter(value => value >= 144);
          testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000067);
        });

        it("gets multiple call prices: $900 - $990, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 90 && value <= 99);
          const timeSubArray = testTimePoints.filter(value => value >= 144);
          testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000073);
        });

        it("gets multiple call prices: $990 - $1010, 500s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 99 && value <= 101);
          const timeSubArray = testTimePoints.filter(value => value >= 900);
          testOptionRange(strikeSubArray, timeSubArray, [VOL_FIXED, 1.92], true, 0.000072); // todo [0.01, VOL_FIXED, 1.92]
        });

        it("gets multiple call prices: $1010 - $1100, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 101 && value <= 110);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000075);
        });

        it("gets multiple call prices: $1100 - $1300, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 110 && value <= 130);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000092);
        });

        it("gets multiple call prices: $1300 - $2000, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 130 && value <= 200);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000091);
        });

        it("gets multiple call prices: $2000 - $5000, 240s - 2y, 12%", async function () {
          const strikeSubArray = testStrikePoints.filter(value => value >= 200 && value < 500);
          const timeSubArray = testTimePoints.filter(value => value >= 240);
          testOptionRange(strikeSubArray, timeSubArray, [0.01, VOL_FIXED, 1.92], true, 0.000066);
        });
      });

      describe("multiple call options - vol limit testing", function () {
        it("gets multiple call prices: vol 200%", async function () {
          testOptionRange(testStrikePoints, testTimePoints, [2], true, 0.000087);
        });

        it("gets multiple call prices: vol 1% - one specific", async function () {
          const strikeSubArray = [100.00625];
          const timeSubArray = [1000];
          testOptionRange(strikeSubArray, timeSubArray, [0.01], true, 0.000087);
        });

        it("gets multiple call prices: vol 1%", async function () {
          const timeSubArray = testTimePoints.filter(value => value >= 1000 && value <= 2000);
          testOptionRange(testStrikePoints, timeSubArray, [0.01], true, 0.000087);
        });
      });
    });

    describe("getPutOptionPrice", function () {
      it("gets a single put price", async function () {
        let expectedOptionPrice = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "put");
        let actualOptionPrice = blackScholesJS.getPutOptionPrice(1000, 930, 60 * SEC_IN_DAY, 0.60, 0.05);

        console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
      });

      it("gets multiple put prices", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for(let exp = 50; exp < 80; exp += 1) {
          for (let strike = 850; strike < 1100; strike += 10) {
            for (let vol = 0.8; vol < 1.2; vol += 0.08) {
              for (let rate = 0; rate < 0.05; rate += 0.02) {
                const expected = bs.blackScholes(1000, strike, exp / 365, vol, rate, "put");
                const actual = blackScholesJS.getPutOptionPrice(1000, strike, exp * SEC_IN_DAY, vol, rate);

                const error = (Math.abs(actual - expected) / expected * 100);
                totalError += error;
                count++;

                if (maxError < error && expected > 0.01) {
                  maxError = error;
                  maxErrorParams = {
                    exp, strike, vol, rate, actual, expected
                  }
                }
              }
            }
          }
        }

        const avgError = totalError / count;

        console.log("Total tests: " + count);
        console.log("Table (map) size: ", blackScholesJS.lookupTable.size);
        console.log("Error: avg: " + avgError.toFixed(6) + "%", "max: " + maxError.toFixed(6) + "%");
        console.log("Max error params: ", maxErrorParams);

        assert.isBelow(avgError, 0.0011); // avg error is below 0.0011%
        assert.isBelow(maxError, 0.02); // max error is below 0.02%
      });
    });

    describe("getIndexFromTime", function () {
      function getActualExpected(time) {
        const actual = blackScholesJS.getIndexFromTime(time);
        // check index against log2, which we don't have in JS
        const major = Math.floor(Math.log2(time));
        const minor = Math.floor((time - 2 ** major) / 2 ** (major - 3));
        const expected = major * 10 + minor;
        return { actual, expected };
      }

      it("calculates index for time [0, 2^3)", async function () {
        assert.equal(blackScholesJS.getIndexFromTime(0), 0);
        assert.equal(blackScholesJS.getIndexFromTime(1), 1);
        assert.equal(blackScholesJS.getIndexFromTime(2), 2);
        assert.equal(blackScholesJS.getIndexFromTime(3), 3);
        assert.equal(blackScholesJS.getIndexFromTime(4), 4);
        assert.equal(blackScholesJS.getIndexFromTime(5), 5);
        assert.equal(blackScholesJS.getIndexFromTime(6), 6);
        assert.equal(blackScholesJS.getIndexFromTime(7), 7);
      });

      it("calculates index for time [2^3, 2^16)", async function () {
        let count = 0;
        for (let time = 8; time < 2 ** 16; time++) {
          const { actual, expected } = getActualExpected(time);
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });


      it("calculates index for time [2^16, 2^24)", async function () {
        let count = 0;
        for (let time = 2 ** 16; time < 2 ** 24; time += 2 ** 8) {
          const { actual, expected } = getActualExpected(time);
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });

      it("calculates index for time [2^24, 2^32)", async function () {
        let count = 0;
        for (let time = 2 ** 24; time < 2 ** 32; time += 2 ** 16) {
          const { actual, expected } = getActualExpected(time);
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });
    });

    describe("getIndexFromStrike", function () {
      it("calculates index for strike [200, 500]", async function () {
        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(200));
        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(200.00001));
        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(201));
        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(203));
        assert.equal(204 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(204));
        assert.equal(204 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(205));
        assert.equal(260 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(260));
        assert.equal(260 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(261));
        assert.equal(496 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(499));
        assert.equal(496 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(499.9999));
      });

      it("calculates index for strike [120, 200)", async function () {
        assert.equal(120 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(120));
        assert.equal(120 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(120.00001));
        assert.equal(121 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(121));
        assert.equal(199 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(199));
        assert.equal(199 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(199.9999));
      });

      it("calculates index for strike [105, 120)", async function () {
        assert.equal(105 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(105));
        assert.equal(105.1 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(105.1));
        assert.equal(105.4 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(105.499999));
        assert.equal(105.5 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(105.5));
        assert.equal(105.5 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(105.500001));
        assert.equal(108.3 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(108.333333));
        assert.equal(108.6 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(108.666666));
        assert.equal(119.5 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(119.999999));
      });

      it("calculates index for strike [80, 105)", async function () {
        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(80));
        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(80.1));
        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(80.199999));
        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(80.2));
        assert.equal(99.95 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(99.999999));
        assert.equal(100 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(100.000001));
        assert.equal(104.9 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(104.999999));
      });
      // todo: start from 20, test each segment
    });
  });
});
