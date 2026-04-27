
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { OptionsJS } from "../poc/blackscholes/optionsJS.mjs";
import { assertAbsoluteBelow, assertRevertError, generateRandomTestPoints, generateTestStrikePoints, generateTestTimePoints, MIN_ERROR, SEC_IN_DAY, SEC_IN_YEAR, tokens } from "./Common.test.mjs";

const fastTest = true;

const MAX_BINARY_ABS_ERROR = 2.2e-12; // for a binary option with $100 payout

// JS reference for binary call price
function binaryCallWrapped(spot, strike, timeSec, vol, rate, payout) {
  // handle expired option
  if (timeSec <= 0) {
    return spot > strike ? payout : 0;
  }
  return new OptionsJS().getBinaryCallPrice(spot, strike, timeSec, vol, rate, payout);
}

// JS reference for binary put price
function binaryPutWrapped(spot, strike, timeSec, vol, rate, payout) {
  // handle expired option
  if (timeSec <= 0) {
    return strike > spot ? payout : 0;
  }
  return new OptionsJS().getBinaryPutPrice(spot, strike, timeSec, vol, rate, payout);
}

describe.only("DeFiMathBinary", function () {
  let testTimePoints;
  let testStrikePoints;

  async function deploy() {
    const BinaryWrapper = await ethers.getContractFactory("BinaryWrapper");
    const binary = await BinaryWrapper.deploy();
    return { binary };
  }

  async function deployCompare() {
    const BinaryWrapper = await ethers.getContractFactory("BinaryWrapper");
    const binary = await BinaryWrapper.deploy();

    // Haptic's BlackScholes has public functions, so it must be deployed and linked
    const BlackScholes = await ethers.getContractFactory("contracts/test/compare/derivatives/binary/haptic/BlackScholes.sol:BlackScholes");
    const blackScholes = await BlackScholes.deploy();

    const AdapterHaptic = await ethers.getContractFactory("AdapterHaptic", {
      libraries: { "contracts/test/compare/derivatives/binary/haptic/BlackScholes.sol:BlackScholes": await blackScholes.getAddress() },
    });
    const adapterHaptic = await AdapterHaptic.deploy();

    return { binary, adapterHaptic };
  }

  async function testBinaryRange(strikePoints, timePoints, volPoints, ratePoints, isCall, maxAbsError = MAX_BINARY_ABS_ERROR, multi = 10, payout = 100, log = true) {
    const { binary } = await loadFixture(deploy);
    log && console.log("Max abs error: $" + maxAbsError);

    let countTotal = 0, prunedCountSOL = 0;
    const totalPoints = strikePoints.length * timePoints.length * volPoints.length * ratePoints.length;
    let errorsSOL = [];
    for (const strike of strikePoints) {
      for (const exp of timePoints) {
        for (const vol of volPoints) {
          for (const rate of ratePoints) {
            // expected
            const expected = isCall
              ? binaryCallWrapped(100 * multi, strike * multi, exp, vol, rate, payout)
              : binaryPutWrapped(100 * multi, strike * multi, exp, vol, rate, payout);

            // SOL
            const actualSOL = isCall
              ? (await binary.getBinaryCallPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate), tokens(payout))).toString() / 1e18
              : (await binary.getBinaryPutPrice(tokens(100 * multi), tokens(strike * multi), exp, tokens(vol), tokens(rate), tokens(payout))).toString() / 1e18;

            const absErrorSOL = Math.abs(actualSOL - expected);
            const errorParamsSOL = { expiration: exp, strike: strike * multi, vol, rate, payout, act: actualSOL, exp: expected };
            errorsSOL.push({ absErrorSOL, errorParamsSOL });

            countTotal++;

            // print progress and prune errors
            if (countTotal % Math.round(totalPoints / 10) === 0) {
              if (log) {
                const startTime = new Date().getTime();
                errorsSOL.sort((a, b) => b.absErrorSOL - a.absErrorSOL);
                console.log("Progress:", (countTotal / totalPoints * 100).toFixed(0) +
                  "%, Max abs error:", "$" + (errorsSOL[0] ? errorsSOL[0].absErrorSOL.toFixed(12) : "0") +
                  " (" + (new Date().getTime() - startTime) + "mS)");
              }

              const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
              prunedCountSOL += toDelete.length;
              errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);
            }
          }
        }
      }
    }

    const toDelete = errorsSOL.filter(e => e.absErrorSOL < maxAbsError);
    prunedCountSOL += toDelete.length;
    errorsSOL = errorsSOL.filter(e => e.absErrorSOL >= maxAbsError);

    if (log) {
      console.log();
      console.log("REPORT SOL");
      console.log("Errors Abs/Total: " + prunedCountSOL + "/" + countTotal, "(" + ((prunedCountSOL / countTotal) * 100).toFixed(2) + "%)");
      if (errorsSOL[0]) console.log("Max abs error params SOL: ", errorsSOL[0]);
    }

    for (let i = 0; i < errorsSOL.length; i++) {
      assert.isBelow(errorsSOL[i].absErrorSOL, maxAbsError);
    }
  }

  before(async () => {
    testTimePoints = generateTestTimePoints();
    testStrikePoints = generateTestStrikePoints(5, 500);
  });

  describe("performance", function () {
    describe("binary call", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryCallPriceMG(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05), tokens(100))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryCallPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate), tokens(100))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("binary put", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        totalGas += parseInt((await binary.getBinaryPutPriceMG(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05), tokens(100))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        let totalGas = 0, count = 0;
        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                totalGas += parseInt((await binary.getBinaryPutPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate), tokens(100))).gasUsed);
                count++;
              }
            }
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });
  });

  describe("functionality", function () {
    describe("binary call", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryCallWrapped(1000, 980, 60 * SEC_IN_DAY, 0.60, 0.05, 100);

        const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(980), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryCallWrapped(1000, strike, time * SEC_IN_DAY, vol, rate, 100);

                const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate), tokens(100))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryRange(strikes, times, vols, rates, true, MAX_BINARY_ABS_ERROR, 10, 100, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 100, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          // spot == strike at expiry: not strictly ITM, returns 0
          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("no volatility multiple strikes and expirations", async function () {
          const { binary } = await loadFixture(deploy);

          const strikes = [200, 800, 1000, 1200, 5000];
          const times = [1, 2, 10, 30, 60, SEC_IN_YEAR, 2 * SEC_IN_YEAR];
          const rates = [0, 0.05, 4];

          for (const strike of strikes) {
            for (const time of times) {
              for (const rate of rates) {
                const expected = binaryCallWrapped(1000, strike, time, 0, rate, 100);

                const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(strike), time, 0, tokens(rate), tokens(100))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
              }
            }
          }
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryRange(strikes, times, vols, rates, true, MAX_BINARY_ABS_ERROR, 10, 100, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryRange(strikes, times, vols, rates, true, MAX_BINARY_ABS_ERROR, 10, 100, !fastTest);
        });
      });

      describe("regression", function () {
        it("handles deep OTM (Φ(d2) → 0)", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryCallWrapped(1000, 1200, 1 * SEC_IN_DAY, 0.40, 0.05, 100);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1200), 1 * SEC_IN_DAY, tokens(0.40), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryCallWrapped(1000, 1020, 1, 0, 0.05, 100);

          const actualSOL = (await binary.getBinaryCallPrice(tokens(1000), tokens(1020), 1, 0, tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

        it("scales linearly with payout", async function () {
          const { binary } = await loadFixture(deploy);

          const args = [tokens(1000), tokens(1000), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05)];
          const price1 = (await binary.getBinaryCallPrice(...args, tokens(1))).toString() / 1e18;
          const price100 = (await binary.getBinaryCallPrice(...args, tokens(100))).toString() / 1e18;
          const price1000 = (await binary.getBinaryCallPrice(...args, tokens(1000))).toString() / 1e18;

          assertAbsoluteBelow(price100, price1 * 100, 1e-6);
          assertAbsoluteBelow(price1000, price1 * 1000, 1e-4);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotLowerBoundError");
          await binary.getBinaryCallPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotUpperBoundError");
          await binary.getBinaryCallPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryCallPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeLowerBoundError");
          await binary.getBinaryCallPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeUpperBoundError");
          await binary.getBinaryCallPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05), tokens(100)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryCallPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05), tokens(100)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15), tokens(100)), "RateUpperBoundError");
          await binary.getBinaryCallPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4), tokens(100));
          await assertRevertError(binary, binary.getBinaryCallPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18), tokens(100)), "RateUpperBoundError");
        });
      });
    });

    describe("binary put", function () {
      it("single", async function () {
        const { binary } = await loadFixture(deploy);
        const expected = binaryPutWrapped(1000, 1020, 60 * SEC_IN_DAY, 0.60, 0.05, 100);

        const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(1020), 60 * SEC_IN_DAY, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
      });

      it("multiple in typical range", async function () {
        const { binary } = await loadFixture(deploy);

        const strikes = [800, 900, 1000.01, 1100, 1200];
        const times = [7, 30, 60, 90, 180];
        const vols = [0.4, 0.6, 0.8];
        const rates = [0.05, 0.1, 0.2];

        for (const strike of strikes) {
          for (const time of times) {
            for (const vol of vols) {
              for (const rate of rates) {
                const expected = binaryPutWrapped(1000, strike, time * SEC_IN_DAY, vol, rate, 100);

                const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate), tokens(100))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
              }
            }
          }
        }
      });

      describe("limits", function () {
        it("limits and near limit values", async function () {
          const strikes = [...testStrikePoints.slice(0, 3), ...testStrikePoints.slice(-3)];
          const times = [...testTimePoints.slice(0, 3), ...testTimePoints.slice(-3)];
          const vols = [0.0001, 0.0001001, 0.0001002, 18.24674407370955, 18.34674407370955, 18.446744073709551];
          const rates = [0, 0.0001, 0.0002, 3.9998, 3.9999, 4];
          await testBinaryRange(strikes, times, vols, rates, false, MAX_BINARY_ABS_ERROR, 10, 100, false);
        });

        it("expired ITM", async function () {
          const { binary } = await loadFixture(deploy);

          // strike > spot at expiry: ITM put, returns full payout
          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(1020), 0, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 100, MIN_ERROR);
        });

        it("expired ATM", async function () {
          const { binary } = await loadFixture(deploy);

          // spot == strike at expiry: not strictly ITM, returns 0
          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(1000), 0, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("expired OTM", async function () {
          const { binary } = await loadFixture(deploy);

          // spot > strike at expiry: OTM put, returns 0
          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(980), 0, tokens(0.60), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, 0, MIN_ERROR);
        });

        it("no volatility multiple strikes and expirations", async function () {
          const { binary } = await loadFixture(deploy);

          const strikes = [200, 800, 1000, 1200, 5000];
          const times = [1, 2, 10, 30, 60, SEC_IN_YEAR, 2 * SEC_IN_YEAR];
          const rates = [0, 0.05, 4];

          for (const strike of strikes) {
            for (const time of times) {
              for (const rate of rates) {
                const expected = binaryPutWrapped(1000, strike, time, 0, rate, 100);

                const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(strike), time, 0, tokens(rate), tokens(100))).toString() / 1e18;
                assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
              }
            }
          }
        });
      });

      describe("random", function () {
        it("lower strikes", async function () {
          const strikes = generateRandomTestPoints(20, 100, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryRange(strikes, times, vols, rates, false, MAX_BINARY_ABS_ERROR, 10, 100, !fastTest);
        });

        it("higher strikes", async function () {
          const strikes = generateRandomTestPoints(100, 500, fastTest ? 10 : 30, false);
          const times = generateRandomTestPoints(1, 2 * SEC_IN_YEAR, fastTest ? 10 : 30, true);
          const vols = generateRandomTestPoints(0.0001, 18.44, fastTest ? 10 : 30, false);
          const rates = [0, 0.1, 0.2, 4];
          await testBinaryRange(strikes, times, vols, rates, false, MAX_BINARY_ABS_ERROR, 10, 100, !fastTest);
        });
      });

      describe("regression", function () {
        it("handles deep OTM (Φ(-d2) → 0)", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryPutWrapped(1000, 800, 1 * SEC_IN_DAY, 0.40, 0.05, 100);

          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(800), 1 * SEC_IN_DAY, tokens(0.40), tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

        it("handles when vol is 0, and time lowest", async function () {
          const { binary } = await loadFixture(deploy);
          const expected = binaryPutWrapped(1000, 980, 1, 0, 0.05, 100);

          const actualSOL = (await binary.getBinaryPutPrice(tokens(1000), tokens(980), 1, 0, tokens(0.05), tokens(100))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_BINARY_ABS_ERROR);
        });

        it("call + put = e^(-r*τ) * payout (parity)", async function () {
          const { binary } = await loadFixture(deploy);

          // Φ(d2) + Φ(-d2) = 1, so binaryCall + binaryPut = payout * e^(-r*τ)
          const args = [tokens(1000), tokens(1100), 30 * SEC_IN_DAY, tokens(0.5), tokens(0.05), tokens(100)];
          const callPrice = (await binary.getBinaryCallPrice(...args)).toString() / 1e18;
          const putPrice = (await binary.getBinaryPutPrice(...args)).toString() / 1e18;
          const expectedDiscount = 100 * Math.exp(-0.05 * 30 / 365);

          assertAbsoluteBelow(callPrice + putPrice, expectedDiscount, MAX_BINARY_ABS_ERROR);
        });
      });

      describe("failure", function () {
        it("rejects when spot < min spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice("999999999999", tokens(930), 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotLowerBoundError");
          await binary.getBinaryPutPrice("1000000000000", "1000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(0), tokens(930), 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotLowerBoundError");
        });

        it("rejects when spot > max spot", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice("1000000000000000000000000000000001", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotUpperBoundError");
          await binary.getBinaryPutPrice("1000000000000000000000000000000000", "1000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryPutPrice("100000000000000000000000000000000000", "100000000000000000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100)), "SpotUpperBoundError");
        });

        it("rejects when strike < spot / 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), "199999999999999999999", 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeLowerBoundError");
          await binary.getBinaryPutPrice(tokens(1000), "200000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), "0", 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeLowerBoundError");
        });

        it("rejects when strike > spot * 5", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), "5000000000000000000001", 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeUpperBoundError");
          await binary.getBinaryPutPrice(tokens(1000), "5000000000000000000000", 50000, tokens(0.6), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(100000), 50000, tokens(0.6), tokens(0.05), tokens(100)), "StrikeUpperBoundError");
        });

        it("rejects when time > max time", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 63072001, tokens(0.60), tokens(0.05), tokens(100)), "TimeToExpiryUpperBoundError");
          await binary.getBinaryPutPrice(tokens(1000), tokens(930), 63072000, tokens(0.60), tokens(0.05), tokens(100));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 4294967295, tokens(0.60), tokens(0.05), tokens(100)), "TimeToExpiryUpperBoundError");
        });

        it("rejects when rate > max rate", async function () {
          const { binary } = await loadFixture(deploy);

          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4 + 1e-15), tokens(100)), "RateUpperBoundError");
          await binary.getBinaryPutPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(4), tokens(100));
          await assertRevertError(binary, binary.getBinaryPutPrice(tokens(1000), tokens(930), 50000, tokens(0.6), tokens(18), tokens(100)), "RateUpperBoundError");
        });
      });
    });
  });

  describe("compare", function () {
    it("call", async function () {
      const { binary, adapterHaptic } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0;
      let avgGas1 = 0, avgGas2 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              // payout = 1 for fair comparison (Haptic returns unit-payout price)
              const expected = binaryCallWrapped(1000, strike, time * SEC_IN_DAY, vol, rate, 1);

              // DeFiMath
              const result1 = await binary.getBinaryCallPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate), tokens(1));
              const price1 = result1.price.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);

              // Haptic
              const result2 = await adapterHaptic.callPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2.price.toString() / 1e18;
              avgGas2 += parseInt(result2.gasUsed);

              count++;
              const error1 = Math.abs(price1 - expected);
              const error2 = Math.abs(price2 - expected);
              maxError1 = Math.max(maxError1, error1);
              maxError2 = Math.max(maxError2, error2);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Haptic");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "    " + (avgGas2 / count).toFixed(0));
    });

    it("put", async function () {
      const { binary, adapterHaptic } = await loadFixture(deployCompare);

      const strikes = [800, 900, 1000.01, 1100, 1200];
      const times = [7, 30, 60, 90, 180];
      const vols = [0.4, 0.6, 0.8];
      const rates = [0.05, 0.1, 0.2];

      let maxError1 = 0, maxError2 = 0;
      let avgGas1 = 0, avgGas2 = 0;
      let count = 0;

      for (const strike of strikes) {
        for (const time of times) {
          for (const vol of vols) {
            for (const rate of rates) {
              // payout = 1 for fair comparison (Haptic returns unit-payout price)
              const expected = binaryPutWrapped(1000, strike, time * SEC_IN_DAY, vol, rate, 1);

              // DeFiMath
              const result1 = await binary.getBinaryPutPriceMG(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate), tokens(1));
              const price1 = result1.price.toString() / 1e18;
              avgGas1 += parseInt(result1.gasUsed);

              // Haptic
              const result2 = await adapterHaptic.putPrice(tokens(1000), tokens(strike), time * SEC_IN_DAY, tokens(vol), tokens(rate));
              const price2 = result2.price.toString() / 1e18;
              avgGas2 += parseInt(result2.gasUsed);

              count++;
              const error1 = Math.abs(price1 - expected);
              const error2 = Math.abs(price2 - expected);
              maxError1 = Math.max(maxError1, error1);
              maxError2 = Math.max(maxError2, error2);
            }
          }
        }
      }
      console.log("Metric         DeFiMath  Haptic");
      console.log("Max abs error  ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1));
      console.log("Avg gas           ", (avgGas1 / count).toFixed(0), "    " + (avgGas2 / count).toFixed(0));
    });
  });
});
