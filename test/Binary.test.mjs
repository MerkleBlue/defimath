
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { OptionsJS } from "../poc/blackscholes/optionsJS.mjs";
import { assertAbsoluteBelow, assertRevertError, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const MAX_BINARY_ABS_ERROR = 1.2e-10; // for a binary call with $1 payout

describe("DeFiMathBinary", function () {

  async function deploy() {
    const BinaryWrapper = await ethers.getContractFactory("BinaryWrapper");
    const binary = await BinaryWrapper.deploy();
    const optionsJS = new OptionsJS();
    return { binary, optionsJS };
  }

  describe("performance", function () {
    it("getBinaryCallPrice typical range", async function () {
      const { binary } = await loadFixture(deploy);

      let totalGas = 0, count = 0;
      const spot = 1000;
      const strikes = [600, 800, 1000, 1200, 1500];
      const times = [SEC_IN_DAY, 7 * SEC_IN_DAY, 30 * SEC_IN_DAY, 90 * SEC_IN_DAY];
      const vols = [0.2, 0.5, 0.8, 1.2];
      const rates = [0, 0.05, 0.1];
      const payout = 1;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const result = await binary.getBinaryCallPriceMG(
                tokens(spot), tokens(strike), time, tokens(vol), tokens(rate), tokens(payout)
              );
              totalGas += parseInt(result.gasUsed);
              count++;
            }
          }
        }
      }
      console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
    });
  });

  describe("functionality", function () {
    it("getBinaryCallPrice ATM", async function () {
      const { binary, optionsJS } = await loadFixture(deploy);

      const spot = 1000, strike = 1000, time = 30 * SEC_IN_DAY, vol = 0.5, rate = 0.05, payout = 1;
      const expected = optionsJS.getBinaryCallPrice(spot, strike, time, vol, rate, payout);

      const actualSOL = (await binary.getBinaryCallPrice(
        tokens(spot), tokens(strike), time, tokens(vol), tokens(rate), tokens(payout)
      )).toString() / 1e18;

      assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
    });

    it("getBinaryCallPrice deep ITM (Φ(d2) → 1)", async function () {
      const { binary, optionsJS } = await loadFixture(deploy);

      // spot >> strike, low vol, short time → Φ(d2) ≈ 1, price ≈ payout * e^(-r*τ)
      const spot = 1000, strike = 500, time = SEC_IN_DAY, vol = 0.2, rate = 0.05, payout = 1;
      const expected = optionsJS.getBinaryCallPrice(spot, strike, time, vol, rate, payout);

      const actualSOL = (await binary.getBinaryCallPrice(
        tokens(spot), tokens(strike), time, tokens(vol), tokens(rate), tokens(payout)
      )).toString() / 1e18;

      assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
      // should be close to e^(-rate*time/year) ≈ 0.99986
      assert.isAbove(actualSOL, 0.999);
    });

    it("getBinaryCallPrice deep OTM (Φ(d2) → 0)", async function () {
      const { binary, optionsJS } = await loadFixture(deploy);

      // spot << strike, low vol, short time → Φ(d2) ≈ 0, price ≈ 0
      const spot = 1000, strike = 2000, time = SEC_IN_DAY, vol = 0.2, rate = 0.05, payout = 1;
      const expected = optionsJS.getBinaryCallPrice(spot, strike, time, vol, rate, payout);

      const actualSOL = (await binary.getBinaryCallPrice(
        tokens(spot), tokens(strike), time, tokens(vol), tokens(rate), tokens(payout)
      )).toString() / 1e18;

      assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
      assert.isBelow(actualSOL, 0.001);
    });

    it("getBinaryCallPrice expired ITM returns full payout", async function () {
      const { binary } = await loadFixture(deploy);

      const actualSOL = (await binary.getBinaryCallPrice(
        tokens(1100), tokens(1000), 0, tokens(0.5), tokens(0.05), tokens(1)
      )).toString() / 1e18;

      assert.equal(actualSOL, 1);
    });

    it("getBinaryCallPrice expired OTM returns 0", async function () {
      const { binary } = await loadFixture(deploy);

      const actualSOL = (await binary.getBinaryCallPrice(
        tokens(900), tokens(1000), 0, tokens(0.5), tokens(0.05), tokens(1)
      )).toString() / 1e18;

      assert.equal(actualSOL, 0);
    });

    it("getBinaryCallPrice expired ATM returns 0", async function () {
      const { binary } = await loadFixture(deploy);

      // spot == strike at expiry: not strictly ITM, returns 0
      const actualSOL = (await binary.getBinaryCallPrice(
        tokens(1000), tokens(1000), 0, tokens(0.5), tokens(0.05), tokens(1)
      )).toString() / 1e18;

      assert.equal(actualSOL, 0);
    });

    it("getBinaryCallPrice scales linearly with payout", async function () {
      const { binary } = await loadFixture(deploy);

      const args = [tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05)];

      const price1 = (await binary.getBinaryCallPrice(...args, tokens(1))).toString() / 1e18;
      const price100 = (await binary.getBinaryCallPrice(...args, tokens(100))).toString() / 1e18;
      const price1000 = (await binary.getBinaryCallPrice(...args, tokens(1000))).toString() / 1e18;

      assertAbsoluteBelow(price100, price1 * 100, 1e-6);
      assertAbsoluteBelow(price1000, price1 * 1000, 1e-4);
    });

    it("getBinaryCallPrice across strike/time/vol/rate matrix", async function () {
      const { binary, optionsJS } = await loadFixture(deploy);

      const spot = 1000;
      const strikes = [600, 900, 1000, 1100, 1500];
      const times = [SEC_IN_DAY, 30 * SEC_IN_DAY, 180 * SEC_IN_DAY];
      const vols = [0.2, 0.6, 1.2];
      const rates = [0, 0.05, 0.2];
      const payout = 1;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              const expected = optionsJS.getBinaryCallPrice(spot, strike, time, vol, rate, payout);

              const actualSOL = (await binary.getBinaryCallPrice(
                tokens(spot), tokens(strike), time, tokens(vol), tokens(rate), tokens(payout)
              )).toString() / 1e18;

              assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
            }
          }
        }
      }
    });

    describe("failure", function () {
      it("rejects when spot < min", async function () {
        const { binary } = await loadFixture(deploy);
        await assertRevertError(binary, binary.getBinaryCallPrice(
          tokens(1e-7), tokens(1e-7), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05), tokens(1)
        ), "SpotLowerBoundError");
      });

      it("rejects when spot > max", async function () {
        const { binary } = await loadFixture(deploy);
        await assertRevertError(binary, binary.getBinaryCallPrice(
          tokens(1e16), tokens(1e16), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05), tokens(1)
        ), "SpotUpperBoundError");
      });

      it("rejects when strike > spot * 5", async function () {
        const { binary } = await loadFixture(deploy);
        await assertRevertError(binary, binary.getBinaryCallPrice(
          tokens(1000), tokens(5001), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05), tokens(1)
        ), "StrikeUpperBoundError");
      });

      it("rejects when strike < spot / 5", async function () {
        const { binary } = await loadFixture(deploy);
        await assertRevertError(binary, binary.getBinaryCallPrice(
          tokens(1000), tokens(199), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05), tokens(1)
        ), "StrikeLowerBoundError");
      });

      it("rejects when time > max time", async function () {
        const { binary } = await loadFixture(deploy);
        await assertRevertError(binary, binary.getBinaryCallPrice(
          tokens(1000), tokens(1000), 2 * SEC_IN_YEAR + 1, tokens(0.5), tokens(0.05), tokens(1)
        ), "TimeToExpiryUpperBoundError");
      });

      it("rejects when rate > max rate", async function () {
        const { binary } = await loadFixture(deploy);
        await assertRevertError(binary, binary.getBinaryCallPrice(
          tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.5), tokens(4.01), tokens(1)
        ), "RateUpperBoundError");
      });
    });
  });
});
