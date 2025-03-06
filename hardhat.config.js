require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 9999,
      },
    },
  },
  // paths: {
  //   sources: "./contracts/blackscholes",
  // },
  mocha: {
    timeout: 90000000000
  },
  networks: {
    hardhat: {
        blockGasLimit: 1000000000000 // whatever you want here
    },
}
};
