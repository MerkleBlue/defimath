
import { assert, expect } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, EXPIRATION_MAX, EXPIRATION_MIN, EXPIRATION_STEP, S_S_RATIO_MAX, S_S_RATIO_MIN, S_S_RATIO_STEP } from "./BlackScholesJS.mjs";
import { generateLookupTable } from "./generateLookupTable.mjs";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { promises as fs } from "fs";

const csvConfig = mkConfig({ useKeysAsHeaders: true, showColumnHeaders: false, useBom: false });

const DAY = 24 * 60 * 60;

describe("BlackScholesJS", function () {

  let blackScholesJS;

  // before each test
  beforeEach(() => {
    const lookupTable = generateLookupTable();
    blackScholesJS = new BlackScholesJS(lookupTable);
  });


  describe("Future", function () {

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

    it("calculates future price with 1 year expiration", async function () {

      let futurePrice = blackScholesJS.getFuturePrice(100, 0.02, 365 * DAY);
      expect(futurePrice.toFixed(2)).to.equal("102.02");

      futurePrice = blackScholesJS.getFuturePrice(100, 0.1, 365 * DAY);
      expect(futurePrice.toFixed(2)).to.equal("110.52");

      futurePrice = blackScholesJS.getFuturePrice(100, 1, 365 * DAY);
      expect(futurePrice.toFixed(2)).to.equal("271.83");
    });

    it("gets call price", async function () {
      let expectedOptionPrice = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "call");
      let actualOptionPrice = blackScholesJS.getCallPrice(1000, 930, 60 * DAY, 0.60, 0.05);

      //console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);

      expectedOptionPrice = bs.blackScholes(1000, 1000, 40 / 365, 0.80, 0.07, "call");
      actualOptionPrice = blackScholesJS.getCallPrice(1000, 1000, 40 * DAY, 0.80, 0.07);

      //console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
    });

    it("gets multiple call prices", async function () {
      console.log("Testing range")
      let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
      for(let exp = 50; exp < 80; exp += 1) {
        for (let strike = 850; strike < 1100; strike += 10) {
          for (let vol = 0.8; vol < 1.2; vol += 0.08) {
            for (let rate = 0; rate < 0.05; rate += 0.02) {
              // console.log("exp:", exp, "strike:", strike, "vol:", vol, "rate:", rate);
              let expected = bs.blackScholes(1000, strike, exp / 365, vol, rate, "call");
              let actual = blackScholesJS.getCallPrice(1000, strike, exp * DAY, vol, rate);

              let error = (Math.abs(actual - expected) / expected * 100);
              //console.log("expected:", expected.toFixed(4), "actual:", actual.toFixed(4), "error:", error.toFixed(4), "%");
              totalError += error;
              count++;
              if (maxError < error && expected > 0.01) {
                maxError = error;
                //console.log(exp.toFixed(6), strike.toFixed(2), vol.toFixed(2), maxError.toFixed(2) + "%", "act: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
                maxErrorParams = {
                  exp, strike, vol, rate, actual, expected
                }
              }
            }

          }
        }
      }
/*
      console.log("Total tests: " + count);
      console.log("Table size: ", Math.round((S_S_RATIO_MAX - S_S_RATIO_MIN) / S_S_RATIO_STEP) - 1, "x", Math.round((EXPIRATION_MAX - EXPIRATION_MIN) / EXPIRATION_STEP) - 1);
      console.log("Avg error: " + (totalError / count).toFixed(8) + "%");
      console.log("Max error: " + maxError.toFixed(8) + "%");
      console.log("Max error params: ", maxErrorParams);
*/

      // console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);

      // expectedOptionPrice = bs.blackScholes(1000, 1000, 40 / 365, 0.80, 0.07, "call");
      // actualOptionPrice = blackScholesJS.getCallPrice(1000, 1000, 40 * DAY, 0.80, 0.07);

      // console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
    });
  });
});
