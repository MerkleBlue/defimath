// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract BlackScholesPOC {
    uint256 internal constant TWO_POW_64 = 2 ** 64;
    uint256 internal constant TWO_POW_128 = 2 ** 128;
    uint256 internal constant TWO_POW_192 = 2 ** 192;

    struct Range {
        uint64 num1;
        uint64 num2;
        uint64 num3;
        uint64 num4;
    }

    // single mapping is faster than map of map 
    mapping(uint40 => uint256) private rangeMapU;

    constructor() {
        uint32 lenA = 10;
        uint32 lenB = 10;
        // fill the map
        for (uint32 i = 0; i < lenA; i++) {
            for (uint32 j = 0; j < lenB; j++) {
                rangeMapU[uint40(i) * 1e6 + uint40(j)] = 5 * TWO_POW_192 + 6 * TWO_POW_128 + 7 * TWO_POW_64 + 8;
            }
        }
    }

    function getCallPriceMapU(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint80 volatility,
        uint32 riskFreeRate
    ) external view returns (uint256 price) {
        unchecked {
            // calculate indexes
            uint40 index1 = 4;
            uint40 index2 = 6;

            // access array element
            uint256 range = rangeMapU[index1 * 1e6 + index2];


            // uint256 startGas;
            // uint256 endGas;
            // console.log("Method 2");
            // startGas = gasleft();
            uint256 num1 = range / TWO_POW_192;
            uint256 num2 = uint64(range / TWO_POW_128);
            uint256 num3 = uint64(range / TWO_POW_64);
            uint256 num4 = uint64(range);
            // endGas = gasleft();
            // console.log("gas used: %d", startGas - endGas);

            // calcualate price
            price = num1 + num2 + num3 + num4;
        
        }
    }
}
