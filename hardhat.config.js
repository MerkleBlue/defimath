require("@nomicfoundation/hardhat-toolbox");
require("solidity-coverage");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.35",
    settings: {
      evmVersion: "osaka",
      viaIR: true, // enable for coverage
      optimizer: {
        enabled: true,
        runs: 10_000_000,
      },
    },
  },
  paths: {
    tests: "./test/hardhat",
  },
  mocha: {
    timeout: 90000000000
  },
  networks: {
    hardhat: {
        blockGasLimit: 1000000000000 // whatever you want here
    },
}
};
