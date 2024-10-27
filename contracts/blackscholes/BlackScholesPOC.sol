// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesPOC {
    uint256 internal constant TWO_POW_64 = 2 ** 64;
    uint256 internal constant TWO_POW_128 = 2 ** 128;
    uint256 internal constant TWO_POW_192 = 2 ** 192;

    // single mapping is faster than map of map, uint is faster than struct
    mapping(uint40 => uint256) private rangeMap;

    constructor() {
        uint32 lenA = 10;
        uint32 lenB = 10;
        // fill the map
        for (uint32 i = 0; i < lenA; i++) {
            for (uint32 j = 0; j < lenB; j++) {
                rangeMap[uint40(i) * 1e6 + uint40(j)] = 5 * TWO_POW_192 + 6 * TWO_POW_128 + 7 * TWO_POW_64 + 8;
            }
        }
    }

    function getCallPrice(
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
            uint256 range = rangeMap[index1 * 1e6 + index2];


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

    function testGas() external view returns (uint256 price) {
        unchecked {
            // calculate indexes
            uint40 index1 = 4;
            uint40 index2 = 6;

            // access array element
            uint256 range = rangeMap[index1 * 1e6 + index2];


            uint256 startGas;
            uint256 endGas;

            {
                startGas = gasleft();
                range / TWO_POW_192;
                endGas = gasleft();
                console.log("gas used uint256 / uint256  : %d", startGas - endGas);
            }

            {
                uint128 num1 = 80000;
                uint128 num2 = 200;
                startGas = gasleft();
                num1 / num2;
                endGas = gasleft();
                console.log("gas used uint128 / uint128  : %d", startGas - endGas);     
            }


            {
                uint8 num1 = 16;
                uint8 num2 = 4;
                startGas = gasleft();
                num1 / num2;
                endGas = gasleft();
                console.log("gas used uint8 / uint8  : %d", startGas - endGas);     
            }

            {
                uint256 num1 = 2;
                uint256 num2 = 128;
                startGas = gasleft();
                num1 ** num2;
                endGas = gasleft();
                console.log("gas used uint256 ** uint256  : %d", startGas - endGas); 
                console.log("result  : %d", num1 ** num2);     
            }
        }
    }
}
