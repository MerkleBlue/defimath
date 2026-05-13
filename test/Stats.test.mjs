
import { assert } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
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
  });
});
