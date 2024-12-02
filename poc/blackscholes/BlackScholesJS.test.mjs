
import { assert } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, STRIKE_STEP } from "./BlackScholesJS.mjs";
import { generateLookupTable } from "./generateLookupTable.mjs";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { promises as fs } from "fs";

const csvConfig = mkConfig({ useKeysAsHeaders: true, showColumnHeaders: false, useBom: false });

const SEC_IN_HOUR = 60 * 60;
const SEC_IN_DAY = 24 * 60 * 60;
const SEC_IN_YEAR = 365 * 24 * 60 * 60;


// await generateLookupTable(new BlackScholesJS(), true);

describe("BlackScholesJS", function () {
  let blackScholesJS;

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

  // before all tests, called once
  before(async () => {
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
    // it("record lookup table to csv file", async function ()  {
    //   await generateLookupTable(new BlackScholesJS(),true);
    // });
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

    describe("getCallOptionPrice", function () {

      function testRange(setup) {
        let maxRelError = 0, maxAbsError = 0, totalError = 0, count = 0, maxRelErrorParams = null, maxAbsErrorParams = null;
        for(let exp = setup.exp.min; exp < setup.exp.max; exp += setup.exp.step) {
          for (let strike = setup.strike.min; strike < setup.strike.max; strike += setup.strike.step) {
            for (let vol = setup.vol.min; vol < setup.vol.max; vol += setup.vol.step) {
              for (let rate = 0; rate < 0.01; rate += 0.02) {
                const expected = Math.max(0, bs.blackScholes(1000 * 1, strike * 1, exp / SEC_IN_YEAR, vol, rate, "call"));
                const actual = blackScholesJS.getCallOptionPrice(1000 * 1, strike * 1, exp, vol, rate); // todo: multiplier helps lower worst case  * 1.000004;

                const error = expected !== 0 ? (Math.abs(actual - expected) / expected * 100) : 0;
                if (strike === 1030 && exp === 3600 && vol === 0.88) {
                  console.log("err:", error.toFixed(6) + "%", "exp:", expected.toFixed(6), "act:", actual.toFixed(6), "strike:", strike, "exp:", exp, "vol:", vol);
                }
                totalError += error;
                count++;
                // relative error is in percentage
                if (maxRelError < error && expected > 0.001) {
                  maxRelError = error;
                  maxRelErrorParams = {
                    exp, strike, vol, rate, actual, expected
                  }
                }

                // absolute error is in currency
                const absError = Math.abs(actual - expected);
                if (maxAbsError < absError) {
                  maxAbsError = absError;
                  maxAbsErrorParams = {
                    exp, strike, vol, rate, actual, expected
                  }
                }
              }
            }
          }
        }

        const avgError = totalError / count;
        console.log("totalError: " + totalError, "count: " + count);

        // console.log("Total tests: " + count);
        // console.log("Table (map) size: ", blackScholesJS.lookupTable.size);
        console.log("Avg rel error: " + avgError.toFixed(6) + "%,", "Max rel error: " + maxRelError.toFixed(6) + "%,", "Max abs error:", "$" + maxAbsError.toFixed(6) + ",", "tests: ", count);
        console.log("Max rel error params: ", maxRelErrorParams);
        console.log("Max abs error params: ", maxAbsErrorParams, convertSeconds(maxAbsErrorParams.exp));
      }

      // todo: to delete
      it.only("gets multiple call prices - specific negative case", async function () {
        const setup = { exp: { min: 1278720, max: 1278721, step: SEC_IN_HOUR }, strike: { min: 1010, max: 1011, step: 10 }, vol: { min: 0.96, max: 0.97, step: 0.1 }}
        testRange(setup);
      });

      it.only("gets multiple call prices - [1h, 24h)", async function () {
        const setup = { exp: { min: SEC_IN_HOUR, max: 24 * SEC_IN_HOUR, step: SEC_IN_HOUR / 40 }, strike: { min: 800, max: 1200, step: 10 }, vol: { min: 0.8, max: 1.2, step: 0.08 }}
        testRange(setup);
      });

      it.only("gets multiple call prices - [1d, 30d)", async function () {
        const setup = { exp: { min: SEC_IN_DAY, max: 30 * SEC_IN_DAY, step: SEC_IN_DAY / 40 }, strike: { min: 800, max: 1200, step: 10 }, vol: { min: 0.8, max: 1.2, step: 0.08 }}
        testRange(setup);
      });

      it.only("gets multiple call prices - [30d, 365d)", async function () {
        const setup = { exp: { min: 30 * SEC_IN_DAY, max: 365 * SEC_IN_DAY, step: SEC_IN_DAY / 4 }, strike: { min: 800, max: 1200, step: 10 }, vol: { min: 0.8, max: 1.2, step: 0.08 }}
        testRange(setup);
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

      it("gets multiple call prices", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for(let exp = 50; exp < 80; exp += 1) {
          for (let strike = 210; strike < 4900; strike += 10) {
            for (let vol = 0.8; vol < 1.2; vol += 0.08) {
              for (let rate = 0; rate < 0.01; rate += 0.02) {
                const expected = bs.blackScholes(1000, strike, exp / 365, vol, rate, "call");
                const actual = blackScholesJS.getCallOptionPrice(1000, strike, exp * SEC_IN_DAY, vol, rate); // todo: multiplier helps lower worst case  * 1.000004;

                const error = (Math.abs(actual - expected) / expected * 100);
                totalError += error;
                count++;
                if (maxError < error && expected > 0.99) {
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

        assert.isBelow(avgError, 0.00068); // avg error is below 0.00068%
        assert.isBelow(maxError, 0.0053); // max error is below 0.0053%
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
  });
});
