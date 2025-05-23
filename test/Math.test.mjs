
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { BlackScholesNUMJS } from "../poc/blackscholes/BlackScholesNUMJS.mjs";
import bs from "black-scholes";
import erf from 'math-erf';
import { assertAbsoluteBelow, assertRelativeBelow, assertRevertError, tokens } from "./Common.test.mjs";
import { assert } from "chai";

const MAX_REL_ERROR_EXP_POS = 5.4e-14;
const MAX_REL_ERROR_LN = 1.6e-15;
const MAX_REL_ERROR_LN16 = 1.4e-12;
const MAX_REL_ERROR_SQRT = 2.2e-14;
const MAX_REL_ERROR_SQRT_TIME = 9e-15;
const MAX_ABS_ERROR_ERF = 4.5e-9;
const MAX_ABS_ERROR_CDF = 6.4e-15;

describe("DeFiMath", function () {

  async function deploy() {
    const MathWrapper = await ethers.getContractFactory("MathWrapper");
    const deFiMath = await MathWrapper.deploy();

    return { deFiMath };
  }

  async function deployCompare() {
    const MathWrapper = await ethers.getContractFactory("MathWrapper");
    const deFiMath = await MathWrapper.deploy();

    const AdapterPRBMath = await ethers.getContractFactory("AdapterPRBMath");
    const prbMath = await AdapterPRBMath.deploy();

    const AdapterABDKMath = await ethers.getContractFactory("AdapterABDKMath");
    const abdkMath = await AdapterABDKMath.deploy();

    const AdapterSolady = await ethers.getContractFactory("AdapterSolady");
    const solady = await AdapterSolady.deploy();

    const AdapterSolStat = await ethers.getContractFactory("AdapterSolStat");
    const solStat = await AdapterSolStat.deploy();

    return { deFiMath, prbMath, abdkMath, solady, solStat };
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

    describe("ln16", function () {
      it("ln16 when x in [1, 16]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 1; x < 16; x += 0.16 / 4) { 
          totalGas += parseInt((await deFiMath.ln16MG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln16 when x in [0.0625, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        let totalGas = 0, count = 0;
        for (let x = 0.0625; x < 1; x += 0.0625 / 24) { 
          totalGas += parseInt((await deFiMath.ln16MG(tokens(x))).gasUsed);
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

    describe("ln16", function () {
      it("ln16 when x in [1, 2]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 2.005; x += 0.01) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln16(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN16);
        }
      });

      it("ln16 when x in [2, 16]", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 2; x <= 2 ** 4; x += 0.2505638) { 
          const expected = Math.log(x);
          
          const actualSOL = (await deFiMath.ln16(tokens(x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN16);
        }
      });

      it("ln16 when x is 1", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 1;
        const actualSOL = (await deFiMath.ln16(tokens(x))).toString() / 1e18;
        assert.equal(actualSOL, 0);
      });

      it("ln when x is 16", async function () {
        const { deFiMath } = await loadFixture(deploy);

        const x = 16;
        const expected = Math.log(x);
        
        const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
        assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN16);
      });

      // todo: add random tests

      it("ln when x in [0.0625, 1)", async function () {
        const { deFiMath } = await loadFixture(deploy);

        for (let x = 1; x <= 16.08; x += 0.16) { 
          const expected = Math.log(1 / x);

          const actualSOL = (await deFiMath.ln(tokens(1 / x))).toString() / 1e18;
          assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_LN16);
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

  describe("compare", function () {
    it("exp", async function () {
      const { deFiMath, prbMath, abdkMath, solady } = await loadFixture(deployCompare);

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (let x = -10; x <= 10; x += 0.123 ) { 
        const expected = Math.exp(x);

        // DeFiMath
        const result1 = await deFiMath.expMG(tokens(x));
        const y1 = result1.y.toString() / 1e18;
        avgGas1 += parseInt(result1.gasUsed);

        // PRBMath
        const result2 = await prbMath.expMG(tokens(x));
        const y2 = result2.y.toString() / 1e18;
        avgGas2 += parseInt(result2.gasUsed);

        // ABDKMath
        const result3 = await abdkMath.expMG(tokens(x));
        const y3 = result3.y.toString() / 1e18;
        avgGas3 += parseInt(result3.gasUsed);

        // Solady
        const result4 = await solady.expMG(tokens(x));
        const y4 = result4.y.toString() / 1e18;
        avgGas4 += parseInt(result4.gasUsed);

        count++;
        const error1 = Math.abs((y1 - expected) / expected) * 100;
        const error2 = Math.abs((y2 - expected) / expected) * 100;
        const error3 = Math.abs((y3 - expected) / expected) * 100;
        const error4 = Math.abs((y4 - expected) / expected) * 100;
        maxError1 = Math.max(maxError1, error1);
        maxError2 = Math.max(maxError2, error2);
        maxError3 = Math.max(maxError3, error3);
        maxError4 = Math.max(maxError4, error4);
      }
      console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
      console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1) + "  ", (maxError4).toExponential(1));
      console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "     " + (avgGas3 / count).toFixed(0), "      " + (avgGas4 / count).toFixed(0));
    });

    it("ln", async function () {
      const { deFiMath, prbMath, abdkMath, solady } = await loadFixture(deployCompare);

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (let x = 1/16; x <= 16; x += 0.0123 ) {
        const expected = Math.log(x);

        // DeFiMath
        const result1 = await deFiMath.lnMG(tokens(x));
        const y1 = result1.y.toString() / 1e18;
        avgGas1 += parseInt(result1.gasUsed);

        // PRBMath
        const result2 = await prbMath.lnMG(tokens(x));
        const y2 = result2.y.toString() / 1e18;
        avgGas2 += parseInt(result2.gasUsed);

        // ABDKMath
        const result3 = await abdkMath.lnMG(tokens(x));
        const y3 = result3.y.toString() / 1e18;
        avgGas3 += parseInt(result3.gasUsed);

        // Solady
        const result4 = await solady.lnMG(tokens(x));
        const y4 = result4.y.toString() / 1e18;
        avgGas4 += parseInt(result4.gasUsed);

        count++;
        const error1 = Math.abs((y1 - expected) / expected) * 100;
        const error2 = Math.abs((y2 - expected) / expected) * 100;
        const error3 = Math.abs((y3 - expected) / expected) * 100;
        const error4 = Math.abs((y4 - expected) / expected) * 100;
        maxError1 = Math.max(maxError1, error1);
        maxError2 = Math.max(maxError2, error2);
        maxError3 = Math.max(maxError3, error3);
        maxError4 = Math.max(maxError4, error4);
      }
      console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
      console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1) + "  ", (maxError4).toExponential(1));
      console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "    " + (avgGas3 / count).toFixed(0), "      " + (avgGas4 / count).toFixed(0));
    });

    it("log2", async function () {
      const { deFiMath, prbMath, abdkMath } = await loadFixture(deployCompare);

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (let x = 1/16; x <= 16; x += 0.0123 ) {
        const expected = Math.log2(x);

        // DeFiMath
        const result1 = await deFiMath.log2MG(tokens(x));
        const y1 = result1.y.toString() / 1e18;
        avgGas1 += parseInt(result1.gasUsed);

        // PRBMath
        const result2 = await prbMath.log2MG(tokens(x));
        const y2 = result2.y.toString() / 1e18;
        avgGas2 += parseInt(result2.gasUsed);

        // ABDKMath
        const result3 = await abdkMath.log2MG(tokens(x));
        const y3 = result3.y.toString() / 1e18;
        avgGas3 += parseInt(result3.gasUsed);

        count++;
        const error1 = Math.abs((y1 - expected) / expected) * 100;
        const error2 = Math.abs((y2 - expected) / expected) * 100;
        const error3 = Math.abs((y3 - expected) / expected) * 100;
        maxError1 = Math.max(maxError1, error1);
        maxError2 = Math.max(maxError2, error2);
        maxError3 = Math.max(maxError3, error3);
      }
      console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
      console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1));
      console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "    " + (avgGas3 / count).toFixed(0));
    });

    it("log10", async function () {
      const { deFiMath, prbMath } = await loadFixture(deployCompare);

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (let x = 1/16; x <= 16; x += 0.0123 ) {
        const expected = Math.log10(x);

        // DeFiMath
        const result1 = await deFiMath.log10MG(tokens(x));
        const y1 = result1.y.toString() / 1e18;
        avgGas1 += parseInt(result1.gasUsed);

        // PRBMath
        const result2 = await prbMath.log10MG(tokens(x));
        const y2 = result2.y.toString() / 1e18;
        avgGas2 += parseInt(result2.gasUsed);

        count++;
        const error1 = Math.abs((y1 - expected) / expected) * 100;
        const error2 = Math.abs((y2 - expected) / expected) * 100;
        maxError1 = Math.max(maxError1, error1);
        maxError2 = Math.max(maxError2, error2);
      }
      console.log("Metric            DeFiMath   PRBMath  ABDKQuad");
      console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1));
      console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0));
    });

    it("sqrt", async function () {
      const { deFiMath, prbMath, abdkMath, solady } = await loadFixture(deployCompare);

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (let x = 1e-4; x <= 1e4; x += x / 4) {
        const expected = Math.sqrt(x);

        // DeFiMath
        const result1 = await deFiMath.sqrtMG(tokens(x));
        const y1 = result1.y.toString() / 1e18;
        avgGas1 += parseInt(result1.gasUsed);

        // PRBMath
        const result2 = await prbMath.sqrtMG(tokens(x));
        const y2 = result2.y.toString() / 1e18;
        avgGas2 += parseInt(result2.gasUsed);

        // ABDKMath
        const result3 = await abdkMath.sqrtMG(tokens(x));
        const y3 = result3.y.toString() / 1e18;
        avgGas3 += parseInt(result3.gasUsed);

        // Solady
        const result4 = await solady.sqrtMG(tokens(x));
        const y4 = result4.y.toString() / 1e18;
        avgGas4 += parseInt(result4.gasUsed);

        count++;
        const error1 = Math.abs((y1 - expected) / expected) * 100;
        const error2 = Math.abs((y2 - expected) / expected) * 100;
        const error3 = Math.abs((y3 - expected) / expected) * 100;
        const error4 = Math.abs((y4 - expected) / expected) * 100;
        maxError1 = Math.max(maxError1, error1);
        maxError2 = Math.max(maxError2, error2);
        maxError3 = Math.max(maxError3, error3);
        maxError4 = Math.max(maxError4, error4);
      }
      console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
      console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1) + "  ", (maxError4).toExponential(1));
      console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "      " + (avgGas2 / count).toFixed(0), "      " + (avgGas3 / count).toFixed(0), "      " + (avgGas4 / count).toFixed(0));
    });

    it("stdNormCDF", async function () {
      const { deFiMath, solStat } = await loadFixture(deployCompare);

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (let x = 0.5; x <= 10; x += 0.123) {
        const expected = bs.stdNormCDF(x);

        // DeFiMath
        const result1 = await deFiMath.stdNormCDFMG(tokens(x));
        const y1 = result1.y.toString() / 1e18;
        avgGas1 += parseInt(result1.gasUsed);

        // SolStat
        const result4 = await solStat.cdfMG(tokens(x));
        const y4 = result4.y.toString() / 1e18;
        avgGas4 += parseInt(result4.gasUsed);

        count++;
        const error1 = Math.abs((y1 - expected) / expected) * 100;
        const error4 = Math.abs((y4 - expected) / expected) * 100;
        maxError1 = Math.max(maxError1, error1);
        maxError4 = Math.max(maxError4, error4);
      }
      console.log("Metric            DeFiMath  SolStat");
      console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError4).toExponential(1));
      console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "    " + (avgGas4 / count).toFixed(0));
    });

    it("erf", async function () {
      const { deFiMath, solStat } = await loadFixture(deployCompare);

      let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0;
      let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
      let count = 0;

      for (let x = 0.5; x <= 10; x += 0.123) {
        const expected = erf(x);

        // DeFiMath
        const result1 = await deFiMath.erfMG(tokens(x));
        const y1 = result1.y.toString() / 1e18;
        avgGas1 += parseInt(result1.gasUsed);

        // SolStat
        const result4 = await solStat.erfMG(tokens(x));
        const y4 = result4.y.toString() / 1e18;
        avgGas4 += parseInt(result4.gasUsed);

        count++;
        const error1 = Math.abs((y1 - expected) / expected) * 100;
        const error4 = Math.abs((y4 - expected) / expected) * 100;
        maxError1 = Math.max(maxError1, error1);
        maxError4 = Math.max(maxError4, error4);
      }
      console.log("Metric            DeFiMath  SolStat");
      console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError4).toExponential(1));
      console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "    " + (avgGas4 / count).toFixed(0));
    });
  });
});
