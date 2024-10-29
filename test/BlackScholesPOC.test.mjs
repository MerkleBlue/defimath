import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { assert, expect } from "chai";
import hre from "hardhat";

const SECONDS_IN_DAY = 24 * 60 * 60;

function tokens(value) {

  return hre.ethers.parseUnits(value.toString(), 18).toString();
}

describe("BlackScholesPOC (contract)", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deploy() {
    const [owner] = await ethers.getSigners();

    const BlackScholesPOC = await ethers.getContractFactory("BlackScholesPOC");
    const bs = await BlackScholesPOC.deploy();

    return { owner, bs };
  }

  describe.only("Future", function () {

    function getFuturePrice(spot, timeToExpirySec, rate) {
      // future = spot * e^(rT)
      const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
      const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
      return futurePrice;
    }

    it("gas spent", async function () {
      const { bs } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      for (let rate = 0; rate <= 0.1; rate += 0.01) {
        for (let days = 0; days <= 2 * 365; days += 1) {
          const gasUsed = await bs.getFuturePriceMeasureGas(tokens(100), days * SECONDS_IN_DAY, Math.round(rate * 10_000));
          totalGas += parseInt(gasUsed);
          count++;
        }
      }
      console.log("Gas spent [avg]: ", parseInt(totalGas / count));
    });

    it("calculates future price for lowest time and rate", async function () {
      const { bs } = await loadFixture(deploy);

      const expected = getFuturePrice(100, 1, 0.0001);
      const actual = (await bs.getFuturePrice(tokens(100), 1, 1)).toString() / 1e18;
      const error = (Math.abs(actual - expected) / expected * 100);
      console.log("Worst case: error:", error.toFixed(12) + "%, rate, ", "actual: " + actual.toFixed(12), "expected: " + expected.toFixed(12));
      assert.isBelow(error, 0.0001); // is below 0.0001%
    });

    it("calculates future price [0s, 10m]", async function () {
      const { bs } = await loadFixture(deploy);

      let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
      for (let rate = 0; rate <= 0.001; rate += 0.0001) {
        for (let secs = 0; secs <= 600; secs += 1) {
          const expected = getFuturePrice(100, secs, rate);
          const actual = (await bs.getFuturePrice(tokens(100), secs, Math.round(rate * 10_000))).toString() / 1e18;
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
      const { bs } = await loadFixture(deploy);

      let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
      for (let rate = 0; rate <= 0.5; rate += 0.05) {
        for (let secs = 600; secs <= 1440 * 60; secs += 120) {
          const expected = getFuturePrice(100, secs, rate);
          const actual = (await bs.getFuturePrice(tokens(100), secs, Math.round(rate * 10_000))).toString() / 1e18;
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
      const { bs } = await loadFixture(deploy);

      let maxError = 0, totalError = 0, count = 0, maxErrorParams = null;
      for (let rate = 0; rate <= 0.1; rate += 0.01) {
        for (let days = 1; days <= 2 * 365; days += 1) {
          const expected = getFuturePrice(100, days * SECONDS_IN_DAY, rate);
          const actual = (await bs.getFuturePrice(tokens(100), days * SECONDS_IN_DAY, Math.round(rate * 10_000))).toString() / 1e18;
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

  describe("Deployment", function () {
    it("deploys contract", async function () {
      const { bs } = await loadFixture(deploy);
      console.log(bs.target)
    });

    it("gets call price map", async function () {
      const { bs } = await loadFixture(deploy);

      const callPriceMap = await bs.getCallPrice(100, 100, 1000, 1, 1);
      console.log(callPriceMap);

      const estGas2 = await bs.getCallPrice.estimateGas(100, 100, 1000, 1, 1);
      console.log("Gas spent map:", parseInt(estGas2) - 21000);
    });

    it.only("test gas", async function () {
      const { bs } = await loadFixture(deploy);

      const callPriceMap = await bs.testGas();
      console.log(callPriceMap);
    });

    // it("gets call price array", async function () {
    //   const { bs } = await loadFixture(deploy);

    //   const callPrice = await bs.getCallPrice(100, 100, 1000, 1, 1);
    //   console.log(callPrice);

    //   const estGas1 = await bs.getCallPrice.estimateGas(100, 100, 1000, 1, 1);
    //   console.log("Gas spent array:", parseInt(estGas1) - 21000);
    // });

  });

  describe("Time indexes", function () {
    async function getActualExpected(bs, time) {
      const actual = await bs.getIndex(time);
      // check index against log2, which we don't have in JS
      const major = Math.floor(Math.log2(time));
      const minor = Math.floor((time - 2 ** major) / 2 ** (major - 3));
      const expected = major * 10 + minor;
      return { actual, expected };
    }

    it("gas spent", async function () {
      const { bs } = await loadFixture(deploy);

      let count = 0;
      let totalGas = 0;
      for (let i = 4; i < 32; i++) {
        const gasUsed = await bs.getIndexMeasureGas(2 ** i + 1);
        totalGas += parseInt(gasUsed);
        count++;
      }
      console.log("Gas spent [avg]: ", parseInt(totalGas / count));
    });

    it("calculates index for time [0, 2^3)", async function () {
      const { bs } = await loadFixture(deploy);

      assert.equal(await bs.getIndex(0), 0);
      assert.equal(await bs.getIndex(1), 1);
      assert.equal(await bs.getIndex(2), 2);
      assert.equal(await bs.getIndex(3), 3);
      assert.equal(await bs.getIndex(4), 4);
      assert.equal(await bs.getIndex(5), 5);
      assert.equal(await bs.getIndex(6), 6);
      assert.equal(await bs.getIndex(7), 7);
    });

    it("calculates index for time [2^3, 2^16)", async function () {
      const { bs } = await loadFixture(deploy);
      let count = 0;
      for (let time = 8; time < 2 ** 16; time++) {
        const { actual, expected } = await getActualExpected(bs, time);
        assert.equal(actual, expected);
        count++;
      }
      console.log("values tested: ", count);
    });

    it("calculates index for time [2^16, 2^24)", async function () {
      const { bs } = await loadFixture(deploy);
      let count = 0;
      for (let time = 2 ** 16; time < 2 ** 24; time += 2 ** 8) {
        const { actual, expected } = await getActualExpected(bs, time);
        assert.equal(actual, expected);
        count++;
      }
      console.log("values tested: ", count);
    });

    it("calculates index for time [2^24, 2^32)", async function () {
      const { bs } = await loadFixture(deploy);
      let count = 0;
      for (let time = 2 ** 24; time < 2 ** 32; time += 2 ** 16) {
        const { actual, expected } = await getActualExpected(bs, time);
        assert.equal(actual, expected);
        count++;
      }
      console.log("values tested: ", count);
    });
  });
});
