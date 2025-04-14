
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { BlackScholesNUMJS } from "../poc/blackscholes/BlackScholesNUMJS.mjs";
import bs from "black-scholes";
import erf from 'math-erf';
import { assertAbsoluteBelow, assertBothBelow, assertRelativeBelow, tokens } from "./Common.test.mjs";

const duoTest = true;

const MAX_ABS_ERROR_ERF = 4.5e-9;
const MAX_ABS_ERROR_CDF = 1.8e-11;
const MAX_REL_ERROR_EXP_POS = 1e-14;
const MAX_REL_ERROR_EXP_POS3 = 5.4e-14;

describe("DeFiMath (SOL and JS)", function () {
  let blackScholesJS;

  async function deploy() {
    const [owner] = await ethers.getSigners();

    const MathWrapper = await ethers.getContractFactory("MathWrapper");
    const deFiMath = await MathWrapper.deploy();

    return { owner, deFiMath };
  }

  async function deployCompare() {
    const [owner] = await ethers.getSigners();

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

    return { owner, deFiMath, prbMath, abdkMath, solady, solStat };
  }

  before(async () => {
    blackScholesJS = new BlackScholesNUMJS();
  });

  duoTest && describe("performance", function () {
    describe("exp", function () {

      it.only("expPositive3 experimental 6.9", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };
        const x = 6.9;

        console.log("expected: ", Math.exp(x));
        console.log("");

        blackScholesJS.expPositive3(x);
        
        let totalGas = parseInt((await deFiMath.expPositiveMG(tokens(x))).gasUsed);
        console.log("2pi gas: ", totalGas); // 362
        
        totalGas = parseInt((await deFiMath.expPositive3MG(tokens(x))).gasUsed);
        console.log("my gas: ", totalGas); // 614, 591 witout > 32, 152 with only pade  

        let result1 = (await deFiMath.expPositiveMG(tokens(x))).y;
        console.log("2pi res: ", result1); 

        let result2 = (await deFiMath.expPositive3MG(tokens(x))).y;
        console.log(" my res: ", result2); 

      });

      it.only("expPositive3 experimental test error for approx", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };
        const x = 6.9;

        let maxError = 0;
        for (let x = 0; x < 0.69; x += 0.0069) {
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.expPositive3(x);

          const error = actualJS - expected;
          if (Math.abs(error) > Math.abs(maxError)) {
            maxError = error;
          }
          //console.log("x", x.toFixed(4), "abs error: ", error, expected, actualJS);
          // assertRelativeBelow(actualJS, expected, MAX_REL_ERROR_EXP_POS);
        }
        console.log("max error: ", maxError);
      });

      it("exp positive 3 < 0.03125", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0; x < 0.03125; x += 0.0003) { 
          const expected = Math.exp(x);
          // const actualJS = blackScholesJS.exp(x);
          // assertRelativeBelow(actualJS, expected, MAX_REL_ERROR_EXP_POS3);

          if (duoTest) {
            const actualSOL = (await deFiMath.expPositive3(tokens(x))).toString() / 1e18;
            // console.log("X", x.toFixed(4), expected, actualSOL);
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS3);
          }
        }
      });

      it("exp positive 3 [0.03125, 0.69)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0.03125; x < 0.69; x += 0.0010125) { 
          const expected = Math.exp(x);
          // const actualJS = blackScholesJS.exp(x);
          // assertRelativeBelow(actualJS, expected, MAX_REL_ERROR_EXP_POS3);

          if (duoTest) {
            const actualSOL = (await deFiMath.expPositive3(tokens(x))).toString() / 1e18;
            // console.log("X", x.toFixed(4), expected, actualSOL);
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS3);
          }
        }
      });

      it("exp positive < 0.03125", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };
        let totalGas = 0, count = 0;
        for (let x = 0; x < 0.03125; x += 0.0003) { 
          totalGas += parseInt((await deFiMath.expPositiveMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });

      it("exp positive [0.03125, 1)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };
        let totalGas = 0, count = 0;
        for (let x = 0.03125; x < 1; x += 0.0020125) { 
          totalGas += parseInt((await deFiMath.expPositiveMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp positive [1, 32)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 32; x += 0.06200125) { 
          totalGas += parseInt((await deFiMath.expPositiveMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp positive [32, 50)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 32; x < 50; x += 0.25600125) { 
          totalGas += parseInt((await deFiMath.expPositiveMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);      
      });

      it("exp negative [-50, -0.05]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 0.05; x <= 50; x += 0.1 ) { 
          totalGas += parseInt((await deFiMath.expMG(tokens(-x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);
      });
    });

    describe("ln", function () {
      it("ln upper [1, 1.0905]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln upper [1.0905, 16]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("ln lower [0.0625, 1)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 0.0625; x < 1; x += 0.002) { 
          totalGas += parseInt((await deFiMath.lnMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("sqrt", function () {
      it("sqrt upper [1, 1.0746]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1.074607828321317497; x += 0.0002) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1.04427, 100)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1.074607828321317497; x < 100; x += 0.2) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [100, 10000)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 100; x < 10000; x += 21.457) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1e4, 1e6)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1e4; x < 1e6; x += 2012.3) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      it("sqrt upper [1e6, 1e8)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1e6; x < 1e8; x += 202463) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });

      // todo: tests for 1 / (1-100, 100-10000, 10000-1000000)
      it("sqrt lower [1e-6, 1)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let x = 1; x < 1000000; x += 2234) {
          totalGas += parseInt((await deFiMath.sqrtMG(tokens(1 / x))).gasUsed);
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);     
      });
    });

    describe("stdNormCDF", function () {
      it("stdNormCDF single", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        const d1 = 0.6100358074173348;

        totalGas += parseInt(await deFiMath.stdNormCDFMG(tokens(d1)));
        count++;
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });

      it("stdNormCDF multiple", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        let totalGas = 0, count = 0;
        for (let d1 = -2; d1 < 2; d1 += 0.01234) {
          totalGas += parseInt(await deFiMath.stdNormCDFMG(tokens(d1)));
          count++;
        }
        console.log("Avg gas: ", Math.round(totalGas / count), "tests: ", count);   
      });
    });
  });

  describe("functionality", function () {
    describe("exp", function () {
      // it("exp experimental positive < 0.03125", async function () {
      //   const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

      //   for (let x = 0; x < 0.03125; x += 0.0003) { 
      //     const expected = Math.exp(x);

      //     if (duoTest) {
      //       const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
      //       console.log("x", x.toFixed(4), "abs error: ", Math.abs(actualSOL - expected), expected, actualSOL);
      //       // assertBothBelow(actualSOL, expected, 0.000000004200, 0.000000000050);
      //     }
      //   }
      // });

      it("exp positive < 0.03125", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0; x < 0.03125; x += 0.0003) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertRelativeBelow(actualJS, expected, MAX_REL_ERROR_EXP_POS);

          if (duoTest) {
            const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
          }
        }
      });

      it("exp positive [0.03125, 1)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0.03125; x < 1; x += 0.0010125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertRelativeBelow(actualJS, expected, MAX_REL_ERROR_EXP_POS);

          if (duoTest) {
            const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
          }
        }
      });

      it("exp positive [1, 32)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1; x < 32; x += 0.03200125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertRelativeBelow(actualJS, expected, MAX_REL_ERROR_EXP_POS);

          if (duoTest) {
            const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
          }
        }
      });

      it("exp positive [32, 50)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 32; x < 50; x += 0.25600125) { 
          const expected = Math.exp(x);
          const actualJS = blackScholesJS.exp(x);
          assertRelativeBelow(actualJS, expected, MAX_REL_ERROR_EXP_POS);

          if (duoTest) {
            const actualSOL = (await deFiMath.expPositive(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, MAX_REL_ERROR_EXP_POS);
          }
        }
      });

      it("exp negative [-50, -0.05]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0.05; x <= 50; x += 0.05 ) { 
          const expected = Math.exp(-x);
          const actualJS = blackScholesJS.exp(-x);
          assertAbsoluteBelow(actualJS, expected, 0.000000000042); // todo

          if (duoTest) {
            const actualSOL = (await deFiMath.exp(tokens(-x))).toString() / 1e18;
            assertAbsoluteBelow(actualSOL, expected, 0.000000000042); // todo
          }
        }
      });
    });

    describe("ln", function () {
      // todo: test all limits like 1.090507732665257659
      it("ln upper [1, 1.0905]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          assertBothBelow(actualJS, expected, 0.000000000150, 0.000000000002);

          if (duoTest) {
            const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000150, 0.000000000002);
          }
        }
      });

      it("ln upper [1.0905, 16]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          if (duoTest) {
            const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000150);
          }
        }
      });

      it("ln lower [0.0625, 1)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0.0625; x < 1; x += 0.001) { 
          const expected = Math.log(x);
          const actualJS = blackScholesJS.ln(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          if (duoTest) {
            const actualSOL = (await deFiMath.ln(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000150);
          }
        }
      });
    });

    describe("log2", function () {
      // todo: test all limits like 1.090507732665257659
      it("log2 upper [1, 1.0905]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          const expected = Math.log2(x);
          const actualJS = blackScholesJS.log2(x);
          assertBothBelow(actualJS, expected, 0.000000000150, 0.000000000002);

          if (duoTest) {
            const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000150, 0.000000000002);
          }
        }
      });

      it("log2 upper [1.0905, 16]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          const expected = Math.log2(x);
          const actualJS = blackScholesJS.log2(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          if (duoTest) {
            const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000150);
          }
        }
      });

      it("log2 lower [0.0625, 1)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0.0625; x < 1; x += 0.001) { 
          const expected = Math.log2(x);
          const actualJS = blackScholesJS.log2(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          if (duoTest) {
            const actualSOL = (await deFiMath.log2(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000150);
          }
        }
      });
    });

    describe("log10", function () {
      // todo: test all limits like 1.090507732665257659
      it("log10 upper [1, 1.0905]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1; x < 1.090507732665257659; x += 0.001) { 
          const expected = Math.log10(x);
          const actualJS = blackScholesJS.log10(x);
          assertBothBelow(actualJS, expected, 0.000000000150, 0.000000000002);

          if (duoTest) {
            const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
            assertBothBelow(actualSOL, expected, 0.000000000150, 0.000000000002);
          }
        }
      });

      it("log10 upper [1.0905, 16]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1.090507732665257659; x < 16; x += 0.1) { 
          const expected = Math.log10(x);
          const actualJS = blackScholesJS.log10(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          // if (duoTest) {
          //   const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          //   assertRelativeBelow(actualSOL, expected, 0.000000000150);
          // }
        }
      });

      it("log10 lower [0.0625, 1)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0.0625; x < 1; x += 0.001) { 
          const expected = Math.log10(x);
          const actualJS = blackScholesJS.log10(x);
          assertRelativeBelow(actualJS, expected, 0.000000000150);

          // if (duoTest) {
          //   const actualSOL = (await deFiMath.log10(tokens(x))).toString() / 1e18;
          //   assertRelativeBelow(actualSOL, expected, 0.000000000150);
          // }
        }
      });
    });

    describe("sqrt", function () {
      // todo: test all limits like 1.04427
      it("sqrt upper [1, 1.0746]", async function () { // root(64, 100) = 1.074607828321317497
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1; x < 1.074607828321317497; x += 0.0001) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [1.04427, 100)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1.074607828321317497; x < 100; x += 0.1) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [100, 10000)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 100; x < 10000; x += 9.89) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [1e4, 1e6)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1e4; x < 1e6; x += 1e3) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt upper [1e6, 1e8)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1e6; x < 1e8; x += 1e5) {
          const expected = Math.sqrt(x);
          const actualJS = blackScholesJS.sqrtUpper(x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await deFiMath.sqrt(tokens(x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000072);
          }
        }
      });

      it("sqrt lower [1e-6, 1)", async function () { // todo: test better
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };
        for (let x = 1; x < 1000000; x += 1234) {
          const expected = Math.sqrt(1 / x);
          const actualJS = blackScholesJS.sqrt(1 / x);
          assertRelativeBelow(actualJS, expected, 0.000000000072);

          if (duoTest) {
            const actualSOL = (await deFiMath.sqrt(tokens(1 / x))).toString() / 1e18;
            assertRelativeBelow(actualSOL, expected, 0.000000000800); // todo: why lower than JS?
          }
        }
      });
    });

    describe("erf", function () {
      it("erf single value in [0, 0.35]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        const x = 0.123;
        const expected = erf(x);

        const actualJS = blackScholesJS.erf(x);
        assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

        if (duoTest) {
          const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf single value in [0.35, 1.13]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        const x = 0.6;
        const expected = erf(x);

        const actualJS = blackScholesJS.erf(x);
        assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

        if (duoTest) {
          const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
          // console.log(expected, actualJS, actualSOL)
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf single value in [1.13, 2.8]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        const x = 1.3;
        const expected = erf(x);

        const actualJS = blackScholesJS.erf(x);
        assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

        if (duoTest) {
          const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf single value in [2.8, 3.5]", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        const x = 3.1;
        const expected = erf(x);

        const actualJS = blackScholesJS.erf(x);
        assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

        if (duoTest) {
          const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf regression", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        const x = 0.01;
        const expected = erf(x);

        const actualJS = blackScholesJS.erf(x);
        assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

        if (duoTest) {
          const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
        }
      });

      it("erf [0, 0.35)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0; x <= 0.35; x += 0.01) {
          const expected = erf(x);

          const actualJS = blackScholesJS.erf(x);
          assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

          if (duoTest) {
            const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
            assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
          }
        }
      });

      it("erf [0.35, 1.13)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 0.35; x <= 1.13; x += 0.01) {
          const expected = erf(x);

          const actualJS = blackScholesJS.erf(x);
          assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

          if (duoTest) {
            const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
            assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF);
          }
        }
      });

      it("erf [1.13, 2.8)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 1.13; x <= 2.8; x += 0.01) {
          const expected = erf(x);

          const actualJS = blackScholesJS.erf(x);
          assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

          if (duoTest) {
            const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
            assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF); // todo: why more than JS, replace Math.sin in JS
          }
        }
      });

      it("erf [2.8, 3.5)", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let x = 2.8; x <= 3.5; x += 0.01) {
          const expected = erf(x);

          const actualJS = blackScholesJS.erf(x);
          assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_ERF);

          if (duoTest) {
            const actualSOL = (await deFiMath.erfPositiveHalf(tokens(x))).toString() / 5e17;
            assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_ERF); // todo: why more than JS, replace Math.sin in JS
          }
        }
      });
    });

    describe("stdNormCDF", function () {
      it("stdNormCDF single", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        const d1 = 0.6100358074173348;
        const expected = bs.stdNormCDF(d1);
        const actualJS = blackScholesJS.stdNormCDF(d1);
        assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_CDF);

        if (duoTest) {
          const actualSOL = (await deFiMath.stdNormCDF(tokens(d1))).toString() / 1e18;
          assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
        }
      });

      it("stdNormCDF multiple", async function () {
        const { deFiMath } = duoTest ? await loadFixture(deploy) : { deFiMath: null };

        for (let d1 = -4; d1 < 4; d1 += 0.01234) {
          const expected = bs.stdNormCDF(d1);
          const actualJS = blackScholesJS.stdNormCDF(d1);
          assertAbsoluteBelow(actualJS, expected, MAX_ABS_ERROR_CDF);

          if (duoTest) {
            const actualSOL = (await deFiMath.stdNormCDF(tokens(d1))).toString() / 1e18;
            assertAbsoluteBelow(actualSOL, expected, MAX_ABS_ERROR_CDF);
          }
        }
      });
    });
  });

    duoTest && describe("compare", function () {
      it("exp", async function () {
        const { deFiMath, prbMath, abdkMath, solady } = await loadFixture(deployCompare);

        let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0, avgError1 = 0, avgError2 = 0, avgError3 = 0, avgError4 = 0;
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
          avgError1 += error1;
          avgError2 += error2;
          avgError3 += error3;
          avgError4 += error4;
          maxError1 = Math.max(maxError1, error1);
          maxError2 = Math.max(maxError2, error2);
          maxError3 = Math.max(maxError3, error3);
          maxError4 = Math.max(maxError4, error4);
        }
        console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
        console.log("Avg rel error (%) ", (avgError1 / count).toExponential(1) + "  ", (avgError2 / count).toExponential(1) + "  ", (avgError3 / count).toExponential(1) + "  ", (avgError4 / count).toExponential(1));
        console.log("Max rel error (%)  ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1) + "  ", (maxError4).toExponential(1));
        console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "     " + (avgGas3 / count).toFixed(0), "      " + (avgGas4 / count).toFixed(0));
      });

      it("ln", async function () {
        const { deFiMath, prbMath, abdkMath, solady } = await loadFixture(deployCompare);

        let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0, avgError1 = 0, avgError2 = 0, avgError3 = 0, avgError4 = 0;
        let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
        let count = 0;

        for (let x = 1/16; x <= 16; x += 0.0123 ) { // todo: range should be wider
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
          avgError1 += error1;
          avgError2 += error2;
          avgError3 += error3;
          avgError4 += error4;
          maxError1 = Math.max(maxError1, error1);
          maxError2 = Math.max(maxError2, error2);
          maxError3 = Math.max(maxError3, error3);
          maxError4 = Math.max(maxError4, error4);
        }
        console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
        console.log("Avg rel error (%) ", (avgError1 / count).toExponential(1) + "  ", (avgError2 / count).toExponential(1) + "  ", (avgError3 / count).toExponential(1) + "  ", (avgError4 / count).toExponential(1));
        console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1) + "  ", (maxError4).toExponential(1));
        console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "    " + (avgGas3 / count).toFixed(0), "      " + (avgGas4 / count).toFixed(0));
      });

      it("log2", async function () {
        const { deFiMath, prbMath, abdkMath } = await loadFixture(deployCompare);

        let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0, avgError1 = 0, avgError2 = 0, avgError3 = 0, avgError4 = 0;
        let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
        let count = 0;

        for (let x = 1/16; x <= 16; x += 0.0123 ) { // todo: range should be wider
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
          avgError1 += error1;
          avgError2 += error2;
          avgError3 += error3;
          maxError1 = Math.max(maxError1, error1);
          maxError2 = Math.max(maxError2, error2);
          maxError3 = Math.max(maxError3, error3);
        }
        console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
        console.log("Avg rel error (%) ", (avgError1 / count).toExponential(1) + "  ", (avgError2 / count).toExponential(1) + "  ", (avgError3 / count).toExponential(1));
        console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1));
        console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "    " + (avgGas3 / count).toFixed(0));
      });

      it("log10", async function () {
        const { deFiMath, prbMath } = await loadFixture(deployCompare);

        let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0, avgError1 = 0, avgError2 = 0, avgError3 = 0, avgError4 = 0;
        let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
        let count = 0;

        for (let x = 1/16; x <= 16; x += 0.0123 ) { // todo: range should be wider
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
          avgError1 += error1;
          avgError2 += error2;
          maxError1 = Math.max(maxError1, error1);
          maxError2 = Math.max(maxError2, error2);
        }
        console.log("Metric            DeFiMath   PRBMath  ABDKQuad");
        console.log("Avg rel error (%) ", (avgError1 / count).toExponential(1) + "  ", (avgError2 / count).toExponential(1));
        console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1));
        console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0));
      });

      it("sqrt", async function () {
        const { deFiMath, prbMath, abdkMath, solady } = await loadFixture(deployCompare);

        let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0, avgError1 = 0, avgError2 = 0, avgError3 = 0, avgError4 = 0;
        let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
        let count = 0;

        for (let x = 1e-6; x <= 1e8; x += x / 4) {
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
          avgError1 += error1;
          avgError2 += error2;
          avgError3 += error3;
          avgError4 += error4;
          maxError1 = Math.max(maxError1, error1);
          maxError2 = Math.max(maxError2, error2);
          maxError3 = Math.max(maxError3, error3);
          maxError4 = Math.max(maxError4, error4);
        }
        console.log("Metric            DeFiMath   PRBMath  ABDKQuad    Solady");
        console.log("Avg rel error (%) ", (avgError1 / count).toExponential(1) + "  ", (avgError2 / count).toExponential(1) + "  ", (avgError3 / count).toExponential(1) + "  ", (avgError4 / count).toExponential(1));
        console.log("Max rel error (%) ", (maxError1).toExponential(1) + "  ", (maxError2).toExponential(1) + "  ", (maxError3).toExponential(1) + "  ", (maxError4).toExponential(1));
        console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "     " + (avgGas2 / count).toFixed(0), "    " + (avgGas3 / count).toFixed(0), "      " + (avgGas4 / count).toFixed(0));
      });

      it("cdf", async function () {
        const { deFiMath, solStat } = await loadFixture(deployCompare);

        let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0, avgError1 = 0, avgError2 = 0, avgError3 = 0, avgError4 = 0;
        let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
        let count = 0;

        for (let x = -4; x <= 4; x += 0.123) {
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
          avgError1 += error1;
          avgError4 += error4;
          maxError1 = Math.max(maxError1, error1);
          maxError4 = Math.max(maxError4, error4);
        }
        console.log("Metric            DeFiMath  SolStat");
        console.log("Avg rel error (%) ", (avgError1 / count).toExponential(1) + "  ", (avgError4 / count).toExponential(1));
        console.log("Max rel error (%)  ", (maxError1).toExponential(1) + "  ", (maxError4).toExponential(1));
        console.log("Avg gas              ", (avgGas1 / count).toFixed(0), "    " + (avgGas4 / count).toFixed(0));
      });

      it("erf", async function () {
        const { deFiMath, solStat } = await loadFixture(deployCompare);

        let maxError1 = 0, maxError2 = 0, maxError3 = 0, maxError4 = 0, avgError1 = 0, avgError2 = 0, avgError3 = 0, avgError4 = 0;
        let avgGas1 = 0, avgGas2 = 0, avgGas3 = 0, avgGas4 = 0, avgGas5 = 0;
        let count = 0;

        for (let x = 0.0001; x <= 3.5; x += 0.123) { // todo: handle 0
          const expected = erf(x);

          // DeFiMath
          const result1 = await deFiMath.erfMG(tokens(x));
          const y1 = result1.y.toString() / 5e17;
          avgGas1 += parseInt(result1.gasUsed);

          // SolStat
          const result4 = await solStat.erfMG(tokens(x));

          const y4 = result4.y.toString() / 1e18;
          avgGas4 += parseInt(result4.gasUsed);

          count++;
          const error1 = Math.abs((y1 - expected) / expected) * 100;
          const error4 = Math.abs((y4 - expected) / expected) * 100;
          avgError1 += error1;
          avgError4 += error4;
          maxError1 = Math.max(maxError1, error1);
          maxError4 = Math.max(maxError4, error4);
        }
        console.log("Metric            DeFiMath  SolStat");
        console.log("Avg rel error (%)  ", (avgError1 / count).toExponential(1) + "  ", (avgError4 / count).toExponential(1));
        console.log("Max rel error (%)  ", (maxError1).toExponential(1) + "  ", (maxError4).toExponential(1));
        console.log("Avg gas               ", (avgGas1 / count).toFixed(0), "    " + (avgGas4 / count).toFixed(0));
      });
  });
});
