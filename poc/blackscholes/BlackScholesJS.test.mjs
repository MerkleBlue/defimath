
import { assert, expect } from "chai";
import bs from "black-scholes";
import { BlackScholesJS, EXPIRATION_MAX, EXPIRATION_MIN, EXPIRATION_STEP, S_S_RATIO_MAX, S_S_RATIO_MIN, S_S_RATIO_STEP } from "./BlackScholesJS.mjs";
import { generateLookupTable } from "./generateLookupTable.mjs";

const DAY = 24 * 60 * 60;

describe("BlackScholesJS", function () {

  let blackScholesJS;

  describe("Future", function () {
    // before each test
    beforeEach(() => {
      const lookupTable = generateLookupTable();
      blackScholesJS = new BlackScholesJS(lookupTable);
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

      console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);

      expectedOptionPrice = bs.blackScholes(1000, 1000, 40 / 365, 0.80, 0.07, "call");
      actualOptionPrice = blackScholesJS.getCallPrice(1000, 1000, 40 * DAY, 0.80, 0.07);

      console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
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
              console.log("expected:", expected.toFixed(4), "actual:", actual.toFixed(4), "error:", error.toFixed(4), "%");
              totalError += error;
              count++;
              if (maxError < error && expected > 0.01) {
                maxError = error;
                console.log(exp.toFixed(6), strike.toFixed(2), vol.toFixed(2), maxError.toFixed(2) + "%", "act: " + actual.toFixed(6), "expected: " + expected.toFixed(6));
                maxErrorParams = {
                  exp, strike, vol, rate, actual, expected
                }
              }
            }

          }
        }
      }

      console.log("Total tests: " + count);
      console.log("Table size: ", Math.round((S_S_RATIO_MAX - S_S_RATIO_MIN) / S_S_RATIO_STEP) - 1, "x", Math.round((EXPIRATION_MAX - EXPIRATION_MIN) / EXPIRATION_STEP) - 1);
      console.log("Avg error: " + (totalError / count).toFixed(8) + "%");
      console.log("Max error: " + maxError.toFixed(8) + "%");
      console.log("Max error params: ", maxErrorParams);


      // console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);

      // expectedOptionPrice = bs.blackScholes(1000, 1000, 40 / 365, 0.80, 0.07, "call");
      // actualOptionPrice = blackScholesJS.getCallPrice(1000, 1000, 40 * DAY, 0.80, 0.07);

      // console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
    });
  });

  describe.only("Time indexes", function () {
    // before each test
    beforeEach(() => {
      blackScholesJS = new BlackScholesJS();
    });

    function getActualExpected(time) {
      const actual = blackScholesJS.getIndex(time);
      // check index against log2, which we don't have in JS
      const major = Math.floor(Math.log2(time));
      const minor = Math.floor((time - 2 ** major) / 2 ** (major - 3));
      const expected = major * 10 + minor;
      return { actual, expected };
    }

    it("calculates index for time [0, 2^3)", async function () {
      assert.equal(blackScholesJS.getIndex(0), 0);
      assert.equal(blackScholesJS.getIndex(1), 1);
      assert.equal(blackScholesJS.getIndex(2), 2);
      assert.equal(blackScholesJS.getIndex(3), 3);
      assert.equal(blackScholesJS.getIndex(4), 4);
      assert.equal(blackScholesJS.getIndex(5), 5);
      assert.equal(blackScholesJS.getIndex(6), 6);
      assert.equal(blackScholesJS.getIndex(7), 7);
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
});
