
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import bs from "black-scholes";
import erf from 'math-erf';
import { assertAbsoluteBelow, assertRelativeBelow, assertRevertError, tokens } from "./Common.test.mjs";
import { assert } from "chai";

const MAX_REL_ERROR_EXP_POS = 5.4e-14;
const MAX_REL_ERROR_LN = 1.6e-15;
const MAX_REL_ERROR_SQRT = 2.2e-14;

// Random helpers for the bit-level math functions (mulDiv, abs, min, max, clamp, avg).
// Each call picks a random bit-length in [0, 256] then fills that many random bits,
// so magnitudes are sampled logarithmically across the full uint256 / int256 range.
function randomUint256() {
  const bits = Math.floor(Math.random() * 257);
  if (bits === 0) return 0n;
  let n = 0n;
  let remaining = bits;
  while (remaining > 0) {
    const chunkBits = Math.min(remaining, 30);
    const chunk = BigInt(Math.floor(Math.random() * (1 << chunkBits)));
    n = (n << BigInt(chunkBits)) | chunk;
    remaining -= chunkBits;
  }
  return n;
}
function randomInt256() {
  const u = randomUint256();
  const INT_MAX = (1n << 255n) - 1n;
  // Treat the high bit as the sign — wraps a uniform uint256 into a signed value
  return u > INT_MAX ? u - (1n << 256n) : u;
}
const MAX_REL_ERROR_SQRT_TIME = 9e-15;
const MAX_REL_ERROR_CBRT = 1e-14;
const MAX_ABS_ERROR_ERF = 4.5e-9;
const MAX_ABS_ERROR_CDF = 6.4e-15;
const MAX_REL_ERROR_POW = 1e-11;

