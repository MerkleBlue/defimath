
import { assert } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, S_S_RATIO_STEP } from "./BlackScholesJS.mjs";
import { generateLookupTable } from "./generateLookupTable.mjs";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { promises as fs } from "fs";

const csvConfig = mkConfig({ useKeysAsHeaders: true, showColumnHeaders: false, useBom: false });

const SECONDS_IN_DAY = 24 * 60 * 60;

describe("BlackScholesJS", function () {
  // before each test
  beforeEach(() => {
    const { lookupTable } = generateLookupTable(new BlackScholesJS());
    blackScholesJS = new BlackScholesJS(lookupTable);
  });

  let blackScholesJS;

  describe("functionality", function () {

    it("record lookup table to csv file", async function ()  {
      const filename = `${csvConfig.filename}.csv`;
      fs.open(filename, "w");

      console.log("lookupTable");
      for (let i = 0; i < blackScholesJS.lookupTable.length; i++) //blackScholesJS.lookupTable.length
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
    });

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
        console.log("Worst case: error:", error.toFixed(12) + "%, rate, ", "actual: " + actual.toFixed(12), "expected: " + expected.toFixed(12));
        assert.isBelow(error, 0.0001); // is below 0.0001%
      });

      it("calculates future price [0s, 10m]", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.001; rate += 0.0001) {
          for (let secs = 0; secs <= 600; secs += 1) {
            const expected = getFuturePrice(100, secs, rate);
            const actual = blackScholesJS.getFuturePrice(100, secs, rate);
            const error = (Math.abs(actual - expected) / expected * 100);
            // console.log("expected:", expected.toFixed(6), "actual:", actual.toFixed(6), "error:", error.toFixed(4), "%");
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
        const { rate, secs, actual, expected } = maxErrorParams;
        console.log("Worst case: error:", maxError.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
        assert.isBelow(maxError, 0.0001); // is below 0.0001%
      });

      it("calculates future price [10m, 1d]", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.5; rate += 0.05) {
          for (let secs = 600; secs <= 1440 * 60; secs += 120) {
            const expected = getFuturePrice(100, secs, rate);
            const actual = blackScholesJS.getFuturePrice(100, secs, rate);
            const error = (Math.abs(actual - expected) / expected * 100);
            // console.log("expected:", expected.toFixed(6), "actual:", actual.toFixed(6), "error:", error.toFixed(4), "%");
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
        const { rate, secs, actual, expected } = maxErrorParams;
        console.log("Worst case: error:", maxError.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", secs.toFixed(0) + "s", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
        assert.isBelow(maxError, 0.0001); // is below 0.0001%
      });

      it("calculates future price [1d, 730d]", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.1; rate += 0.01) {
          for (let days = 1; days <= 2 * 365; days += 1) {
            const expected = getFuturePrice(100, days * SECONDS_IN_DAY, rate);
            const actual = blackScholesJS.getFuturePrice(100, days * SECONDS_IN_DAY, rate);            
            const error = (Math.abs(actual - expected) / expected * 100);
            // console.log("expected:", expected.toFixed(4), "actual:", actual.toFixed(4), "error:", error.toFixed(4), "%");
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
        const { rate, days, actual, expected } = maxErrorParams;
        console.log("Worst case: error:", maxError.toFixed(8) + "%, rate, ", rate.toFixed(3), "expiration:", days.toFixed(0) + "d", "actual: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
        assert.isBelow(maxError, 0.0001); // is below 0.0001%
      });
    });

    describe("getCallOptionPrice", function () {
      it("gets call price", async function () {
        let expectedOptionPrice = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "call");
        let actualOptionPrice = blackScholesJS.getCallOptionPrice(1000, 930, 60 * SECONDS_IN_DAY, 0.60, 0.05);

        console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
      });

      it("gets multiple call prices", async function () {
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for(let exp = 50; exp < 80; exp += 1) {
          for (let strike = 850; strike < 1100; strike += 10) {
            for (let vol = 0.8; vol < 1.2; vol += 0.08) {
              for (let rate = 0; rate < 0.05; rate += 0.02) {
                // console.log("exp:", exp, "strike:", strike, "vol:", vol, "rate:", rate);
                let expected = bs.blackScholes(1000, strike, exp / 365, vol, rate, "call");
                let actual = blackScholesJS.getCallOptionPrice(1000, strike, exp * SECONDS_IN_DAY, vol, rate);

                let error = (Math.abs(actual - expected) / expected * 100);
                // console.log("expected:", expected.toFixed(4), "actual:", actual.toFixed(4), "error:", error.toFixed(4), "%");
                totalError += error;
                count++;
                if (maxError < error && expected > 0.01) {
                  maxError = error;
                  // console.log(exp.toFixed(6), strike.toFixed(2), vol.toFixed(2), maxError.toFixed(2) + "%", "act: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
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
        console.log("Avg error: " + (avgError).toFixed(8) + "%");
        console.log("Max error: " + maxError.toFixed(8) + "%");
        console.log("Max error params: ", maxErrorParams);

        assert.isBelow(avgError, 0.025); // avg error is below 0.025%
        assert.isBelow(maxError, 0.25); // max error is below 0.025%
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

    describe("getIndexFromSpotStrikeRatio", function () {
      it("calculates index for ratio [0.5, 2]", async function () {
        let count = 0;
        for (let index = 50; index <= 200; index += 1) {
          const ratio = index / 100;
          const indexStep = Math.round(S_S_RATIO_STEP * 100);
          const actual = blackScholesJS.getIndexFromSpotStrikeRatio(ratio);
          const expected = Math.floor(index / indexStep) * indexStep;
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });

      it("calculates index for specific ratios", async function () {
        const actual1 = blackScholesJS.getIndexFromSpotStrikeRatio(0.999999);
        assert.equal(actual1, 95);

        const actual2 = blackScholesJS.getIndexFromSpotStrikeRatio(1 - 1e-6);
        assert.equal(actual2, 95);

        const actual3 = blackScholesJS.getIndexFromSpotStrikeRatio(1 - 1e-9);
        assert.equal(actual3, 95);

        // this is where it rounds up to 100
        const actual4 = blackScholesJS.getIndexFromSpotStrikeRatio(1 - 1e-12);
        assert.equal(actual4, 100);
      });
    });
  });
});
