require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // solidity: "0.8.27",
  solidity: {
    version: "0.8.27",
    settings: {
      viaIR: true,
    },
  },
};
