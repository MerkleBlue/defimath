
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { assert } from "chai";
import { assertAbsoluteBelow, assertRelativeBelow, assertRevertError, MIN_ERROR, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";
import { MAX_ABS_ERROR_FUTURE } from "./Tolerances.test.mjs";

describe("DeFiMathFutures", function () {

  async function deploy() {
    const FuturesWrapper = await ethers.getContractFactory("FuturesWrapper");
    const futures = await FuturesWrapper.deploy();
    return { futures };
  }

  before(async function () {
    // Pay the deploy + snapshot cost once so the first it() isn't charged with cold-start.
    await loadFixture(deploy);
  });

  function futurePrice(spot, timeToExpSec, rate) {
    // future = spot · e^(rT) — closed-form continuous-compounding futures price
    const tYears = timeToExpSec / SEC_IN_YEAR;
    return spot * Math.exp(rate * tYears);
  }

  describe("future", function () {

    describe("behaviour", function () {
      it("future when t in [0, 1y) × rate in [0, 4) — 10 × 20 = 200 samples", async function () {
        const { futures } = await loadFixture(deploy);

        // 10 time points × 20 rate points = 200 samples sweeping both dimensions.
        const tStep = SEC_IN_YEAR / 10;
        const rateStep = 4 / 20;
        for (let timeSec = 0; timeSec < SEC_IN_YEAR; timeSec += tStep) {
          for (let rate = 0; rate < 4; rate += rateStep) {
            const expected = futurePrice(1000, timeSec, rate);
            const actualSOL = (await futures.futurePrice(tokens(1000), Math.floor(timeSec), tokens(rate))).toString() / 1e18;
            assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_FUTURE);
          }
        }
      });
    });

    describe("limits", function () {
      it("expired (t = 0): future == spot", async function () {
        const { futures } = await loadFixture(deploy);
        const expected = futurePrice(1000, 0, 0.05);
        const actualSOL = (await futures.futurePrice(tokens(1000), 0, tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("rate = 0 (zero carry): future == spot for any t", async function () {
        const { futures } = await loadFixture(deploy);
        const expected = futurePrice(1000, SEC_IN_YEAR, 0);
        const actualSOL = (await futures.futurePrice(tokens(1000), SEC_IN_YEAR, 0)).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MIN_ERROR);
      });

      it("spot at SPOT_MIN (1e-6 in FP, smallest non-reverting)", async function () {
        const { futures } = await loadFixture(deploy);
        const spot = 1e-6;
        const expected = futurePrice(spot, 30 * SEC_IN_DAY, 0.05);
        const actualSOL = (await futures.futurePrice("1000000000000", 30 * SEC_IN_DAY, tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_FUTURE);
      });

      it("spot at SPOT_MAX (1e15 in FP, largest non-reverting)", async function () {
        const { futures } = await loadFixture(deploy);
        const spot = 1e15;
        const expected = futurePrice(spot, 30 * SEC_IN_DAY, 0.05);
        const actualSOL = (await futures.futurePrice("1000000000000000000000000000000000", 30 * SEC_IN_DAY, tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, spot * MAX_ABS_ERROR_FUTURE);
      });

      it("time at TIME_MAX (2 years, largest non-reverting)", async function () {
        const { futures } = await loadFixture(deploy);
        const expected = futurePrice(1000, 63072000, 0.05);
        const actualSOL = (await futures.futurePrice(tokens(1000), 63072000, tokens(0.05))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_FUTURE);
      });

      it("rate at RATE_MAX (400%, largest non-reverting)", async function () {
        const { futures } = await loadFixture(deploy);
        const expected = futurePrice(1000, 30 * SEC_IN_DAY, 4);
        const actualSOL = (await futures.futurePrice(tokens(1000), 30 * SEC_IN_DAY, tokens(4))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, expected * 1e-12);  // looser since e^(4·1/12) ≈ 1.39
      });
    });

    describe("random", function () {
      it("future across 200 random (spot, t, rate) triples", async function () {
        const { futures } = await loadFixture(deploy);

        // Log-uniform spot across [1e-3, 1e6] (9 decades — covers typical DeFi price ranges
        // from sub-cent micro-tokens to mid-cap caps without bumping into tokens() precision
        // limits). Uniform time ∈ [0, 2y) and rate ∈ [0, 4).
        const logLo = Math.log(1e-3);
        const logHi = Math.log(1e6);
        for (let i = 0; i < 200; i++) {
          const spot = Math.exp(logLo + Math.random() * (logHi - logLo));
          const timeSec = Math.floor(Math.random() * 63072000);
          const rate = Math.random() * 4;

          const expected = futurePrice(spot, timeSec, rate);
          const actual = (await futures.futurePrice(tokens(spot), timeSec, tokens(rate))).toString() / 1e18;
          assertRelativeBelow(actual, expected, 2e-12);
        }
      });
    });

    describe("failure", function () {
      it("rejects when spot < min spot", async function () {
        const { futures } = await loadFixture(deploy);
        await assertRevertError(futures, futures.futurePrice("999999999999", 50000, tokens(0.05)), "SpotLowerBoundError");
        await futures.futurePrice("1000000000000", 50000, tokens(0.05));
        await assertRevertError(futures, futures.futurePrice(tokens(0), 50000, tokens(0.05)), "SpotLowerBoundError");
      });

      it("rejects when spot > max spot", async function () {
        const { futures } = await loadFixture(deploy);
        await assertRevertError(futures, futures.futurePrice("1000000000000000000000000000000001", 50000, tokens(0.05)), "SpotUpperBoundError");
        await futures.futurePrice("1000000000000000000000000000000000", 50000, tokens(0.05));
        await assertRevertError(futures, futures.futurePrice("100000000000000000000000000000000000", 50000, tokens(0.05)), "SpotUpperBoundError");
      });

      it("rejects when time > max time", async function () {
        const { futures } = await loadFixture(deploy);
        await assertRevertError(futures, futures.futurePrice(tokens(1000), 63072001, tokens(0.05)), "TimeToExpiryUpperBoundError");
        await futures.futurePrice(tokens(1000), 63072000, tokens(0.05));
        await assertRevertError(futures, futures.futurePrice(tokens(1000), 4294967295, tokens(0.05)), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { futures } = await loadFixture(deploy);
        await assertRevertError(futures, futures.futurePrice(tokens(1000), 60 * SEC_IN_DAY, tokens(4 + 1e-15)), "RateUpperBoundError");
        await futures.futurePrice(tokens(1000), 60 * SEC_IN_DAY, tokens(4));
        await assertRevertError(futures, futures.futurePrice(tokens(1000), 60 * SEC_IN_DAY, tokens(18)), "RateUpperBoundError");
      });
    });

    describe("performance", function () {
      it("future across 6×5×3 spots/times/rates — 442 gas", async function () {
        const { futures } = await loadFixture(deploy);

        const spots = [10, 100, 500, 1000, 100000, 1000000];
        const times = [7, 30, 60, 90, 180];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const spot of spots) {
          for (const time of times) {
            for (const rate of rates) {
              totalGas += parseInt(await futures.futurePriceMG(tokens(spot), time * SEC_IN_DAY, tokens(rate)));
              count++;
            }
          }
        }
        const avg = Math.round(totalGas / count);
        assert.equal(avg, 442, `gas changed: ${avg} ≠ 442 — deterministic, update threshold if intentional`);
      });
    });
  });
});
