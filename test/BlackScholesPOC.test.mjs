import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { assert } from "chai";
import hre from "hardhat";
import { BlackScholesJS, STRIKE_INDEX_MULTIPLIER } from "../poc/blackscholes/BlackScholesJS.mjs";
import { generateLookupTable } from "../poc/blackscholes/generateLookupTable.mjs";
import bs from "black-scholes";

const SECONDS_IN_DAY = 24 * 60 * 60;

function tokens(value) {
  return hre.ethers.parseUnits(value.toString(), 18).toString();
}

describe("BlackScholesPOC (contract)", function () {
  let mapSize;

  async function deploy() {
    const [owner] = await ethers.getSigners();

    // deploy contract
    const BlackScholesPOC = await ethers.getContractFactory("BlackScholesPOC");
    const blackScholesPOC = await BlackScholesPOC.deploy();

    // populate lookup table
    const { lookupTableSOL } = await generateLookupTable(new BlackScholesJS(), true);

    let totalGas = 0;
    let indexArray = [], dataArray = [];
    for (const [key, value] of lookupTableSOL) {
      if (indexArray.length < 100) {
        indexArray.push(key);
        dataArray.push(value);
      } else {
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

  describe("deployment", function () {
    it("deploys contract", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);
      console.log(blackScholesPOC.target)
    });
  });

  describe("performance", function () {
    it.only("getCallOptionPrice gas", async function () {
      const { blackScholesPOC } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for(let exp = 20; exp < 180; exp += 8) {
        for (let strike = 600; strike < 1400; strike += 80) {
          for (let vol = 0.8; vol < 1.2; vol += 0.08) {
            for (let rate = 0; rate < 0.05; rate += 0.02) {
              totalGas += parseInt(await blackScholesPOC.getCallOptionPrice.estimateGas(tokens(1000), tokens(strike), exp * SECONDS_IN_DAY, tokens(vol), Math.round(rate * 10_000))) - 21000;
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
              totalGas += parseInt(await blackScholesPOC.getPutOptionPrice.estimateGas(tokens(1000), tokens(strike), exp * SECONDS_IN_DAY, tokens(vol), Math.round(rate * 10_000))) - 21000;
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
          const gasUsed = await blackScholesPOC.getFuturePriceMeasureGas(tokens(100), days * SECONDS_IN_DAY, Math.round(rate * 10_000));
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

  describe("functionality", function () {
    describe("getFuturePrice", function () {
      function getFuturePrice(spot, timeToExpirySec, rate) {
        // future = spot * e^(rT)
        const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
        const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
        return futurePrice;
      }

      it("calculates future price for lowest time and rate", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);

        const expected = getFuturePrice(100, 1, 0.0001);
        const actual = (await blackScholesPOC.getFuturePrice(tokens(100), 1, 1)).toString() / 1e18;
        const error = (Math.abs(actual - expected) / expected * 100);
        console.log("Worst case: error:", error.toFixed(12) + "%, rate, ", "actual: " + actual.toFixed(12), "expected: " + expected.toFixed(12));
        assert.isBelow(error, 0.0001); // is below 0.0001%
      });

      it("calculates future price [0s, 10m]", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);

        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.001; rate += 0.0001) {
          for (let secs = 0; secs <= 600; secs += 1) {
            const expected = getFuturePrice(100, secs, rate);
            const actual = (await blackScholesPOC.getFuturePrice(tokens(100), secs, Math.round(rate * 10_000))).toString() / 1e18;
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
        const { blackScholesPOC } = await loadFixture(deploy);

        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.5; rate += 0.05) {
          for (let secs = 600; secs <= 1440 * 60; secs += 120) {
            const expected = getFuturePrice(100, secs, rate);
            const actual = (await blackScholesPOC.getFuturePrice(tokens(100), secs, Math.round(rate * 10_000))).toString() / 1e18;
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
        const { blackScholesPOC } = await loadFixture(deploy);

        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for (let rate = 0; rate <= 0.1; rate += 0.01) {
          for (let days = 1; days <= 2 * 365; days += 1) {
            const expected = getFuturePrice(100, days * SECONDS_IN_DAY, rate);
            const actual = (await blackScholesPOC.getFuturePrice(tokens(100), days * SECONDS_IN_DAY, Math.round(rate * 10_000))).toString() / 1e18;
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
      it.only("gets a single call price", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);
        let expectedOptionPrice = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "call");
        let actualOptionPrice = await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(930), 60 * SECONDS_IN_DAY, tokens(0.60), Math.round(0.05 * 10_000));

        console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice.toString() / 1e18);
      });

      it("gets multiple call prices", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for(let exp = 50; exp < 80; exp += 1) {
          for (let strike = 850; strike < 1100; strike += 10) {
            for (let vol = 0.8; vol < 1.2; vol += 0.08) {
              for (let rate = 0; rate < 0.05; rate += 0.02) {
                const expected = bs.blackScholes(1000, strike, exp / 365, vol, rate, "call");
                const actual = (await blackScholesPOC.getCallOptionPrice(tokens(1000), tokens(strike), exp * SECONDS_IN_DAY, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
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

        console.log("Total tests: ", count);
        console.log("Table (map) size: ", mapSize);
        console.log("Error: avg: " + avgError.toFixed(6) + "%", "max: " + maxError.toFixed(6) + "%");
        console.log("Max error params: ", maxErrorParams);

        assert.isBelow(avgError, 0.0007); // avg error is below 0.0007%
        assert.isBelow(maxError, 0.0054); // max error is below 0.0054%
      });
    });

    describe("getPutOptionPrice", function () {
      it("gets a single put price", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);
        let expectedOptionPrice = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.05, "put");
        let actualOptionPrice = await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(930), 60 * SECONDS_IN_DAY, tokens(0.60), Math.round(0.05 * 10_000));

        console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice.toString() / 1e18);
      });

      it("gets multiple put prices", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);
        let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
        for(let exp = 50; exp < 80; exp += 1) {
          for (let strike = 850; strike < 1100; strike += 10) {
            for (let vol = 0.8; vol < 1.2; vol += 0.08) {
              for (let rate = 0; rate < 0.05; rate += 0.02) {
                const expected = bs.blackScholes(1000, strike, exp / 365, vol, rate, "put");
                const actual = (await blackScholesPOC.getPutOptionPrice(tokens(1000), tokens(strike), exp * SECONDS_IN_DAY, tokens(vol), Math.round(rate * 10_000))).toString() / 1e18;
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

        console.log("Total tests: ", count);
        console.log("Table (map) size: ", mapSize);
        console.log("Error: avg: " + avgError.toFixed(6) + "%", "max: " + maxError.toFixed(6) + "%");
        console.log("Max error params: ", maxErrorParams);

        assert.isBelow(avgError, 0.00109); // avg error is below 0.00109%
        assert.isBelow(maxError, 0.0195); // max error is below 0.0195%
      });
    });

    describe("getIndexFromTime", function () {
      async function getActualExpected(blackScholesPOC, time) {
        const actual = await blackScholesPOC.getIndexFromTime(time);
        // check index against log2, which we don't have in JS
        const major = Math.floor(Math.log2(time));
        const minor = Math.floor((time - 2 ** major) / 2 ** (major - 3));
        const expected = major * 10 + minor;
        return { actual, expected };
      }

      it("calculates index for time [0, 2^3)", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);

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
        const { blackScholesPOC } = await loadFixture(deploy);
        let count = 0;
        for (let time = 8; time < 2 ** 16; time++) {
          const { actual, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });

      it("calculates index for time [2^16, 2^24)", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);
        let count = 0;
        for (let time = 2 ** 16; time < 2 ** 24; time += 2 ** 8) {
          const { actual, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });

      it("calculates index for time [2^24, 2^32)", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);
        let count = 0;
        for (let time = 2 ** 24; time < 2 ** 32; time += 2 ** 16) {
          const { actual, expected } = await getActualExpected(blackScholesPOC, time);
          assert.equal(actual, expected);
          count++;
        }
        console.log("values tested: ", count);
      });
    });

    describe("getIndexFromStrike", function () {
      it("calculates index for strike [200, 500]", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);

        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(200))));
        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(200.00001))));
        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(201))));
        assert.equal(200 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(203))));
        assert.equal(204 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(204))));
        assert.equal(204 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(205))));
        assert.equal(260 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(260))));
        assert.equal(260 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(261))));
        assert.equal(496 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(499))));
        assert.equal(496 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(499.9999))));
      });

      it("calculates index for strike [120, 200)", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);

        assert.equal(120 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(120))));
        assert.equal(120 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(120.00001))));
        assert.equal(121 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(121))));
        assert.equal(199 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(199))));
        assert.equal(199 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(199.9999))));
      });

      it("calculates index for strike [105, 120)", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);

        assert.equal(105 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(105))));
        assert.equal(105.1 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(105.1))));
        assert.equal(105.4 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(105.499999))));
        assert.equal(105.5 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(105.5))));
        assert.equal(105.5 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(105.500001))));
        assert.equal(108.3 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(108.333333))));
        assert.equal(108.6 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(108.666666))));
        assert.equal(119.5 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(119.999999))));
      });

      it("calculates index for strike [80, 105)", async function () {
        const { blackScholesPOC } = await loadFixture(deploy);

        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(80))));
        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(80.1))));
        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(80.199999))));
        assert.equal(80 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(80.2))));
        assert.equal(99.95 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(99.999999))));
        assert.equal(100 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(100.000001))));
        assert.equal(104.9 * STRIKE_INDEX_MULTIPLIER, parseInt(await blackScholesPOC.getIndexFromStrike(tokens(104.999999))));
      });
      // todo: start from 20, test each segment
    });
  });
});

