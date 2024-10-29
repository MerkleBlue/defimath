import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { assert, expect } from "chai";

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



    // it("Should fail if the unlockTime is not in the future", async function () {
    //   // We don't use the fixture here because we want a different deployment
    //   const latestTime = await time.latest();
    //   const Lock = await ethers.getContractFactory("Lock");
    //   await expect(Lock.deploy(latestTime, { value: 1 })).to.be.revertedWith(
    //     "Unlock time should be in the future"
    //   );
    // });
  });

  describe.only("Time indexes", function () {
    // // before each test
    // beforeEach(() => {
    //   blackScholesJS = new BlackScholesJS();
    // });

    async function getActualExpected(bs, time) {
      const actual = await bs.getIndex(time);
      // check index against log2, which we don't have in JS
      const major = Math.floor(Math.log2(time));
      const minor = Math.floor((time - 2 ** major) / 2 ** (major - 3));
      const expected = major * 10 + minor;
      return { actual, expected };
    }

    it.only("gas spent", async function () {
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
