
import { assert } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, STRIKE_INDEX_MULTIPLIER, STRIKE_MAX, STRIKE_MIN } from "./BlackScholesJS.mjs";
import { generateLookupTable, generateStrikePoints, generateTimePoints } from "./generateLookupTable.mjs";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { promises as fs } from "fs";

const csvConfig = mkConfig({ useKeysAsHeaders: true, showColumnHeaders: false, useBom: false });

const SEC_IN_HOUR = 60 * 60;
const SEC_IN_DAY = 24 * 60 * 60;
const SEC_IN_YEAR = 365 * 24 * 60 * 60;


// await generateLookupTable(new BlackScholesJS(), true);

describe("BlackScholesJS", function () {
  let blackScholesJS;
  let testTimePoints;
  let testStrikePoints;

  function findMinAndMax(map) {
    // Initialize min and max objects with Infinity and -Infinity respectively
    const result = {
        min: { a1: Infinity, b1: Infinity, a3: Infinity, b3: Infinity, a4: Infinity, b4: Infinity },
        max: { a1: -Infinity, b1: -Infinity, a3: -Infinity, b3: -Infinity, a4: -Infinity, b4: -Infinity },
        absMin: { a1: Infinity, b1: Infinity, a3: Infinity, b3: Infinity, a4: Infinity, b4: Infinity }

    };

    // Iterate over the map
    map.forEach(obj => {
        // Update min and max for each key
        for (const key of Object.keys(result.min)) {
            if (obj[key] !== undefined) {
                result.min[key] = Math.min(result.min[key], obj[key]);
                result.max[key] = Math.max(result.max[key], obj[key]);
                if (Math.abs(obj[key]) > 0) {
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
    for (let i = 60; i < 128; i++) { // from 1 seconds
      testTimePoints.push(i);
    }

    for (let i = 0; i < timePoints.length - 1; i++) {
      const cellDeltaTime = timePoints[i + 1] - timePoints[i];
      if (cellDeltaTime >= 16) {
        const step = cellDeltaTime / 16;
        for (let j = 0; j < 16; j++) {
          if (timePoints[i] + j * step < 4 * SEC_IN_YEAR) { // up to 4 years = 1 year and 200% vol
            testTimePoints.push(Math.round(timePoints[i] + j * step));
          }
        }
      }
    }

    console.log("timePoints.length", timePoints.length, "testTimePoints.length", testTimePoints.length);
    // console.log("testTimePoints", testTimePoints);
  
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

  // before all tests, called once
  before(async () => {
    testTimePoints = generateTestTimePoints();
    testStrikePoints = generateTestStrikePoints(new BlackScholesJS(), STRIKE_MIN, STRIKE_MAX);
    const { lookupTable, rows } = await generateLookupTable(new BlackScholesJS(), true);
    blackScholesJS = new BlackScholesJS(lookupTable);

    // profile factors
    let count = 0;
    for (let [key, value] of lookupTable) {
      //console.log(key + " is ", value);
      count++;
    }
    console.log("lookupTable size: ", count);

    const result = findMinAndMax(lookupTable);
    console.log("min: ", result.min);
    console.log("max: ", result.max);
    console.log("absMin: ", result.absMin);
  });

  describe("functionality", async function () {
    /*it("record lookup table to csv file", async function ()  {
      const filename = `${csvConfig.filename}.csv`;
      fs.open(filename, "w");

      console.log("lookupTable");
      for (let i = 0; i < blackScholesJS.lookupTable.length; i++) //nemoze mora da se indekxima vadi napolje
        for (let j = 0; j < blackScholesJS.lookupTable[i].length; j++){ //blackScholesJS.lookupTable[i].length
          console.log(`Value at [${i}][${j}] is: ${blackScholesJS.lookupTable[i][j]}`);
          var range = blackScholesJS.lookupTable[i][j];
          var csvRange = [{
            optionPriceAA: range.optionPriceAA,
            optionPriceAB: range.optionPriceAB,
            optionPriceBA: range.optionPriceBA,
            optionPriceBB: range.optionPriceBB,
            ssratioati : range.ssratioati,
            exdays : range.exdays,
            i : i,
            j : j
          }];
          var csv = generateCsv(csvConfig)(csvRange);
          fs.appendFile(filename, csv);    

        }  
    });*/

    describe("getFuturePrice", function () {
      function getFuturePrice(spot, timeToExpirySec, rate) {
        // future = spot * e^(rT)
        const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
        const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
        return futurePrice;
      }

      it("calculates future price for lowest time and rate", async function () {
        const expected = getFuturePrice(100, 1, 0.0001);
        const actual = blackScholesJS.getFuturePrice(100, 1, 1);
        const error = (Math.abs(actual - expected) / expected * 100);
        //console.log("Worst case: error:", error.toFixed(12) + "%, rate, ", "actual: " + actual.toFixed(12), "expected: " + expected.toFixed(12));
        assert.isBelow(error, 0.0001); // is below 0.0001%
      });

      it("calculates future price [0s, 10m]", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.001; rate += 0.0001) {
          for (let secs = 0; secs <= 600; secs += 1) {
            const expected = getFuturePrice(100, secs, rate);
            const actual = blackScholesJS.getFuturePrice(100, secs, rate);
            const error = (Math.abs(actual - expected) / expected * 100);
            totalError += error;
            count++;
            if (maxError < error) {
              maxError = error;
              maxErrorParams = {
                rate, secs, actual, expected
              }
            }
          }
        }
        if (maxErrorParams) {
          const { rate, secs, actual, expected } = maxErrorParams;
          console.log("Worst case: error:", maxError.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
        }

        assert.isBelow(maxError, 0.0001); // is below 0.0001%
      });

      it("calculates future price [10m, 1d]", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.5; rate += 0.05) {
          for (let secs = 600; secs <= 1440 * 60; secs += 120) {
            const expected = getFuturePrice(100, secs, rate);
            const actual = blackScholesJS.getFuturePrice(100, secs, rate);
            const error = (Math.abs(actual - expected) / expected * 100);
            totalError += error;
            count++;
            if (maxError < error) {
              maxError = error;
              maxErrorParams = {
                rate, secs, actual, expected
              }
            }
          }
        }
        if (maxErrorParams) {
          const { rate, secs, actual, expected } = maxErrorParams;
          console.log("Worst case: error:", maxError.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
        }
        assert.isBelow(maxError, 0.0001); // is below 0.0001%
      });

      it("calculates future price [1d, 730d]", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.1; rate += 0.01) {
          for (let days = 1; days <= 2 * 365; days += 1) {
            const expected = getFuturePrice(100, days * SEC_IN_DAY, rate);
            const actual = blackScholesJS.getFuturePrice(100, days * SEC_IN_DAY, rate);            
            const error = (Math.abs(actual - expected) / expected * 100);
            totalError += error;
            count++;
            if (maxError < error) {
              maxError = error;
              maxErrorParams = {
                rate, days, actual, expected
              }
            }
          }
        }
        if (maxErrorParams) {
          const { rate, days, actual, expected } = maxErrorParams;
          console.log("Worst case: error:", maxError.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", days.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
        }
        assert.isBelow(maxError, 0.0001); // is below 0.0001%
      });
    });

    describe.only("getCallOptionPrice", function () {

      function testRange(strikePoints, timePoints, volPoints, allowedAbsError = 0.000114, multi = 10) {
        // NSV = non small values, we don't care about error below $0.001
        let maxRelError = 0, maxAbsError = 0, totalErrorNSV = 0, countNSV = 0, count = 0;
        let maxRelErrorParams = null, maxAbsErrorParams = null;
        const totalPoints = strikePoints.length * timePoints.length * volPoints.length;
        for (let strike of strikePoints) {
          for(let exp of timePoints) {
            for (let vol of volPoints) {
              for (let rate = 0; rate < 0.01; rate += 0.02) {
                const expected = Math.max(0, bs.blackScholes(100 * multi, strike * multi, exp / SEC_IN_YEAR, vol, rate, "call"));
                const actual = blackScholesJS.getCallOptionPrice(100 * multi, strike * multi, exp, vol, rate); // todo: multiplier helps lower worst case  * 1.000004;

                const error = expected !== 0 ? (Math.abs(actual - expected) / expected * 100) : 0;
                count++;

                // we don't care about small values
                if (expected > 0.001) {
                  totalErrorNSV += error;
                  countNSV++;
                }
                // relative error is in percentage
                if (maxRelError < error && expected > 0.001) {
                  maxRelError = error;
                  maxRelErrorParams = {
                    exp, strike: strike * multi, vol, rate, actual, expected
                  }
                }

                // absolute error is in currency
                const absError = Math.abs(actual - expected);
                if (maxAbsError < absError) {
                  maxAbsError = absError;
                  // console.log("maxAbsError", maxAbsError, "strike", strike * multi)
                  maxAbsErrorParams = {
                    exp, strike: strike * multi, vol, rate, actual, expected
                  }
                }

                // print progress
                if (count % Math.round(totalPoints / 20) === 0) {
                  console.log("Progress:", (count / totalPoints * 100).toFixed(0) + "%, Max abs error:", "$" + (maxAbsError ? maxAbsError.toFixed(6) : "0"));
                }
              }
            }
          }
        }

        const avgError = totalErrorNSV / countNSV;
        console.log("totalError NSV: " + totalErrorNSV, "count NonSmallValue (NSV): " + countNSV);

        // console.log("Total tests: " + count);
        // console.log("Table (map) size: ", blackScholesJS.lookupTable.size);
        console.log("Avg rel NSV error: " + avgError.toFixed(6) + "%,", "Max rel NSV error: " + maxRelError.toFixed(6) + "%,", "Max abs error:", "$" + maxAbsError.toFixed(6) + ",", "Total tests: ", count, "Total NSV tests: ", countNSV, "NSV/total ratio: ", ((countNSV / count) * 100).toFixed(2) + "%");
        console.log("Max rel error params: ", maxRelErrorParams);
        console.log("Max abs error params: ", maxAbsErrorParams, convertSeconds(maxAbsErrorParams ? maxAbsErrorParams.exp : 1));

        assert.isBelow(maxAbsError, allowedAbsError); // max error is below max allowed absolute error
      }

      describe("random tests", function () {

        function generateRandomTestStrikePoints(startPoint, endPoint, count) {
          const testStrikePoints = [];
          for (let i = 0; i < count; i++) {
            const strikePoint = Math.random() * (endPoint - startPoint) + startPoint;
            testStrikePoints.push(strikePoint);
          }
        
          return testStrikePoints;
        }


        it("gets multiple call prices: random", async function () {
          const strikeSubArray = generateRandomTestStrikePoints(99, 101, 2000);
          testRange(strikeSubArray, testTimePoints, [1], 0.000114);
        });
      });

    
      it("gets multiple call prices: one specific max error", async function () {
        const strikeSubArray = [100.0125];
        const timeSubArray = [1];
        testRange(strikeSubArray, timeSubArray, [1.1]);
      });

      it("gets multiple call prices: $200 - $900, 60s - 4y, 100%", async function () {
        const strikeSubArray = testStrikePoints.filter(value => value >= 20 && value <= 90);
        testRange(strikeSubArray, testTimePoints, [1], 0.000045);
      });

      it("gets multiple call prices: $900 - $990, 60s - 4y, 100%", async function () {
        const strikeSubArray = testStrikePoints.filter(value => value >= 90 && value <= 99);
        testRange(strikeSubArray, testTimePoints, [1], 0.000047);
      });

      it("gets multiple call prices: $990 - $1010, 60s - 4y, 100%", async function () {
        const strikeSubArray = testStrikePoints.filter(value => value >= 99 && value <= 101);
        testRange(strikeSubArray, testTimePoints, [1], 0.000050);
      });

      it("gets multiple call prices: $1010 - $1100, 60s - 4y, 100%", async function () {
        const strikeSubArray = testStrikePoints.filter(value => value >= 101 && value <= 110);
        testRange(strikeSubArray, testTimePoints, [1], 0.000048);
      });

      it("gets multiple call prices: $1100 - $1300, 60s - 4y, 100%", async function () {
        const strikeSubArray = testStrikePoints.filter(value => value >= 110 && value <= 130);
        testRange(strikeSubArray, testTimePoints, [1], 0.000060);
      });

      it("gets multiple call prices: $1300 - $2000, 60s - 4y, 100%", async function () {
        const strikeSubArray = testStrikePoints.filter(value => value >= 130 && value <= 200);
        testRange(strikeSubArray, testTimePoints, [1], 0.000061);
      });

      it("gets multiple call prices: $2000 - $5000, 60s - 4y, 100%", async function () {
        const strikeSubArray = testStrikePoints.filter(value => value >= 200 && value <= 500);
        testRange(strikeSubArray, testTimePoints, [1], 0.000062);
      });

      it("gets a single call price", async function () {
        const expectedOptionPrice = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "call");
        const actualOptionPrice = blackScholesJS.getCallOptionPrice(1000, 930, 60 * SEC_IN_DAY, 0.60, 0.05);

        console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
      });

      it("gets multiple call prices - best case strike", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for(let exp = 50; exp < 80; exp += 1) {
          for (let vol = 0.8; vol < 1.2; vol += 0.01) {
            let expected = bs.blackScholes(1000, 1000, exp / 365, vol, 0, "call");
            let actual = blackScholesJS.getCallOptionPrice(1000, 1000, exp * SEC_IN_DAY, vol, 0);

            let error = (Math.abs(actual - expected) / expected * 100);
            totalError += error;
            count++;
            if (maxError < error && expected > 0.01) {
              maxError = error;
              maxErrorParams = {
                exp, vol, actual, expected
              }
            }
          }
        }

        const avgError = totalError / count;

        console.log("Total tests: " + count);
        console.log("Table (map) size: ", blackScholesJS.lookupTable.size);
        console.log("Avg error: " + (avgError).toFixed(8) + "%");
        console.log("Max error: " + maxError.toFixed(8) + "%");
        console.log("Max error params: ", maxErrorParams);

        assert.isBelow(avgError, 0.00012); // avg error is below 0.025%
        assert.isBelow(maxError, 0.00066); // max error is below 0.025%
      });

      it("gets call price - worst error, best strike", async function () {
        const exp = 52;
        const vol = 0.8;

        let expected = bs.blackScholes(1000, 1000, exp / 365, vol, 0, "call");
        let actual = blackScholesJS.getCallOptionPrice(1000, 1000, exp * SEC_IN_DAY, vol, 0);

        let error = (Math.abs(actual - expected) / expected * 100);

        console.log("expected", expected, "actual", actual);
        console.log("Table (map) size: ", blackScholesJS.lookupTable.size);
        console.log("Error: " + (error).toFixed(8) + "%");
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
      it("calculates index for strike [50, 200]", async function () {
        let count = 0;
        for (let strike = 50; strike <= 200; strike += 1) {
          const expected = Math.floor(strike / STRIKE_STEP) * STRIKE_STEP;
          const actual = blackScholesJS.getIndexFromStrike(strike);
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });

      it("calculates index for specific strikes", async function () {
        const actual1 = blackScholesJS.getIndexFromStrike(99.9999);
        assert.equal(actual1, 100 - STRIKE_STEP);

        const actual2 = blackScholesJS.getIndexFromStrike(100 - 1e-6);
        assert.equal(actual2, 100 - STRIKE_STEP);

        const actual3 = blackScholesJS.getIndexFromStrike(100 - 1e-8);
        assert.equal(actual3, 100 - STRIKE_STEP);

        // this is where it rounds up to 100
        const actual4 = blackScholesJS.getIndexFromStrike(100 - 1e-9);
        assert.equal(actual4, 100);
      });
    });

    describe.only("getIndexFromStrike", function () {
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
        assert.equal(105 * STRIKE_INDEX_MULTIPLIER, blackScholesJS.getIndexFromStrike(105.1));
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
