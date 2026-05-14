
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import * as ss from "simple-statistics";
import { assertAbsoluteBelow, assertRelativeBelow, assertRevertError, tokens } from "./Common.test.mjs";

const MAX_REL_ERROR_SQRT = 2.2e-14;   // inherits sqrt's relative error
const MAX_REL_ERROR_AGG = 1e-15;       // arithmetic-only operations: essentially exact

// JS reference helpers
function jsMean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function jsStdDev(arr) {
  const m = jsMean(arr);
  const sumSq = arr.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return Math.sqrt(sumSq / (arr.length - 1));
}
function jsWeightedAverage(values, weights) {
  let sumProducts = 0, sumWeights = 0;
  for (let i = 0; i < values.length; i++) {
    sumProducts += values[i] * weights[i];
    sumWeights += weights[i];
  }
  return sumProducts / sumWeights;
}
function jsHistoricalVolatility(prices, intervalSec) {
  const SEC_PER_YEAR = 31536000;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (n - 1);
  const periodStdDev = Math.sqrt(variance);
  return periodStdDev * Math.sqrt(SEC_PER_YEAR / intervalSec);
}
function jsMaxDrawdown(equity) {
  let peak = equity[0];
  let maxDD = 0;
  for (let i = 1; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    else {
      const dd = (peak - equity[i]) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}
function jsLogReturns(prices) {
  const r = [];
  for (let i = 1; i < prices.length; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  return r;
}
function jsValueAtRisk(prices, confidence) {
  // Reference: simple-statistics.quantile (NumPy method='linear' convention)
  // idx = (1 - α) · (n - 1) with linear interpolation between sorted neighbors
  return ss.quantile(jsLogReturns(prices), 1 - confidence);
}
function jsConditionalValueAtRisk(prices, confidence) {
  // Floor-based tail mean: average of the k+1 smallest, where k = floor((1-α)·(n-1))
  const sorted = jsLogReturns(prices).slice().sort((a, b) => a - b);
  const n = sorted.length;
  let k = Math.floor((1 - confidence) * (n - 1));
  if (k >= n) k = n - 1;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += sorted[i];
  return sum / (k + 1);
}
function jsSharpeRatio(prices, intervalSec, rfAnnual) {
  const SEC_PER_YEAR = 31536000;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const n = returns.length;
  const periodMean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((acc, r) => acc + (r - periodMean) ** 2, 0) / (n - 1);
  const periodStdDev = Math.sqrt(variance);
  const factor = SEC_PER_YEAR / intervalSec;
  const meanAnnual = periodMean * factor;
  const stdDevAnnual = periodStdDev * Math.sqrt(factor);
  return (meanAnnual - rfAnnual) / stdDevAnnual;
}

describe("DeFiMathStats", function () {

  async function deploy() {
    const StatsWrapper = await ethers.getContractFactory("StatsWrapper");
    const stats = await StatsWrapper.deploy();
    return { stats };
  }

  describe("performance", function () {
    describe("geometricMean", function () {
      it("single", async function () {
        const { stats } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.geometricMeanMG(tokens(100), tokens(400))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("multiple in typical range", async function () {
        const { stats } = await loadFixture(deploy);
        const pairs = [[100, 400], [1000, 1000], [0.5, 2], [1e6, 1e6], [1, 1e9]];
        let totalGas = 0, count = 0;
        for (const [a, b] of pairs) {
          totalGas += parseInt((await stats.geometricMeanMG(tokens(a), tokens(b))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("weightedAverage", function () {
      it("10-element array", async function () {
        const { stats } = await loadFixture(deploy);
        const values = Array.from({ length: 10 }, (_, i) => tokens(100 + i));
        const weights = Array.from({ length: 10 }, () => tokens(1));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.weightedAverageMG(values, weights)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100-element array", async function () {
        const { stats } = await loadFixture(deploy);
        const values = Array.from({ length: 100 }, (_, i) => tokens(100 + i));
        const weights = Array.from({ length: 100 }, () => tokens(1));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.weightedAverageMG(values, weights)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("mean", function () {
      it("10-element array", async function () {
        const { stats } = await loadFixture(deploy);
        const values = Array.from({ length: 10 }, (_, i) => tokens(100 + i));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.meanMG(values)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100-element array", async function () {
        const { stats } = await loadFixture(deploy);
        const values = Array.from({ length: 100 }, (_, i) => tokens(100 + i));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.meanMG(values)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("stdDev", function () {
      it("10-element array", async function () {
        const { stats } = await loadFixture(deploy);
        const values = Array.from({ length: 10 }, (_, i) => tokens(100 + i));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.stdDevMG(values)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100-element array", async function () {
        const { stats } = await loadFixture(deploy);
        const values = Array.from({ length: 100 }, (_, i) => tokens(100 + i));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.stdDevMG(values)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("historicalVolatility", function () {
      it("30 daily prices", async function () {
        const { stats } = await loadFixture(deploy);
        // simulate 30 daily prices with small random walks around 100
        const prices = [100, 101.2, 100.5, 102.1, 101.8, 102.5, 103.1, 102.8, 103.5, 104.2,
                        103.8, 104.5, 105.1, 104.8, 105.5, 106.2, 105.8, 106.5, 107.1, 106.8,
                        107.5, 108.2, 107.8, 108.5, 109.1, 108.8, 109.5, 110.2, 109.8, 110.5]
                       .map(p => tokens(p));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.historicalVolatilityMG(prices, 86400)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100 daily prices", async function () {
        const { stats } = await loadFixture(deploy);
        // generate 100 prices via simple cosine pattern around 100
        const prices = Array.from({ length: 100 }, (_, i) => tokens(100 + 5 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.historicalVolatilityMG(prices, 86400)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("sharpeRatio", function () {
      it("30 daily prices, 5% rf", async function () {
        const { stats } = await loadFixture(deploy);
        const prices = [100, 101.2, 100.5, 102.1, 101.8, 102.5, 103.1, 102.8, 103.5, 104.2,
                        103.8, 104.5, 105.1, 104.8, 105.5, 106.2, 105.8, 106.5, 107.1, 106.8,
                        107.5, 108.2, 107.8, 108.5, 109.1, 108.8, 109.5, 110.2, 109.8, 110.5]
                       .map(p => tokens(p));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.sharpeRatioMG(prices, 86400, tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100 daily prices, 5% rf", async function () {
        const { stats } = await loadFixture(deploy);
        const prices = Array.from({ length: 100 }, (_, i) => tokens(100 + 5 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.sharpeRatioMG(prices, 86400, tokens(0.05))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("maxDrawdown", function () {
      it("30 prices", async function () {
        const { stats } = await loadFixture(deploy);
        const equity = Array.from({ length: 30 }, (_, i) => tokens(100 + 5 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.maxDrawdownMG(equity)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100 prices", async function () {
        const { stats } = await loadFixture(deploy);
        const equity = Array.from({ length: 100 }, (_, i) => tokens(100 + 5 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.maxDrawdownMG(equity)).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("valueAtRisk", function () {
      it("30 daily prices, 95% confidence", async function () {
        const { stats } = await loadFixture(deploy);
        const prices = Array.from({ length: 30 }, (_, i) => tokens(100 + 2 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.valueAtRiskMG(prices, tokens(0.95))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100 daily prices, 95% confidence", async function () {
        const { stats } = await loadFixture(deploy);
        const prices = Array.from({ length: 100 }, (_, i) => tokens(100 + 5 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.valueAtRiskMG(prices, tokens(0.95))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("conditionalValueAtRisk", function () {
      it("30 daily prices, 95% confidence", async function () {
        const { stats } = await loadFixture(deploy);
        const prices = Array.from({ length: 30 }, (_, i) => tokens(100 + 2 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.conditionalValueAtRiskMG(prices, tokens(0.95))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("100 daily prices, 95% confidence", async function () {
        const { stats } = await loadFixture(deploy);
        const prices = Array.from({ length: 100 }, (_, i) => tokens(100 + 5 * Math.cos(i * 0.3)));
        let totalGas = 0, count = 0;
        totalGas += parseInt((await stats.conditionalValueAtRiskMG(prices, tokens(0.95))).gasUsed);
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });
  });

  describe("functionality", function () {
    describe("geometricMean", function () {
      it("sqrt(a · b) for known inputs", async function () {
        const { stats } = await loadFixture(deploy);
        // sqrt(100 · 400) = sqrt(40000) = 200
        const actual = (await stats.geometricMean(tokens(100), tokens(400))).toString() / 1e18;
        assertRelativeBelow(actual, 200, MAX_REL_ERROR_SQRT);
      });

      it("returns a when a == b", async function () {
        const { stats } = await loadFixture(deploy);
        const actual = (await stats.geometricMean(tokens(1000), tokens(1000))).toString() / 1e18;
        assertRelativeBelow(actual, 1000, MAX_REL_ERROR_SQRT);
      });

      it("returns 0 when either input is 0", async function () {
        const { stats } = await loadFixture(deploy);
        const actualA = (await stats.geometricMean(0, tokens(100))).toString() / 1e18;
        assert.equal(actualA, 0);
        const actualB = (await stats.geometricMean(tokens(100), 0)).toString() / 1e18;
        assert.equal(actualB, 0);
      });

      it("typical range", async function () {
        const { stats } = await loadFixture(deploy);
        const pairs = [[1, 4], [0.5, 2], [100, 1000], [1e-6, 1e-2], [1e6, 1e9]];
        for (const [a, b] of pairs) {
          const expected = Math.sqrt(a * b);
          const actual = (await stats.geometricMean(tokens(a), tokens(b))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
        }
      });

      describe("failure", function () {
        it("rejects when a exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.geometricMean("1000000000000000000000000000000001", tokens(100)), "ValueUpperBoundError");
        });

        it("rejects when b exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.geometricMean(tokens(100), "1000000000000000000000000000000001"), "ValueUpperBoundError");
        });
      });
    });

    describe("weightedAverage", function () {
      it("equal weights reduce to arithmetic mean", async function () {
        const { stats } = await loadFixture(deploy);
        const values = [10, 20, 30, 40].map(v => tokens(v));
        const weights = [1, 1, 1, 1].map(w => tokens(w));
        const expected = jsMean([10, 20, 30, 40]);  // 25
        const actual = (await stats.weightedAverage(values, weights)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      it("weighted average with varying weights", async function () {
        const { stats } = await loadFixture(deploy);
        const valuesJS = [100, 200, 300];
        const weightsJS = [1, 2, 3];
        const expected = jsWeightedAverage(valuesJS, weightsJS);  // 233.33...
        const values = valuesJS.map(v => tokens(v));
        const weights = weightsJS.map(w => tokens(w));
        const actual = (await stats.weightedAverage(values, weights)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      it("single-element array returns the value", async function () {
        const { stats } = await loadFixture(deploy);
        const actual = (await stats.weightedAverage([tokens(42)], [tokens(7)])).toString() / 1e18;
        assert.equal(actual, 42);
      });

      it("zero weights are skipped (effectively)", async function () {
        const { stats } = await loadFixture(deploy);
        // Weights [0, 1, 0]: only middle value counts
        const values = [100, 200, 300].map(v => tokens(v));
        const weights = [0, tokens(1), 0];
        const actual = (await stats.weightedAverage(values, weights)).toString() / 1e18;
        assert.equal(actual, 200);
      });

      it("100-element array against JS reference", async function () {
        const { stats } = await loadFixture(deploy);
        const valuesJS = Array.from({ length: 100 }, (_, i) => 1 + i * 0.5);
        const weightsJS = Array.from({ length: 100 }, (_, i) => 1 + (i % 5));
        const expected = jsWeightedAverage(valuesJS, weightsJS);
        const values = valuesJS.map(v => tokens(v));
        const weights = weightsJS.map(w => tokens(w));
        const actual = (await stats.weightedAverage(values, weights)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      describe("failure", function () {
        it("rejects when arrays empty", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.weightedAverage([], []), "ArrayLengthLowerBoundError");
        });

        it("rejects when arrays mismatched in length", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.weightedAverage([tokens(1), tokens(2)], [tokens(1)]), "ArrayLengthMismatchError");
        });

        it("rejects when array length exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          const big = Array.from({ length: 1025 }, () => tokens(1));
          await assertRevertError(stats, stats.weightedAverage(big, big), "ArrayLengthUpperBoundError");
        });

        it("rejects when all weights are zero", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.weightedAverage([tokens(1), tokens(2)], [0, 0]), "WeightSumZeroError");
        });

        it("rejects when a value exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.weightedAverage(["1000000000000000000000000000000001"], [tokens(1)]), "ValueUpperBoundError");
        });
      });
    });

    describe("mean", function () {
      it("simple arithmetic mean", async function () {
        const { stats } = await loadFixture(deploy);
        const values = [10, 20, 30, 40].map(v => tokens(v));
        const actual = (await stats.mean(values)).toString() / 1e18;
        assert.equal(actual, 25);
      });

      it("single-element array returns the value", async function () {
        const { stats } = await loadFixture(deploy);
        const actual = (await stats.mean([tokens(42)])).toString() / 1e18;
        assert.equal(actual, 42);
      });

      it("array of zeros returns zero", async function () {
        const { stats } = await loadFixture(deploy);
        const actual = (await stats.mean([0, 0, 0])).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("100-element array against JS reference", async function () {
        const { stats } = await loadFixture(deploy);
        const valuesJS = Array.from({ length: 100 }, (_, i) => 1 + i * 0.5);
        const expected = jsMean(valuesJS);
        const values = valuesJS.map(v => tokens(v));
        const actual = (await stats.mean(values)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      describe("failure", function () {
        it("rejects when array empty", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.mean([]), "ArrayLengthLowerBoundError");
        });

        it("rejects when array length exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          const big = Array.from({ length: 1025 }, () => tokens(1));
          await assertRevertError(stats, stats.mean(big), "ArrayLengthUpperBoundError");
        });

        it("rejects when a value exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.mean(["1000000000000000000000000000000001"]), "ValueUpperBoundError");
        });
      });
    });

    describe("stdDev", function () {
      it("two-element array (smallest sample)", async function () {
        const { stats } = await loadFixture(deploy);
        // stdDev([10, 14]) = sqrt((4+4)/1) = sqrt(8) ≈ 2.828
        const values = [10, 14].map(v => tokens(v));
        const expected = jsStdDev([10, 14]);
        const actual = (await stats.stdDev(values)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("array of equal values returns 0", async function () {
        const { stats } = await loadFixture(deploy);
        const values = [100, 100, 100, 100].map(v => tokens(v));
        const actual = (await stats.stdDev(values)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("known std-dev case", async function () {
        const { stats } = await loadFixture(deploy);
        // Sample [2, 4, 4, 4, 5, 5, 7, 9] has sample stdDev = 2 (textbook example)
        const valuesJS = [2, 4, 4, 4, 5, 5, 7, 9];
        const expected = jsStdDev(valuesJS);  // 2.138... (actually std dev of this sample is 2 with n-1)
        const values = valuesJS.map(v => tokens(v));
        const actual = (await stats.stdDev(values)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("100-element array against JS reference", async function () {
        const { stats } = await loadFixture(deploy);
        const valuesJS = Array.from({ length: 100 }, (_, i) => 1 + i * 0.5);
        const expected = jsStdDev(valuesJS);
        const values = valuesJS.map(v => tokens(v));
        const actual = (await stats.stdDev(values)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      describe("failure", function () {
        it("rejects when array empty", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.stdDev([]), "ArrayLengthLowerBoundError");
        });

        it("rejects when array has only one element", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.stdDev([tokens(1)]), "ArrayLengthLowerBoundError");
        });

        it("rejects when array length exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          const big = Array.from({ length: 1025 }, () => tokens(1));
          await assertRevertError(stats, stats.stdDev(big), "ArrayLengthUpperBoundError");
        });

        it("rejects when a value exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.stdDev(["1000000000000000000000000000000001", tokens(1)]), "ValueUpperBoundError");
        });
      });
    });

    describe("historicalVolatility", function () {
      const SEC_PER_DAY = 86400;
      const SEC_PER_YEAR_LOCAL = 31536000;

      it("constant prices return 0 volatility", async function () {
        const { stats } = await loadFixture(deploy);
        const prices = [100, 100, 100, 100, 100].map(p => tokens(p));
        const actual = (await stats.historicalVolatility(prices, SEC_PER_DAY)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("minimum sample size (3 prices, 2 returns)", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = [100, 105, 102];
        const expected = jsHistoricalVolatility(pricesJS, SEC_PER_DAY);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.historicalVolatility(prices, SEC_PER_DAY)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("daily prices, 1-day interval, against JS reference", async function () {
        const { stats } = await loadFixture(deploy);
        // 30 daily price observations with realistic-ish returns
        const pricesJS = [100, 101.2, 100.5, 102.1, 101.8, 102.5, 103.1, 102.8, 103.5, 104.2,
                          103.8, 104.5, 105.1, 104.8, 105.5, 106.2, 105.8, 106.5, 107.1, 106.8,
                          107.5, 108.2, 107.8, 108.5, 109.1, 108.8, 109.5, 110.2, 109.8, 110.5];
        const expected = jsHistoricalVolatility(pricesJS, SEC_PER_DAY);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.historicalVolatility(prices, SEC_PER_DAY)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("hourly prices, 3600-sec interval", async function () {
        const { stats } = await loadFixture(deploy);
        // 50 hourly observations
        const pricesJS = Array.from({ length: 50 }, (_, i) => 100 + 2 * Math.sin(i * 0.4));
        const expected = jsHistoricalVolatility(pricesJS, 3600);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.historicalVolatility(prices, 3600)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("yearly prices: factor = 1, annualizedVol == periodStdDev", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = [100, 110, 105, 120, 115];
        const expected = jsHistoricalVolatility(pricesJS, SEC_PER_YEAR_LOCAL);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.historicalVolatility(prices, SEC_PER_YEAR_LOCAL)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("declining-price series (negative log returns)", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = [100, 95, 92, 88, 85, 80];
        const expected = jsHistoricalVolatility(pricesJS, SEC_PER_DAY);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.historicalVolatility(prices, SEC_PER_DAY)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("100-element array against JS reference", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = Array.from({ length: 100 }, (_, i) => 100 + 5 * Math.cos(i * 0.3));
        const expected = jsHistoricalVolatility(pricesJS, SEC_PER_DAY);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.historicalVolatility(prices, SEC_PER_DAY)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      describe("failure", function () {
        it("rejects when prices array has fewer than 3 entries", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.historicalVolatility([], 86400), "ArrayLengthLowerBoundError");
          await assertRevertError(stats, stats.historicalVolatility([tokens(100)], 86400), "ArrayLengthLowerBoundError");
          await assertRevertError(stats, stats.historicalVolatility([tokens(100), tokens(101)], 86400), "ArrayLengthLowerBoundError");
        });

        it("rejects when array length exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          const big = Array.from({ length: 1025 }, () => tokens(100));
          await assertRevertError(stats, stats.historicalVolatility(big, 86400), "ArrayLengthUpperBoundError");
        });

        it("rejects when intervalSec is 0", async function () {
          const { stats } = await loadFixture(deploy);
          const prices = [100, 105, 102].map(p => tokens(p));
          await assertRevertError(stats, stats.historicalVolatility(prices, 0), "IntervalLowerBoundError");
        });

        it("rejects when any price is 0", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.historicalVolatility([0, tokens(100), tokens(101)], 86400), "PriceLowerBoundError");
          await assertRevertError(stats, stats.historicalVolatility([tokens(100), 0, tokens(101)], 86400), "PriceLowerBoundError");
          await assertRevertError(stats, stats.historicalVolatility([tokens(100), tokens(101), 0], 86400), "PriceLowerBoundError");
        });

        it("rejects when a price exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.historicalVolatility(["1000000000000000000000000000000001", tokens(100), tokens(101)], 86400), "ValueUpperBoundError");
        });
      });
    });

    describe("sharpeRatio", function () {
      const SEC_PER_DAY = 86400;
      const SEC_PER_YEAR_LOCAL = 31536000;

      it("positive Sharpe for upward trend with low rf", async function () {
        const { stats } = await loadFixture(deploy);
        // 30 prices trending upward + some noise
        const pricesJS = [100, 101.2, 100.5, 102.1, 101.8, 102.5, 103.1, 102.8, 103.5, 104.2,
                          103.8, 104.5, 105.1, 104.8, 105.5, 106.2, 105.8, 106.5, 107.1, 106.8,
                          107.5, 108.2, 107.8, 108.5, 109.1, 108.8, 109.5, 110.2, 109.8, 110.5];
        const rfAnnual = 0.05;
        const expected = jsSharpeRatio(pricesJS, SEC_PER_DAY, rfAnnual);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.sharpeRatio(prices, SEC_PER_DAY, tokens(rfAnnual))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
        assert.isAbove(actual, 0, "Sharpe should be positive for upward trend");
      });

      it("negative Sharpe for downward trend", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = [110, 105, 102, 98, 95, 90, 88, 85, 82, 80];
        const rfAnnual = 0.05;
        const expected = jsSharpeRatio(pricesJS, SEC_PER_DAY, rfAnnual);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.sharpeRatio(prices, SEC_PER_DAY, tokens(rfAnnual))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
        assert.isBelow(actual, 0, "Sharpe should be negative for downward trend");
      });

      it("zero rf produces same sign as mean return", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = [100, 102, 101, 103, 102, 104, 103, 105];
        const expected = jsSharpeRatio(pricesJS, SEC_PER_DAY, 0);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.sharpeRatio(prices, SEC_PER_DAY, 0)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("hourly prices, 3600-sec interval", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = Array.from({ length: 50 }, (_, i) => 100 + 2 * Math.sin(i * 0.4) + i * 0.05);
        const rfAnnual = 0.03;
        const expected = jsSharpeRatio(pricesJS, 3600, rfAnnual);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.sharpeRatio(prices, 3600, tokens(rfAnnual))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("100-element array against JS reference", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = Array.from({ length: 100 }, (_, i) => 100 + 5 * Math.cos(i * 0.3) + i * 0.1);
        const rfAnnual = 0.04;
        const expected = jsSharpeRatio(pricesJS, SEC_PER_DAY, rfAnnual);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.sharpeRatio(prices, SEC_PER_DAY, tokens(rfAnnual))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      describe("failure", function () {
        it("rejects when prices array has fewer than 3 entries", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.sharpeRatio([tokens(100), tokens(101)], 86400, tokens(0.05)), "ArrayLengthLowerBoundError");
        });

        it("rejects when array length exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          const big = Array.from({ length: 1025 }, () => tokens(100));
          await assertRevertError(stats, stats.sharpeRatio(big, 86400, tokens(0.05)), "ArrayLengthUpperBoundError");
        });

        it("rejects when intervalSec is 0", async function () {
          const { stats } = await loadFixture(deploy);
          const prices = [100, 105, 102].map(p => tokens(p));
          await assertRevertError(stats, stats.sharpeRatio(prices, 0, tokens(0.05)), "IntervalLowerBoundError");
        });

        it("rejects when rf exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          const prices = [100, 105, 102].map(p => tokens(p));
          await assertRevertError(stats, stats.sharpeRatio(prices, SEC_PER_DAY, "4000000000000000001"), "RateUpperBoundError");
        });

        it("rejects when stdDev = 0 (constant prices)", async function () {
          const { stats } = await loadFixture(deploy);
          const prices = [100, 100, 100, 100].map(p => tokens(p));
          await assertRevertError(stats, stats.sharpeRatio(prices, SEC_PER_DAY, tokens(0.05)), "VolatilityZeroError");
        });

        it("rejects when any price is 0", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.sharpeRatio([0, tokens(100), tokens(101)], 86400, tokens(0.05)), "PriceLowerBoundError");
        });
      });
    });

    describe("maxDrawdown", function () {
      it("monotonically increasing equity → 0 drawdown", async function () {
        const { stats } = await loadFixture(deploy);
        const equity = [100, 101, 102, 103, 105, 110].map(v => tokens(v));
        const actual = (await stats.maxDrawdown(equity)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("known case: 100 → 50 → 80 → drawdown = 50%", async function () {
        const { stats } = await loadFixture(deploy);
        const equity = [100, 50, 80].map(v => tokens(v));
        const expected = 0.5;
        const actual = (await stats.maxDrawdown(equity)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      it("two drawdowns: takes the deeper one", async function () {
        const { stats } = await loadFixture(deploy);
        // 100 → 90 → 110 → 60 (the 110→60 is deeper, 50/110 ≈ 0.4545)
        const equity = [100, 90, 110, 60].map(v => tokens(v));
        const expected = jsMaxDrawdown([100, 90, 110, 60]);
        const actual = (await stats.maxDrawdown(equity)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      it("declining series: drawdown = (first - last) / first", async function () {
        const { stats } = await loadFixture(deploy);
        const equityJS = [100, 80, 60, 40, 20];
        const expected = jsMaxDrawdown(equityJS);  // 0.8
        const equity = equityJS.map(v => tokens(v));
        const actual = (await stats.maxDrawdown(equity)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      it("100-element noisy series against JS reference", async function () {
        const { stats } = await loadFixture(deploy);
        const equityJS = Array.from({ length: 100 }, (_, i) => 100 + 10 * Math.cos(i * 0.2) + i * 0.3);
        const expected = jsMaxDrawdown(equityJS);
        const equity = equityJS.map(v => tokens(v));
        const actual = (await stats.maxDrawdown(equity)).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_AGG);
      });

      describe("failure", function () {
        it("rejects when array has fewer than 2 entries", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.maxDrawdown([]), "ArrayLengthLowerBoundError");
          await assertRevertError(stats, stats.maxDrawdown([tokens(100)]), "ArrayLengthLowerBoundError");
        });

        it("rejects when array exceeds max length", async function () {
          const { stats } = await loadFixture(deploy);
          const big = Array.from({ length: 1025 }, () => tokens(100));
          await assertRevertError(stats, stats.maxDrawdown(big), "ArrayLengthUpperBoundError");
        });

        it("rejects when any equity is 0", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.maxDrawdown([0, tokens(100)]), "PriceLowerBoundError");
          await assertRevertError(stats, stats.maxDrawdown([tokens(100), 0]), "PriceLowerBoundError");
        });

        it("rejects when equity exceeds max", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.maxDrawdown(["1000000000000000000000000000000001", tokens(100)]), "ValueUpperBoundError");
        });
      });
    });

    describe("valueAtRisk", function () {
      it("95% VaR on known series matches JS", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = [100, 101, 99, 103, 98, 105, 95, 110, 90, 100,
                          102, 98, 105, 97, 100, 103, 96, 105, 99, 102];
        const expected = jsValueAtRisk(pricesJS, 0.95);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.valueAtRisk(prices, tokens(0.95))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("99% VaR is lower (more negative) than 95% VaR", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = Array.from({ length: 50 }, (_, i) => 100 + 5 * Math.cos(i * 0.5) - i * 0.1);
        const prices = pricesJS.map(p => tokens(p));
        const var95 = (await stats.valueAtRisk(prices, tokens(0.95))).toString() / 1e18;
        const var99 = (await stats.valueAtRisk(prices, tokens(0.99))).toString() / 1e18;
        assert.isAtMost(var99, var95, "99% VaR should be ≤ 95% VaR (more conservative)");
      });

      it("matches JS reference on 100-price series", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = Array.from({ length: 100 }, (_, i) => 100 + 5 * Math.cos(i * 0.3) + Math.sin(i));
        const expected = jsValueAtRisk(pricesJS, 0.95);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.valueAtRisk(prices, tokens(0.95))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      describe("failure", function () {
        it("rejects when confidence is 0", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.valueAtRisk([tokens(100), tokens(101)], 0), "ConfidenceOutOfRangeError");
        });

        it("rejects when confidence >= 1", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.valueAtRisk([tokens(100), tokens(101)], tokens(1)), "ConfidenceOutOfRangeError");
          await assertRevertError(stats, stats.valueAtRisk([tokens(100), tokens(101)], "1000000000000000001"), "ConfidenceOutOfRangeError");
        });

        it("rejects when array has fewer than 2 prices", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.valueAtRisk([tokens(100)], tokens(0.95)), "ArrayLengthLowerBoundError");
        });

        it("rejects when any price is 0", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.valueAtRisk([0, tokens(101)], tokens(0.95)), "PriceLowerBoundError");
        });
      });
    });

    describe("conditionalValueAtRisk", function () {
      it("matches JS reference on known series", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = [100, 101, 99, 103, 98, 105, 95, 110, 90, 100,
                          102, 98, 105, 97, 100, 103, 96, 105, 99, 102];
        const expected = jsConditionalValueAtRisk(pricesJS, 0.95);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.conditionalValueAtRisk(prices, tokens(0.95))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      it("CVaR is ≤ VaR (more conservative)", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = Array.from({ length: 50 }, (_, i) => 100 + 5 * Math.cos(i * 0.5) - i * 0.1);
        const prices = pricesJS.map(p => tokens(p));
        const v = (await stats.valueAtRisk(prices, tokens(0.95))).toString() / 1e18;
        const c = (await stats.conditionalValueAtRisk(prices, tokens(0.95))).toString() / 1e18;
        assert.isAtMost(c, v, "CVaR should be ≤ VaR (CVaR averages tail returns ≤ VaR)");
      });

      it("matches JS reference on 100-price series", async function () {
        const { stats } = await loadFixture(deploy);
        const pricesJS = Array.from({ length: 100 }, (_, i) => 100 + 5 * Math.cos(i * 0.3) + Math.sin(i));
        const expected = jsConditionalValueAtRisk(pricesJS, 0.95);
        const prices = pricesJS.map(p => tokens(p));
        const actual = (await stats.conditionalValueAtRisk(prices, tokens(0.95))).toString() / 1e18;
        assertRelativeBelow(actual, expected, MAX_REL_ERROR_SQRT);
      });

      describe("failure", function () {
        it("rejects when confidence is 0", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.conditionalValueAtRisk([tokens(100), tokens(101)], 0), "ConfidenceOutOfRangeError");
        });

        it("rejects when confidence >= 1", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.conditionalValueAtRisk([tokens(100), tokens(101)], tokens(1)), "ConfidenceOutOfRangeError");
        });

        it("rejects when array has fewer than 2 prices", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.conditionalValueAtRisk([tokens(100)], tokens(0.95)), "ArrayLengthLowerBoundError");
        });

        it("rejects when any price is 0", async function () {
          const { stats } = await loadFixture(deploy);
          await assertRevertError(stats, stats.conditionalValueAtRisk([0, tokens(101)], tokens(0.95)), "PriceLowerBoundError");
        });
      });
    });
  });
});