describe("DeFiMath", function () {

  async function deploy() {
    const MathWrapper = await ethers.getContractFactory("MathWrapper");
    const deFiMath = await MathWrapper.deploy();

    return { deFiMath };
  }

  describe("performance", function () {
    describe("exp", function () {
      it("exp when x in [0, 135]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0; x < 0.03125; x += 0.0003125212) { 
          totalGas += parseInt((await deFiMath.expMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 0.03125; x < 1; x += 0.01012) { 
          totalGas += parseInt((await deFiMath.expMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1; x < 32; x += 0.32087) { 
          totalGas += parseInt((await deFiMath.expMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 32; x < 135; x += 1.0123) { 
          totalGas += parseInt((await deFiMath.expMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("exp when x in [-40, -0.05]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 0.05; x <= 40; x += 0.1 ) {
          totalGas += parseInt((await deFiMath.expMG(tokens(-x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("expm1", function () {
      it("expm1 when x in [-0.01, 0.01] (Taylor branch)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = -0.01; x <= 0.01; x += 0.0001012) {
          totalGas += parseInt((await deFiMath.expm1MG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("expm1 when x in [0.01, 135] (naive branch)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.01; x < 135; x += 1.0123) {
          totalGas += parseInt((await deFiMath.expm1MG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("ln", function () {
      it("ln when x in [1, 1e6]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.090507732665257659; x += 0.01) { 
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 16; x < 1000; x += 10) { 
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1000; x < 1e6; x += 10000) { 
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln when x in [1e-6, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1e-6; x < 1; x += 1e-2 / 4) {
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("log1p", function () {
      it("log1p when x in [-0.01, 0.01] (Taylor branch)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = -0.01; x <= 0.01; x += 0.0001012) {
          totalGas += parseInt((await deFiMath.log1pMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("log1p when x in [0.01, 1e6] (naive branch)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        let totalGas = 0, count = 0;
        for (let x = 0.01; x < 16; x += 0.1) {
          totalGas += parseInt((await deFiMath.log1pMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 16; x < 1000; x += 10) {
          totalGas += parseInt((await deFiMath.log1pMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("log2", function () {
      it("log2 when x in [1, 1e6]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.090507732665257659; x += 0.01) { 
          totalGas += parseInt((await deFiMath.log2MG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          totalGas += parseInt((await deFiMath.log2MG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 16; x < 1000; x += 10) { 
          totalGas += parseInt((await deFiMath.log2MG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1000; x < 1e6; x += 10000) { 
          totalGas += parseInt((await deFiMath.log2MG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("log2 when x in [1e-6, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1e-6; x < 1; x += 1e-2 / 4) { 
          totalGas += parseInt((await deFiMath.log2MG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("log10", function () {
      it("log10 when x in [1, 1e6]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.090507732665257659; x += 0.01) { 
          totalGas += parseInt((await deFiMath.log10MG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          totalGas += parseInt((await deFiMath.log10MG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 16; x < 1000; x += 10) { 
          totalGas += parseInt((await deFiMath.log10MG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1000; x < 1e6; x += 10000) { 
          totalGas += parseInt((await deFiMath.log10MG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("log10 when x in [1e-6, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1e-6; x < 1; x += 1e-2 / 4) { 
          totalGas += parseInt((await deFiMath.log10MG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("pow", function () {
      it("pow when x in [0.5, 10], a in [-3, 3]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 0.5; x < 10; x += 0.5) {
          for (let a = -3; a <= 3; a += 0.5) {
            totalGas += parseInt((await deFiMath.powMG(tokens(x), tokens(a))).gasUsed);
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("pow when x in [1e-3, 1e3], a in [-1, 1]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1e-3; x < 1e3; x *= 1.5) {
          for (let a = -1; a <= 1; a += 0.25) {
            totalGas += parseInt((await deFiMath.powMG(tokens(x), tokens(a))).gasUsed);
            count++;
          }
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("sqrt", function () {
      it("sqrt when x in [1, 1e6]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.074607828321317497; x += 0.0007) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1.074607828321317497; x < 100; x += 1.00232) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 100; x < 10000; x += 101.213) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 1e4; x < 1e6; x += 1e4) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt when x in [1e-6, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1000000; x += 2234) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(1 / x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("cbrt", function () {
      it("cbrt when x in [1, 1e6]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 100; x += 1.00232) {
          totalGas += parseInt((await deFiMath.cbrtMG(tokens(x))).gasUsed);
          count++;
        }
        for (let x = 100; x < 1e6; x += 1.013e3) {
          totalGas += parseInt((await deFiMath.cbrtMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("cbrt when x in [1e-6, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1000000; x += 2234) {
          totalGas += parseInt((await deFiMath.cbrtMG(tokens(1 / x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("mulDiv", function () {
      it("mulDiv across mixed-magnitude inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // Mix of small, large, and overflow-zone inputs (a · b > 2^256 forces the slow path).
        const samples = [
          [1n, 1n, 1n],
          [1000n, 2000n, 7n],
          [tokens(1.5), tokens(2), tokens(1)],
          [2n ** 200n, 2n ** 50n, 2n ** 200n],          // ratio fits, product overflows
          [2n ** 255n, 2n, 4n],
          [(2n ** 256n - 1n), 1n, 1n],                 // max single-word product
        ];

        let totalGas = 0;
        for (const [a, b, d] of samples) {
          totalGas += parseInt((await deFiMath.mulDivMG(a, b, d)).gasUsed);
        }
        console.log("Avg gas: ", Math.round(totalGas / samples.length), "tests: ", samples.length);
      });
    });

    describe("abs", function () {
      it("abs across positive/negative magnitudes and bounds", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const samples = [
          0n,
          1n, -1n,
          12345n, -12345n,
          tokens(1), `-${tokens(1)}`,
          (1n << 200n), -(1n << 200n),
          (1n << 255n) - 1n,              // int256 max
          -(1n << 255n),                  // int256 min (handled cleanly: returns 2^255)
        ];

        let totalGas = 0;
        for (const x of samples) {
          totalGas += parseInt((await deFiMath.absMG(x)).gasUsed);
        }
        console.log("Avg gas: ", Math.round(totalGas / samples.length), "tests: ", samples.length);
      });
    });

    describe("min", function () {
      it("min across mixed-magnitude pairs (including equal, swap of args)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const samples = [
          [0n, 0n],
          [0n, 1n], [1n, 0n],
          [tokens(1), tokens(2)], [tokens(2), tokens(1)],
          [(1n << 200n), (1n << 100n)],
          [(1n << 256n) - 1n, 1n],
          [(1n << 256n) - 1n, (1n << 256n) - 1n],
        ];

        let totalGas = 0;
        for (const [a, b] of samples) {
          totalGas += parseInt((await deFiMath.minMG(a, b)).gasUsed);
        }
        console.log("Avg gas: ", Math.round(totalGas / samples.length), "tests: ", samples.length);
      });
    });

    describe("max", function () {
      it("max across mixed-magnitude pairs (including equal, swap of args)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const samples = [
          [0n, 0n],
          [0n, 1n], [1n, 0n],
          [tokens(1), tokens(2)], [tokens(2), tokens(1)],
          [(1n << 200n), (1n << 100n)],
          [(1n << 256n) - 1n, 1n],
          [(1n << 256n) - 1n, (1n << 256n) - 1n],
        ];

        let totalGas = 0;
        for (const [a, b] of samples) {
          totalGas += parseInt((await deFiMath.maxMG(a, b)).gasUsed);
        }
        console.log("Avg gas: ", Math.round(totalGas / samples.length), "tests: ", samples.length);
      });
    });

    describe("clamp", function () {
      it("clamp across in-range / below-lo / above-hi triples", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const samples = [
          [50n, 10n, 100n],         // in range
          [5n, 10n, 100n],          // below lo
          [500n, 10n, 100n],        // above hi
          [10n, 10n, 100n],         // at lo boundary
          [100n, 10n, 100n],        // at hi boundary
          [42n, 42n, 42n],          // lo == hi
          [tokens(1.5), tokens(1), tokens(2)],
          [(1n << 256n) - 1n, 0n, (1n << 256n) - 1n],
        ];

        let totalGas = 0;
        for (const [x, lo, hi] of samples) {
          totalGas += parseInt((await deFiMath.clampMG(x, lo, hi)).gasUsed);
        }
        console.log("Avg gas: ", Math.round(totalGas / samples.length), "tests: ", samples.length);
      });
    });

    describe("avg", function () {
      it("avg across small / mixed / overflow-zone pairs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const samples = [
          [0n, 0n],
          [1n, 1n],
          [10n, 6n], [5n, 3n],          // tests carry from low bit
          [tokens(1), tokens(2)],
          [(1n << 200n), (1n << 100n)],
          [(1n << 256n) - 1n, 1n],      // (sum would overflow without bit-trick)
          [(1n << 256n) - 1n, (1n << 256n) - 1n],
        ];

        let totalGas = 0;
        for (const [a, b] of samples) {
          totalGas += parseInt((await deFiMath.avgMG(a, b)).gasUsed);
        }
        console.log("Avg gas: ", Math.round(totalGas / samples.length), "tests: ", samples.length);
      });
    });

    describe("sqrtTime", function () {
      it("sqrtTime when x in [1s, 8y]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 252288000; x += 252288000 / 400) {
          totalGas += parseInt((await deFiMath.sqrtTimeMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("stdNormCDF", function () {
      it("stdNormCDF when x in [0, 11.63]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 0; x < 11.63; x += 0.1163 / 4) {
          totalGas += parseInt((await deFiMath.stdNormCDFMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("stdNormCDF when x in [-11.63, 0]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 0; x < 11.63; x += 0.1163 / 4) {
          totalGas += parseInt((await deFiMath.stdNormCDFMG(tokens(-x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });
    });

    describe("erf", function () {
      it("erf when x in [0, 10]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 0; x < 10; x += 0.100163 / 4) {
          totalGas += parseInt((await deFiMath.erfMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("erf when x in [-10, 0]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 0; x < 10; x += 0.100163 / 4) {
          totalGas += parseInt((await deFiMath.erfMG(tokens(-x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });
    });
  }); 

  describe("functionality", function () {
    describe("exp", function () {
      it("exp when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let actualSOL = (await deFiMath.exp(0)).toString() / 1e18;
        assert.equal(actualSOL, 1);

        actualSOL = (await deFiMath.expPositive(0)).toString() / 1e18;
        assert.equal(actualSOL, 1);
      });

      it("exp when x in [0, 0.03125)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0; x < 0.03125; x += 0.0003) { 
          const expected = Math.exp(x);

          let actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);

          actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
        }
      });

      it("exp when x in [0.03125, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.03125; x < 1; x += 0.0010125) { 
          const expected = Math.exp(x);

          let actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);

          actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
        }
      });

      it("exp when x in [1, 32)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 32; x += 0.03200125) { 
          const expected = Math.exp(x);

          let actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);

          actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
        }
      });

      it("exp when x in [32, 135)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 32; x < 135; x += 0.25600125) { 
          const expected = Math.exp(x);

          let actualSOL = (await deFiMath.exp(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);

          actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
        }
      });

      it("exp when x in [-40, -0.05]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.05; x <= 40; x += 0.05 ) { 
          const expected = Math.exp(-x);

          const actualSOL = (await deFiMath.exp(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF); // todo
        }
      });

      it("exp when x below -41", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let actualSOL = (await deFiMath.exp("-41446531673892822313")).toString() / 1e18;
        assert.equal(actualSOL, 0);
        actualSOL = (await deFiMath.exp("-42446531673892822313")).toString() / 1e18;
        assert.equal(actualSOL, 0);
      });

      describe("failure", function () {
        it("rejects when x >= max", async function () {
          const { deFiMath } = await loadFixture(deploy);

          await assertRevertError(deFiMath, deFiMath.exp("135305999368893231589"), "ExpUpperBoundError");
          await deFiMath.exp("135305999368893231588");
          await assertRevertError(deFiMath, deFiMath.exp("136305999368893231589"), "ExpUpperBoundError");
        });
      });
    });

    describe("expm1", function () {
      it("expm1 when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actual = (await deFiMath.expm1(0)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("expm1 when |x| < 0.01 (Taylor branch, precision-critical for small x)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = -0.01; x <= 0.01; x += 0.0001012) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          // small inputs require absolute tolerance, not relative (since true value can be tiny)
          assertAbsoluteBelow(actual, expected, 1e-15);
        }
      });

      it("expm1 when very small x (sub-ULP regime)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // for x at single-ULP scale, expm1(x) ≈ x and should be exact
        const actualA = (await deFiMath.expm1("1")).toString() / 1e18;
        assert.equal(actualA, 1e-18);
        const actualB = (await deFiMath.expm1("1000")).toString() / 1e18;
        assert.equal(actualB, 1e-15);
      });

      it("expm1 when x in [0.01, 1) (naive branch transition)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // naive branch inherits exp's rel error; absolute error stays small even when (exp-1) is small
        for (let x = 0.01; x < 1; x += 0.0101) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, 1e-13);
        }
      });

      it("expm1 when x in [1, 135) (large positive)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1; x < 135; x += 1.0123) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, 1e-13);
        }
      });

      it("expm1 when x is very negative (approaches -1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = -1; x >= -41; x -= 0.5) {
          const expected = Math.expm1(x);
          const actual = (await deFiMath.expm1(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, 1e-14);
        }
      });

      describe("failure", function () {
        it("rejects when x >= exp upper bound", async function () {
          const { deFiMath } = await loadFixture(deploy);
          await assertRevertError(deFiMath, deFiMath.expm1("135305999368893231589"), "ExpUpperBoundError");
          await deFiMath.expm1("135305999368893231588");
        });
      });
    });

    describe("ln", function () {
      it("ln when x in [1, 2]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 2.005; x += 0.01) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2, 2^16]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x <= 2 ** 16; x += 2 ** 6 + Math.random() * 2) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2^16, 2^32]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 16; x <= 2 ** 32; x += 2 ** 22 + Math.random() * 32) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2^32, 2^48]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 32; x <= 2 ** 48; x += 2 ** 38 + Math.random() * 128) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2^48, 2^64]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 48; x <= 2 ** 64; x += 2 ** 54 + Math.random() * 128) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2^64, 2^128]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 64; x < 2 ** 128; x += 2 ** 120 + Math.random() * 128) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [2^128, 2^195]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 128; x <= 2 ** 196; x += 2 ** 188 + Math.random() * 128) {
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x is uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;
        const expected = Math.log(x);
        
        const actualSOL = (await deFiMath.ln("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      // todo: add random tests

      it("ln when x in [0.0625, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 16.08; x += 0.16) { 
          const expected = Math.log(1 / x);

          const actualSOL = (await deFiMath.ln(tokens(1 / x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x in [1e-18, 1e-16)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1e-16; x += 1e-18) { 
          const expected = Math.log(x);

          const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("ln when x is minimum", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1e-18;
        const expected = Math.log(x);

        const actualSOL = (await deFiMath.ln("1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      describe("failure", function () {
        it("rejects when x = 0", async function () {
          const { deFiMath } = await loadFixture(deploy);

          await assertRevertError(deFiMath, deFiMath.ln("0"), "LnLowerBoundError");
          await deFiMath.ln("1");
        });
      });
    });

    describe("log1p", function () {
      it("log1p when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actual = (await deFiMath.log1p(0)).toString() / 1e18;
        assert.equal(actual, 0);
      });

      it("log1p when |x| < 0.01 (Taylor branch, precision-critical for small x)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = -0.01; x <= 0.01; x += 0.0001012) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actual, expected, 1e-17);
        }
      });

      it("log1p when very small x (sub-ULP regime)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // for x at single-ULP scale, log1p(x) ≈ x and should be exact
        const actualA = (await deFiMath.log1p("1")).toString() / 1e18;
        assert.equal(actualA, 1e-18);
        const actualB = (await deFiMath.log1p("1000")).toString() / 1e18;
        assert.equal(actualB, 1e-15);
      });

      it("log1p when x in [0.01, 1) (naive branch transition)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 0.01; x < 1; x += 0.0101) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log1p when x in [-0.99, -0.01]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = -0.99; x <= -0.01; x += 0.01) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log1p when x in [1, 1e6] (large positive)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1; x < 16; x += 0.1) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
        for (let x = 1000; x <= 1e6; x *= 10) {
          const expected = Math.log1p(x);
          const actual = (await deFiMath.log1p(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actual, expected, MAX_REL_ERROR_LN);
        }
      });

      describe("failure", function () {
        it("rejects when x = -1", async function () {
          const { deFiMath } = await loadFixture(deploy);
          await assertRevertError(deFiMath, deFiMath.log1p("-1000000000000000000"), "Log1pLowerBoundError");
          // just above -1 should work
          await deFiMath.log1p("-999999999999999999");
        });

        it("rejects when x < -1", async function () {
          const { deFiMath } = await loadFixture(deploy);
          await assertRevertError(deFiMath, deFiMath.log1p("-2000000000000000000"), "Log1pLowerBoundError");
        });
      });
    });

    describe("ln — [1/16, 16] range", function () {
      it("ln when x is 16", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 16;
        const expected = Math.log(x);

        const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      // todo: add random tests

      it("ln when x in [0.0625, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 16.08; x += 0.16) {
          const expected = Math.log(1 / x);

          const actualSOL = (await deFiMath.ln(tokens(1 / x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });
    });

    describe("log2", function () {
      it("log2 when x in [1, 2]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 2.005; x += 0.01) { 
          const expected = Math.log2(x);
          
          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2, 2^16]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x <= 2 ** 16; x += 2 ** 6 + Math.random() * 2) { 
          const expected = Math.log2(x);
          
          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^16, 2^32]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 16; x <= 2 ** 32; x += 2 ** 22 + Math.random() * 128) { 
          const expected = Math.log2(x);
          
          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^32, 2^48]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 32; x <= 2 ** 48; x += 2 ** 38 + Math.random() * 128) { 
          const expected = Math.log2(x);
          
          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^48, 2^64]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 48; x <= 2 ** 64; x += 2 ** 54 + Math.random() * 128) { 
          const expected = Math.log2(x);
          
          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^64, 2^128]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 64; x < 2 ** 128; x += 2 ** 120 + Math.random() * 128) { 
          const expected = Math.log2(x);
          
          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [2^128, 2^195]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 128; x <= 2 ** 196; x += 2 ** 188 + Math.random() * 128) {
          const expected = Math.log2(x);
          
          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x is uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;
        const expected = Math.log2(x);
        
        const actualSOL = (await deFiMath.log2("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      // todo: add random tests

      it("log2 when x in [0.0625, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 16.08; x += 0.16) { 
          const expected = Math.log2(1 / x);

          const actualSOL = (await deFiMath.log2(tokens(1 / x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x in [1e-18, 1e-16)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1e-16; x += 1e-18) { 
          const expected = Math.log2(x);

          const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log2 when x is minimum", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1e-18;
        const expected = Math.log2(x);

        const actualSOL = (await deFiMath.log2("1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      describe("failure", function () {
        it("rejects when x = 0", async function () {
          const { deFiMath } = await loadFixture(deploy);

          await assertRevertError(deFiMath, deFiMath.log2("0"), "LnLowerBoundError");
          await deFiMath.log2("1");
        });
      });
    });

    describe("log10", function () {
      it("log10 when x in [1, 2]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 2.005; x += 0.01) { 
          const expected = Math.log10(x);
          
          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2, 2^16]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x <= 2 ** 16; x += 2 ** 6 + Math.random() * 2) { 
          const expected = Math.log10(x);
          
          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^16, 2^32]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 16; x <= 2 ** 32; x += 2 ** 22 + Math.random() * 128) { 
          const expected = Math.log10(x);
          
          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^32, 2^48]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 32; x <= 2 ** 48; x += 2 ** 38 + Math.random() * 128) { 
          const expected = Math.log10(x);
          
          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^48, 2^64]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 48; x <= 2 ** 64; x += 2 ** 54 + Math.random() * 128) { 
          const expected = Math.log10(x);
          
          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^64, 2^128]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 64; x < 2 ** 128; x += 2 ** 120 + Math.random() * 128) { 
          const expected = Math.log10(x);
          
          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [2^128, 2^195]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 128; x <= 2 ** 196; x += 2 ** 188 + Math.random() * 128) {
          const expected = Math.log10(x);
          
          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x is uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;
        const expected = Math.log10(x);
        
        const actualSOL = (await deFiMath.log10("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      // todo: add random tests

      it("log10 when x in [0.0625, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 16.08; x += 0.16) { 
          const expected = Math.log10(1 / x);

          const actualSOL = (await deFiMath.log10(tokens(1 / x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x in [1e-18, 1e-16)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-18; x <= 1e-16; x += 1e-18) { 
          const expected = Math.log10(x);

          const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
        }
      });

      it("log10 when x is minimum", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1e-18;
        const expected = Math.log10(x);

        const actualSOL = (await deFiMath.log10("1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN);
      });

      describe("failure", function () {
        it("rejects when x = 0", async function () {
          const { deFiMath } = await loadFixture(deploy);

          await assertRevertError(deFiMath, deFiMath.log10("0"), "LnLowerBoundError");
          await deFiMath.log10("1");
        });
      });
    });

    describe("pow", function () {
      it("pow when a = 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // anything^0 = 1, including 0^0 = 1 by convention
        assert.equal((await deFiMath.pow(tokens(0), 0)).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1), 0)).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(2), 0)).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1e6), 0)).toString() / 1e18, 1);
      });

      it("pow when x = 1", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 1^a = 1 for any a
        assert.equal((await deFiMath.pow(tokens(1), tokens(0.5))).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1), tokens(-10))).toString() / 1e18, 1);
        assert.equal((await deFiMath.pow(tokens(1), tokens(100))).toString() / 1e18, 1);
      });

      it("pow when a = 1", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.1; x <= 10; x += 0.317) {
          const expected = x;

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(1))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
        }
      });

      it("pow when a = 2 (square)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.1; x <= 10; x += 0.317) {
          const expected = x * x;

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(2))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
        }
      });

      it("pow when a = 0.5 (sqrt)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.01; x <= 100; x += 3.333) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(0.5))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
        }
      });

      it("pow when a = -1 (reciprocal)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.1; x <= 10; x += 0.317) {
          const expected = 1 / x;

          const actualSOL = (await deFiMath.pow(tokens(x), tokens(-1))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
        }
      });

      it("pow when x in [0.5, 10], a in [-2, 2]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0.5; x <= 10; x += 0.713) {
          for (let a = -2; a <= 2; a += 0.413) {
            const expected = Math.pow(x, a);

            const actualSOL = (await deFiMath.pow(tokens(x), tokens(a))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
          }
        }
      });

      it("pow when x in [1e-3, 1e3], a in [-1, 1]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1e-3; x < 1e3; x *= 2.345) {
          for (let a = -1; a <= 1; a += 0.237) {
            const expected = Math.pow(x, a);

            const actualSOL = (await deFiMath.pow(tokens(x), tokens(a))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
          }
        }
      });

      it("pow when x in [1, 100], a fractional", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 100; x += 5.137) {
          for (const a of [0.1, 0.333, 0.5, 0.75, 1.5, 2.5, 3.1415]) {
            const expected = Math.pow(x, a);

            const actualSOL = (await deFiMath.pow(tokens(x), tokens(a))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
          }
        }
      });

      it("pow underflow when exponent very negative", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // pow(2, -100) = 7.9e-31 → exp(-100 * ln(2)) = exp(-69.3) ≈ 7.9e-31
        // still above underflow bound, so should match
        const expected = Math.pow(2, -100);
        const actualSOL = (await deFiMath.pow(tokens(2), tokens(-100))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, 1e-30);

        // pow(2, -1000) → exp(-693) underflows to 0
        const actualUnderflow = (await deFiMath.pow(tokens(2), tokens(-1000))).toString() / 1e18;
        assert.equal(actualUnderflow, 0);
      });

      it("pow near exp upper bound (a * ln(x) ≈ 135.3)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // max safe: a * ln(2) / 1e18 < 135.305999368893231589e18
        // ln(2) ≈ 0.693147... → max a ≈ 195.245
        const expected = Math.pow(2, 195);
        const actualSOL = (await deFiMath.pow(tokens(2), tokens(195))).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
      });

      it("pow near exp underflow bound (a * ln(x) ≈ -41.4)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // just above underflow: a * ln(2) / 1e18 > -41.446531673892822313e18
        // ln(2) ≈ 0.693147... → a ≈ -59.78 keeps result nonzero
        const expected = Math.pow(2, -59);
        const actualSOL = (await deFiMath.pow(tokens(2), tokens(-59))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, 1e-17);

        // crossing underflow: a = -60 gives -60 * 0.693 ≈ -41.58 → exp returns 0
        const actualUnderflow = (await deFiMath.pow(tokens(2), tokens(-60))).toString() / 1e18;
        assert.equal(actualUnderflow, 0);
      });

      it("pow when x = uint256 max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // ln(uint256 max) ≈ 135.99, so pow(uint256_max, a) overflows for a > 135.3/135.99 ≈ 0.995
        // use a = 0.5 → sqrt of uint256 max ≈ 3.4e29
        const uint256Max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        const xVal = 115792089237316195423570985008687907853269984665640564039457.584007913129639935;

        const expected = Math.sqrt(xVal);
        const actualSOL = (await deFiMath.pow(uint256Max, tokens(0.5))).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_POW);
      });

      it("pow when x = 1 wei (minimum fixed-point)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // ln(1e-18) ≈ -41.446, so pow(1 wei, 1) = exp(-41.446) → underflows to 0
        const actualSOL = (await deFiMath.pow("1", tokens(1))).toString() / 1e18;
        assert.equal(actualSOL, 0);

        // pow(1 wei, 0.5) = exp(-20.72) ≈ 1e-9, should work
        const expected = Math.sqrt(1e-18);
        const actualHalf = (await deFiMath.pow("1", tokens(0.5))).toString() / 1e18;
        assertAbsoluteBelow(actualHalf, expected, 1e-14);
      });

      it("pow when a = 1 wei (minimum positive exponent)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // pow(2, 1e-18) ≈ 1 + ln(2) * 1e-18 ≈ 1 (within fixed-point precision)
        const actualSOL = (await deFiMath.pow(tokens(2), "1")).toString() / 1e18;
        assertRelativeBelow(actualSOL, 1, MAX_REL_ERROR_POW);
      });

      describe("failure", function () {
        it("rejects when x = 0 and a != 0", async function () {
          const { deFiMath } = await loadFixture(deploy);

          await assertRevertError(deFiMath, deFiMath.pow(tokens(0), tokens(1)), "LnLowerBoundError");
          await assertRevertError(deFiMath, deFiMath.pow(tokens(0), tokens(-1)), "LnLowerBoundError");
        });

        it("rejects when result overflows exp upper bound", async function () {
          const { deFiMath } = await loadFixture(deploy);

          // pow(10, 100) → exp(100 * ln(10)) = exp(~230), overflows exp upper bound ~135
          await assertRevertError(deFiMath, deFiMath.pow(tokens(10), tokens(100)), "ExpUpperBoundError");
        });

        it("rejects pow(2, 196) — just above exp upper bound", async function () {
          const { deFiMath } = await loadFixture(deploy);

          // 196 * ln(2) ≈ 135.85e18, just over 135.305999...e18 upper bound
          await assertRevertError(deFiMath, deFiMath.pow(tokens(2), tokens(196)), "ExpUpperBoundError");
        });

        it("rejects pow(uint256 max, 1)", async function () {
          const { deFiMath } = await loadFixture(deploy);

          // ln(uint256 max) ≈ 135.99e18, exceeds exp upper bound
          const uint256Max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
          await assertRevertError(deFiMath, deFiMath.pow(uint256Max, tokens(1)), "ExpUpperBoundError");
        });
      });
    });

    describe("sqrt", function () {
      it("sqrt when x in [1, 2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 2; x += 0.01) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
        }
      });

      it("sqrt when x in [1, 2^20)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 2 ** 20; x += 1048.576) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
        }
      });

      it("sqrt when x in [2^20, 2^40)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2**20; x < 2**40; x += 2**40 * 1048.576) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
        }
      });

      it("sqrt when x in [2^40, 2^60)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2**40; x < 2**60; x += 2**40 * 1048.576) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
        }
      });

      it("sqrt when x in [2^60, 2^80)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2**60; x < 2**80; x += 2**60 * 1048.576) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
        }
      });

      it("sqrt when x is max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1208925819614628999999999.999999999999999999;
        const expected = Math.sqrt(x);

        const actualSOL = (await deFiMath.sqrt("1208925819614628999999999999999999999999999")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
      });

      it("sqrt when x in [1e-18, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1e-18; x < 1; x += x) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
        }
      });

      it("sqrt when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const x = 0;
        const expected = Math.sqrt(x);

        const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_REL_ERROR_SQRT);
      });

      describe("failure", function () {
        it("rejects when x >= max", async function () {
          const { deFiMath } = await loadFixture(deploy);

          await assertRevertError(deFiMath, deFiMath.sqrt("1208925819614629000000000000000000000000000"), "SqrtUpperBoundError");
          await assertRevertError(deFiMath, deFiMath.sqrt("115792089237316195423570985008687907853269984665640564039457584007913129639935"), "SqrtUpperBoundError");
          await deFiMath.sqrt("1208925819614628999999999999999999999999999");
        });
      });
    });

    describe("cbrt", function () {
      it("cbrt when x in [1, 2)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 2; x += 0.01) {
          const expected = Math.cbrt(x);
          const actualSOL = (await deFiMath.cbrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_CBRT);
        }
      });

      it("cbrt when x in [1, 2^30)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 2 ** 30; x += 2 ** 20 * 1.024) {
          const expected = Math.cbrt(x);
          const actualSOL = (await deFiMath.cbrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_CBRT);
        }
      });

      it("cbrt when x in [2^30, 2^60)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2 ** 30; x < 2 ** 60; x += 2 ** 50 * 1.024) {
          const expected = Math.cbrt(x);
          const actualSOL = (await deFiMath.cbrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_CBRT);
        }
      });

      it("cbrt when x is max", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // cap is 7.5557863725914323e40 in 1e18-FP → max valid x ≈ 7.555786e22 in true value
        const x = 7.5557863725914323e22;
        const expected = Math.cbrt(x);

        const actualSOL = (await deFiMath.cbrt("75557863725914322999999999999999999999999")).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_CBRT);
      });

      it("cbrt when x in (0, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1e-12; x < 1; x += x) {
          const expected = Math.cbrt(x);
          const actualSOL = (await deFiMath.cbrt(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_CBRT);
        }
      });

      it("cbrt when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const actualSOL = (await deFiMath.cbrt(0)).toString();
        assert.equal(actualSOL, "0");
      });

      it("cbrt of perfect cubes is exact", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (const n of [1, 2, 3, 8, 10, 27, 100, 1000, 1000000]) {
          const cube = n * n * n;
          const actualSOL = (await deFiMath.cbrt(tokens(cube))).toString() / 1e18;
          assertRelativeBelow(actualSOL, n, MAX_REL_ERROR_CBRT);
        }
      });

      describe("failure", function () {
        it("rejects when x >= max", async function () {
          const { deFiMath } = await loadFixture(deploy);

          await assertRevertError(deFiMath, deFiMath.cbrt("75557863725914323000000000000000000000000"), "CbrtUpperBoundError");
          await assertRevertError(deFiMath, deFiMath.cbrt("115792089237316195423570985008687907853269984665640564039457584007913129639935"), "CbrtUpperBoundError");
          await deFiMath.cbrt("75557863725914322999999999999999999999999");
        });
      });
    });

    describe("mulDiv", function () {
      const MAX = (1n << 256n) - 1n;

      it("handles small inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        assert.equal((await deFiMath.mulDiv(0n, 0n, 1n)).toString(), "0");
        assert.equal((await deFiMath.mulDiv(0n, 12345n, 7n)).toString(), "0");
        assert.equal((await deFiMath.mulDiv(1n, 1n, 1n)).toString(), "1");
        assert.equal((await deFiMath.mulDiv(6n, 7n, 3n)).toString(), "14");           // 42 / 3
        assert.equal((await deFiMath.mulDiv(3n, 4n, 5n)).toString(), "2");            // 12 / 5 → 2 (rounds toward zero)
        assert.equal((await deFiMath.mulDiv(7n, 3n, 2n)).toString(), "10");           // 21 / 2 → 10
      });

      it("handles d = 1 (identity divide)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // a * b fits in uint256 → fast path returns a * b
        assert.equal((await deFiMath.mulDiv(2n ** 200n, 1n, 1n)).toString(), (2n ** 200n).toString());
        // (2^256 - 1) * 1 = 2^256 - 1 (max single-word)
        assert.equal((await deFiMath.mulDiv(MAX, 1n, 1n)).toString(), MAX.toString());
        // 1 * (2^256 - 1) = same
        assert.equal((await deFiMath.mulDiv(1n, MAX, 1n)).toString(), MAX.toString());
      });

      it("handles full 512-bit intermediate products", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // 2^200 * 2^200 = 2^400 (overflows uint256), divided by 2^200 = 2^200 (fits)
        assert.equal(
          (await deFiMath.mulDiv(2n ** 200n, 2n ** 200n, 2n ** 200n)).toString(),
          (2n ** 200n).toString()
        );
        // 2^255 * 2 = 2^256 (just overflows), / 4 = 2^254
        assert.equal(
          (await deFiMath.mulDiv(2n ** 255n, 2n, 4n)).toString(),
          (2n ** 254n).toString()
        );
        // (2^256 - 1)^2 / (2^256 - 1) = 2^256 - 1 — extreme stress case
        assert.equal((await deFiMath.mulDiv(MAX, MAX, MAX)).toString(), MAX.toString());
      });

      it("matches BigInt reference across random inputs", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // Pseudo-random sweep across magnitudes; deterministic so failures reproduce.
        const cases = [
          [12345678901234567890n, 98765432109876543210n, 1000000n],
          [1n << 128n, 1n << 128n, 1n << 200n],
          [(1n << 200n) - 1n, (1n << 100n) + 7n, (1n << 150n) + 3n],
          [tokens(1234.5678), tokens(0.000789), tokens(1)],
          [(1n << 250n) + 1n, 13n, (1n << 100n) + 1n],
        ];
        for (const [a, b, d] of cases) {
          const expected = (a * b) / d;
          const actual = await deFiMath.mulDiv(a, b, d);
          assert.equal(actual.toString(), expected.toString(), `mulDiv(${a}, ${b}, ${d})`);
        }
      });

      describe("random", function () {
        it("matches BigInt reference on 500 random inputs", async function () {
          const { deFiMath } = await loadFixture(deploy);
          for (let i = 0; i < 500; i++) {
            let a, b, d, p1;
            // Reject (d == 0) and (d <= p1) cases — those are tested explicitly in failure.
            do {
              a = randomUint256();
              b = randomUint256();
              d = randomUint256();
              p1 = (a * b) >> 256n;
            } while (d === 0n || d <= p1);
            const expected = (a * b) / d;
            const actual = await deFiMath.mulDiv(a, b, d);
            assert.equal(actual.toString(), expected.toString(), `mulDiv(${a}, ${b}, ${d})`);
          }
        });
      });

      describe("failure", function () {
        it("rejects when d == 0 (fast path)", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // 2 * 3 = 6 fits in uint256 → fast path checks d == 0
          await assertRevertError(deFiMath, deFiMath.mulDiv(2n, 3n, 0n), "MulDivByZeroError");
        });

        it("rejects when d == 0 (slow path)", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // 2^200 * 2^200 overflows uint256 → slow path checks d == 0
          await assertRevertError(deFiMath, deFiMath.mulDiv(2n ** 200n, 2n ** 200n, 0n), "MulDivByZeroError");
        });

        it("rejects when quotient overflows uint256", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // 2^128 * 2^128 / 1 = 2^256 → doesn't fit in uint256
          await assertRevertError(deFiMath, deFiMath.mulDiv(1n << 128n, 1n << 128n, 1n), "MulDivOverflowError");
          // (2^256 - 1) * (2^256 - 1) / 1 → way over
          await assertRevertError(deFiMath, deFiMath.mulDiv(MAX, MAX, 1n), "MulDivOverflowError");
        });
      });
    });

    describe("abs", function () {
      const INT_MAX = (1n << 255n) - 1n;
      const INT_MIN = -(1n << 255n);

      it("zero returns zero", async function () {
        const { deFiMath } = await loadFixture(deploy);
        assert.equal((await deFiMath.abs(0n)).toString(), "0");
      });

      it("matches BigInt abs on positives and negatives", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          1n, -1n,
          12345n, -12345n,
          tokens(0.001), `-${tokens(0.001)}`,
          tokens(1234.5678), `-${tokens(1234.5678)}`,
          (1n << 100n), -(1n << 100n),
          (1n << 200n), -(1n << 200n),
        ];
        for (const x of cases) {
          const xBig = BigInt(x);
          const expected = xBig < 0n ? -xBig : xBig;
          assert.equal((await deFiMath.abs(x)).toString(), expected.toString(), `abs(${x})`);
        }
      });

      it("handles int256 boundary values", async function () {
        const { deFiMath } = await loadFixture(deploy);

        // int256 max: 2^255 - 1
        assert.equal((await deFiMath.abs(INT_MAX)).toString(), INT_MAX.toString());

        // int256 min: -2^255. No positive int256 represents +2^255, but the unsigned
        // result is 2^255 (the wrap-around in two's complement is the correct answer).
        assert.equal((await deFiMath.abs(INT_MIN)).toString(), (1n << 255n).toString());
      });

      describe("random", function () {
        it("matches BigInt reference on 500 random inputs", async function () {
          const { deFiMath } = await loadFixture(deploy);
          for (let i = 0; i < 500; i++) {
            const x = randomInt256();
            const expected = x < 0n ? -x : x;
            const actual = await deFiMath.abs(x);
            assert.equal(actual.toString(), expected.toString(), `abs(${x})`);
          }
        });
      });

      describe("failure", function () {
        it("never reverts — domain is all of int256", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // No int256 input causes a revert. The branchless implementation has no
          // conditional path, so even `int256.min` (the input that overflows naive `-x`)
          // is handled cleanly via two's-complement wrap.
          await deFiMath.abs(0n);
          await deFiMath.abs(1n);
          await deFiMath.abs(-1n);
          await deFiMath.abs(INT_MAX);
          await deFiMath.abs(INT_MIN);
        });
      });
    });

    describe("min", function () {
      const UMAX = (1n << 256n) - 1n;

      it("matches BigInt min across mixed pairs (commutative, equal, bounds)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 0n],
          [0n, 1n], [1n, 0n],
          [5n, 7n], [7n, 5n],
          [tokens(1.5), tokens(2)],
          [(1n << 200n), (1n << 100n)],
          [UMAX, 0n], [0n, UMAX],
          [UMAX, UMAX],
        ];
        for (const [a, b] of cases) {
          const expected = a < b ? a : b;
          assert.equal((await deFiMath.min(a, b)).toString(), expected.toString(), `min(${a}, ${b})`);
        }
      });

      describe("random", function () {
        it("matches BigInt reference on 500 random inputs", async function () {
          const { deFiMath } = await loadFixture(deploy);
          for (let i = 0; i < 500; i++) {
            const a = randomUint256();
            const b = randomUint256();
            const expected = a < b ? a : b;
            const actual = await deFiMath.min(a, b);
            assert.equal(actual.toString(), expected.toString(), `min(${a}, ${b})`);
          }
        });
      });

      describe("failure", function () {
        it("never reverts — domain is the full uint256 × uint256 grid", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // 3 opcodes, no jumps — no reverting path exists.
          await deFiMath.min(0n, 0n);
          await deFiMath.min(0n, UMAX);
          await deFiMath.min(UMAX, 0n);
          await deFiMath.min(UMAX, UMAX);
        });
      });
    });

    describe("max", function () {
      const UMAX = (1n << 256n) - 1n;

      it("matches BigInt max across mixed pairs (commutative, equal, bounds)", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 0n],
          [0n, 1n], [1n, 0n],
          [5n, 7n], [7n, 5n],
          [tokens(1.5), tokens(2)],
          [(1n << 200n), (1n << 100n)],
          [UMAX, 0n], [0n, UMAX],
          [UMAX, UMAX],
        ];
        for (const [a, b] of cases) {
          const expected = a > b ? a : b;
          assert.equal((await deFiMath.max(a, b)).toString(), expected.toString(), `max(${a}, ${b})`);
        }
      });

      describe("random", function () {
        it("matches BigInt reference on 500 random inputs", async function () {
          const { deFiMath } = await loadFixture(deploy);
          for (let i = 0; i < 500; i++) {
            const a = randomUint256();
            const b = randomUint256();
            const expected = a > b ? a : b;
            const actual = await deFiMath.max(a, b);
            assert.equal(actual.toString(), expected.toString(), `max(${a}, ${b})`);
          }
        });
      });

      describe("failure", function () {
        it("never reverts — domain is the full uint256 × uint256 grid", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // 3 opcodes, no jumps — no reverting path exists.
          await deFiMath.max(0n, 0n);
          await deFiMath.max(0n, UMAX);
          await deFiMath.max(UMAX, 0n);
          await deFiMath.max(UMAX, UMAX);
        });
      });
    });

    describe("clamp", function () {
      const UMAX = (1n << 256n) - 1n;

      it("passes through values in range", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const lo = 10n, hi = 100n;
        for (const x of [10n, 11n, 42n, 99n, 100n]) {
          assert.equal((await deFiMath.clamp(x, lo, hi)).toString(), x.toString(), `clamp(${x}, ${lo}, ${hi})`);
        }
      });

      it("clamps below lo and above hi", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const lo = 10n, hi = 100n;
        assert.equal((await deFiMath.clamp(0n, lo, hi)).toString(), lo.toString());
        assert.equal((await deFiMath.clamp(9n, lo, hi)).toString(), lo.toString());
        assert.equal((await deFiMath.clamp(101n, lo, hi)).toString(), hi.toString());
        assert.equal((await deFiMath.clamp(UMAX, lo, hi)).toString(), hi.toString());
      });

      it("lo == hi collapses to that single value", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (const x of [0n, 41n, 42n, 43n, UMAX]) {
          assert.equal((await deFiMath.clamp(x, 42n, 42n)).toString(), "42");
        }
      });

      it("handles full-range bounds", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // lo = 0, hi = UMAX → never clamps
        for (const x of [0n, 1n, tokens(1), UMAX]) {
          assert.equal((await deFiMath.clamp(x, 0n, UMAX)).toString(), x.toString(), `clamp(${x}, 0, UMAX)`);
        }
      });

      it("inverted range (lo > hi) always returns hi", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Documented behavior: function does not validate lo ≤ hi; the second min step
        // squashes the result to hi regardless of x. Caller's responsibility.
        for (const x of [0n, 50n, 200n, UMAX]) {
          assert.equal((await deFiMath.clamp(x, 100n, 10n)).toString(), "10", `clamp(${x}, 100, 10)`);
        }
      });

      describe("random", function () {
        it("matches reference on 500 random valid triples (lo ≤ hi)", async function () {
          const { deFiMath } = await loadFixture(deploy);
          for (let i = 0; i < 500; i++) {
            const x = randomUint256();
            let lo = randomUint256();
            let hi = randomUint256();
            if (lo > hi) [lo, hi] = [hi, lo];   // ensure valid range
            const expected = x < lo ? lo : (x > hi ? hi : x);
            const actual = await deFiMath.clamp(x, lo, hi);
            assert.equal(actual.toString(), expected.toString(), `clamp(${x}, ${lo}, ${hi})`);
          }
        });
      });

      describe("failure", function () {
        it("never reverts — even on inverted ranges and bounds at the uint256 ceiling", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // Domain is the full uint256³ — no input combination causes a revert.
          await deFiMath.clamp(0n, 0n, 0n);
          await deFiMath.clamp(UMAX, 0n, UMAX);
          await deFiMath.clamp(0n, UMAX, UMAX);
          await deFiMath.clamp(42n, 100n, 10n);        // inverted range — returns hi (= 10)
          await deFiMath.clamp(UMAX, UMAX, 0n);        // inverted, both extremes
        });
      });
    });

    describe("avg", function () {
      const UMAX = (1n << 256n) - 1n;

      it("matches BigInt avg on small values", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const cases = [
          [0n, 0n], [0n, 1n], [1n, 0n],
          [1n, 1n], [2n, 2n],
          [5n, 3n],            // (5+3)/2 = 4
          [10n, 6n],           // (10+6)/2 = 8
          [7n, 4n],            // (7+4)/2 = 5 (rounds toward zero, floor(11/2))
          [99n, 100n],         // floor(199/2) = 99
          [tokens(1.5), tokens(2.5)],
        ];
        for (const [a, b] of cases) {
          const aBig = BigInt(a), bBig = BigInt(b);
          const expected = (aBig + bBig) / 2n;
          assert.equal((await deFiMath.avg(a, b)).toString(), expected.toString(), `avg(${a}, ${b})`);
        }
      });

      it("does not overflow at the uint256 ceiling", async function () {
        const { deFiMath } = await loadFixture(deploy);
        // Sum (2^256 - 1) + (2^256 - 1) would wrap a naive (a+b)/2 to ~0; bit-trick handles it.
        assert.equal((await deFiMath.avg(UMAX, UMAX)).toString(), UMAX.toString());
        // (UMAX + 1) / 2 = 2^255
        assert.equal((await deFiMath.avg(UMAX, 1n)).toString(), (1n << 255n).toString());
        // (2^255 + 2^255) / 2 = 2^255
        assert.equal((await deFiMath.avg(1n << 255n, 1n << 255n)).toString(), (1n << 255n).toString());
      });

      it("is commutative", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const pairs = [[5n, 7n], [UMAX, 0n], [(1n << 200n), (1n << 100n)]];
        for (const [a, b] of pairs) {
          const ab = (await deFiMath.avg(a, b)).toString();
          const ba = (await deFiMath.avg(b, a)).toString();
          assert.equal(ab, ba, `avg should be commutative for (${a}, ${b})`);
        }
      });

      describe("random", function () {
        it("matches BigInt reference on 500 random inputs", async function () {
          const { deFiMath } = await loadFixture(deploy);
          for (let i = 0; i < 500; i++) {
            const a = randomUint256();
            const b = randomUint256();
            const expected = (a + b) / 2n;   // BigInt sum is unbounded, no overflow
            const actual = await deFiMath.avg(a, b);
            assert.equal(actual.toString(), expected.toString(), `avg(${a}, ${b})`);
          }
        });
      });

      describe("failure", function () {
        it("never reverts — bit-trick handles the full uint256 ceiling cleanly", async function () {
          const { deFiMath } = await loadFixture(deploy);
          // A naive (a+b)/2 reverts (Panic 0x11) on a sum that overflows uint256.
          // The bit-trick `(a & b) + ((a ^ b) >> 1)` never overflows.
          await deFiMath.avg(0n, 0n);
          await deFiMath.avg(UMAX, 0n);
          await deFiMath.avg(0n, UMAX);
          await deFiMath.avg(UMAX, UMAX);             // sum would be 2·UMAX, well over 2^256
          await deFiMath.avg(1n << 255n, 1n << 255n); // sum = 2^256
        });
      });
    });

    describe("sqrtTime", function () {
      it("sqrtTime when x is 1s", async function () {
        const { deFiMath } = await loadFixture(deploy);
        const x = 31709792000 / 1e18; // around 1 / 31536000 = 3.1709791984e-8
        const expected = Math.sqrt(x); // 1 / 31536000

        const actualSOL = (await deFiMath.sqrtTime(31709792000)).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT_TIME);
      });

      it("sqrtTime when x in [1s, 8192s]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 1; x < 64 * 128; x += 32) {
          const expected = Math.sqrt(x * 31709792000 / 1e18);

          const actualSOL = (await deFiMath.sqrtTime(x * 31709792000)).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT_TIME);
        }
      });

      it("sqrtTime when x in [8192s, 1d]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 8292; x < 86400; x += 8292) {
          const expected = Math.sqrt(x * 31709792000 / 1e18);

          const actualSOL = (await deFiMath.sqrtTime(x * 31709792000)).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT_TIME);
        }
      });

      it("sqrtTime when x in [1d, 1y]", async function () {
        const { deFiMath } = await loadFixture(deploy);
        for (let x = 86400; x < 365 * 86400; x += 86400) {
          const expected = Math.sqrt(x / 31536000);

          const actualSOL = (await deFiMath.sqrtTime(tokens(x / 31536000))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT_TIME);
        }
      });

      it("sqrtTime when x in [1y, 8y]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x < 8.005; x += 0.01) {
          const expected = Math.sqrt(x);

          const actualSOL = (await deFiMath.sqrtTime(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_SQRT_TIME);
        }
      });
    });

    describe("stdNormCDF", function () {
      it("stdNormCDF when x in [0, 16.447)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0; x < 16.447; x += 0.01234) {
          const expected = bs.stdNormCDF(x);

          const actualSOL = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
        }
      });

      it("stdNormCDF when x in [-16.447, 0)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = -16.447; x < 0; x += 0.01234) {
          const expected = bs.stdNormCDF(-x);

          const actualSOL = (await deFiMath.stdNormCDF(tokens(-x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
        }
      });

      it("stdNormCDF when x is int max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = bs.stdNormCDF(x);

        const actualSOL = (await deFiMath.stdNormCDF("57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });

      it("stdNormCDF when x is 16.447", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 16.447;
        const expected = bs.stdNormCDF(x);

        const actualSOL = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });

      it("stdNormCDF when x is int min", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = bs.stdNormCDF(-x);

        const actualSOL = (await deFiMath.stdNormCDF("-57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });

      it("stdNormCDF when x is -16.447", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = -16.447;
        const expected = bs.stdNormCDF(x);

        const actualSOL = (await deFiMath.stdNormCDF(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
      });
    });

    describe("erf", function () {
      it("erf when x is 0", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const actualSOL = (await deFiMath.erf(tokens(0))).toString() / 1e18;
        assert.equal(0, actualSOL);
      });

      it("erf when x in [0, 11.63)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 0; x <= 11.63; x += 0.0250323) {
          const expected = erf(x);

          const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf when x in [-11.63, 0)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = -11.63; x <= 0; x += 0.0250323) {
          const expected = erf(x);

          const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf when x is int max", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf("57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });

      it("erf when x is 11.64", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 11.64;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });

      it("erf when x is int min", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = -57896044618658097711785492504343953926634992332820282019728.792003956564819967;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf("-57896044618658097711785492504343953926634992332820282019728792003956564819967")).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });

      it("erf when x is -11.64", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = -11.64;
        const expected = erf(x);

        const actualSOL = (await deFiMath.erf(tokens(x))).toString() / 1e18;
        assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
      });
    });
  });

});
