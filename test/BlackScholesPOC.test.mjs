import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import  expect from "chai";

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

    it("gets call price map U", async function () {
      const { bs } = await loadFixture(deploy);

      const callPriceMap = await bs.getCallPriceMapU(100, 100, 1000, 1, 1);
      console.log(callPriceMap);

      const estGas2 = await bs.getCallPriceMapU.estimateGas(100, 100, 1000, 1, 1);
      console.log("Gas spent map:", parseInt(estGas2) - 21000);
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

  describe("Deployment", function () {
  });

  // describe("Withdrawals", function () {
  //   describe("Validations", function () {
  //     it("Should revert with the right error if called too soon", async function () {
  //       const { lock } = await loadFixture(deploy);

  //       await expect(lock.withdraw()).to.be.revertedWith(
  //         "You can't withdraw yet"
  //       );
  //     });

  //     it("Should revert with the right error if called from another account", async function () {
  //       const { lock, unlockTime, otherAccount } = await loadFixture(
  //         deploy
  //       );

  //       // We can increase the time in Hardhat Network
  //       await time.increaseTo(unlockTime);

  //       // We use lock.connect() to send a transaction from another account
  //       await expect(lock.connect(otherAccount).withdraw()).to.be.revertedWith(
  //         "You aren't the owner"
  //       );
  //     });

  //     it("Shouldn't fail if the unlockTime has arrived and the owner calls it", async function () {
  //       const { lock, unlockTime } = await loadFixture(
  //         deploy
  //       );

  //       // Transactions are sent using the first signer by default
  //       await time.increaseTo(unlockTime);

  //       await expect(lock.withdraw()).not.to.be.reverted;
  //     });
  //   });

  //   describe("Events", function () {
  //     it("Should emit an event on withdrawals", async function () {
  //       const { lock, unlockTime, lockedAmount } = await loadFixture(
  //         deploy
  //       );

  //       await time.increaseTo(unlockTime);

  //       await expect(lock.withdraw())
  //         .to.emit(lock, "Withdrawal")
  //         .withArgs(lockedAmount, anyValue); // We accept any value as `when` arg
  //     });
  //   });

  //   describe("Transfers", function () {
  //     it("Should transfer the funds to the owner", async function () {
  //       const { lock, unlockTime, lockedAmount, owner } = await loadFixture(
  //         deploy
  //       );

  //       await time.increaseTo(unlockTime);

  //       await expect(lock.withdraw()).to.changeEtherBalances(
  //         [owner, lock],
  //         [lockedAmount, -lockedAmount]
  //       );
  //     });
  //   });
  // });
});
