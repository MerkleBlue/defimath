
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { BlackScholesNUMJS } from "../poc/blackscholes/BlackScholesNUMJS.mjs";
import { assertBothBelow, assertRevertError, MIN_ERROR, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const duoTest = true;

describe("DeFiMathFutures (SOL and JS)", function () {
  let blackScholesJS;

  async function deploy() {
    const [owner] = await ethers.getSigners();

    const FuturesWrapper = await ethers.getContractFactory("FuturesWrapper");
    const futures = await FuturesWrapper.deploy();

    return { owner, futures };
  }

  function getFuturePrice(spot, timeToExpirySec, rate) {
    // future = spot * e^(rT)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
    return futurePrice;
  }

  // before all tests, called once
  before(async () => {
    blackScholesJS = new BlackScholesNUMJS();
  });

  duoTest && describe("performance", function () {
    describe("future", function () {
      it("future when parameters in a typical range", async function () {
        const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };

        const spots = [10, 100, 500, 1000, 100000, 1000000];
        const times = [7, 30, 60, 90, 180];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const spot of spots) {
          for (const time of times) {
            for (const rate of rates) {
              totalGas += parseInt(await futures.getFuturePriceMG(tokens(spot), time * SEC_IN_DAY, tokens(rate)));
              count++;
            }
          }
        }
        console.log("Avg gas:", Math.round(totalGas / count), "tests: ", count);     
      });
    });
  });

  describe("functionality", function () {
    describe("future", function () {
      it("future when parameters in a typical range", async function () {
        const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };

        for (let timeSec = 0; timeSec < SEC_IN_YEAR; timeSec += SEC_IN_YEAR / 50) { 
          for (let rate = 0; rate < 4; rate += 0.1) { 
            const expected = getFuturePrice(100, SEC_IN_YEAR, rate);
            const actualJS = blackScholesJS.getFuturePrice(100, SEC_IN_YEAR, rate);
            assertBothBelow(actualJS, expected, 0.00000006, 0.00000300);

            if (duoTest) {
              const actualSOL = (await futures.getFuturePrice(tokens(100), SEC_IN_YEAR, tokens(rate))).toString() / 1e18;
              assertBothBelow(actualSOL, expected, 0.00000006, 0.00000300);
            }
          }
        }
      });

      describe("limits", function () {
        it("single when expired", async function () {
          const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };
          const expected = getFuturePrice(100, 0, 0.05);
          const actualJS = blackScholesJS.getFuturePrice(100, 0, 0.05);
          assertBothBelow(actualJS, expected, MIN_ERROR, MIN_ERROR);

          if (duoTest) {
            const actualSOL = (await futures.getFuturePrice(tokens(100), 0, tokens(0.05))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, MIN_ERROR, MIN_ERROR);
          }
        });

        it("single when rate 0%", async function () {
          const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };
          const expected = getFuturePrice(100, SEC_IN_YEAR, 0);
          const actualJS = blackScholesJS.getFuturePrice(100, SEC_IN_YEAR, 0);
          assertBothBelow(actualJS, expected, MIN_ERROR, MIN_ERROR);

          if (duoTest) {
            const actualSOL = (await futures.getFuturePrice(tokens(100), SEC_IN_YEAR, 0)).toString() / 1e18;
            assertBothBelow(actualSOL, expected, MIN_ERROR, MIN_ERROR);
          }
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };

          expect(() => blackScholesJS.getFuturePrice(0.00000099, 50000, 0.05)).to.throw("SpotLowerBoundError");
          expect(() => blackScholesJS.getFuturePrice(0, 50000, 0.05)).to.throw("SpotLowerBoundError");

          if (duoTest) {
            await assertRevertError(futures, futures.getFuturePrice("999999999999", 50000, tokens(0.05)), "SpotLowerBoundError");
            await futures.getFuturePrice("1000000000000", 50000, tokens(0.05));
            await assertRevertError(futures, futures.getFuturePrice(tokens(0), 50000, tokens(0.05)), "SpotLowerBoundError");
          }
        });

        it("rejects when spot > max spot", async function () {
          const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };

          expect(() => blackScholesJS.getFuturePrice(1e15 + 1, 50000, 0.05)).to.throw("SpotUpperBoundError");
          expect(() => blackScholesJS.getFuturePrice(1e18, 50000, 0.05)).to.throw("SpotUpperBoundError");

          if (duoTest) {
            await assertRevertError(futures, futures.getFuturePrice("1000000000000000000000000000000001", 50000, tokens(0.05)), "SpotUpperBoundError");
            await futures.getFuturePrice("1000000000000000000000000000000000", 50000, tokens(0.05));
            await assertRevertError(futures, futures.getFuturePrice("100000000000000000000000000000000000", 50000, tokens(0.05)), "SpotUpperBoundError");
          }
        });

        it("rejects when time > max time", async function () {
          const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };

          expect(() => blackScholesJS.getFuturePrice(1000, 4294967295, 0.05)).to.throw("TimeToExpiryUpperBoundError");
          expect(() => blackScholesJS.getFuturePrice(1000, 63072001, 0.05)).to.throw("TimeToExpiryUpperBoundError");

          if (duoTest) {
            await assertRevertError(futures, futures.getFuturePrice(tokens(1000), 63072001, tokens(0.05)), "TimeToExpiryUpperBoundError");
            await futures.getFuturePrice(tokens(1000), 63072000, tokens(0.05)); // todo: check value when 2 years in another test
            await assertRevertError(futures, futures.getFuturePrice(tokens(1000), 4294967295, tokens(0.05)), "TimeToExpiryUpperBoundError");
          }
        });

        it("rejects when rate > max rate", async function () {
          const { futures } = duoTest ? await loadFixture(deploy) : { futures: null };

          expect(() => blackScholesJS.getFuturePrice(1000, 60 * SEC_IN_DAY, 18)).to.throw("RateUpperBoundError");
          expect(() => blackScholesJS.getFuturePrice(1000, 60 * SEC_IN_DAY, 4 + 1e-15)).to.throw("RateUpperBoundError");

          if (duoTest) {
            await assertRevertError(futures, futures.getFuturePrice(tokens(1000), 60 * SEC_IN_DAY, tokens(4 + 1e-15)), "RateUpperBoundError");
            await futures.getFuturePrice(tokens(1000), 60 * SEC_IN_DAY, tokens(4));
            await assertRevertError(futures, futures.getFuturePrice(tokens(1000), 60 * SEC_IN_DAY, tokens(18)), "RateUpperBoundError");
          }
        });
      });
    });
  });
});
