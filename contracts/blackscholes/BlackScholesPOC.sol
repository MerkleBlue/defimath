// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";
import "./TickMath.sol";

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

    function getIndexGas(uint256 value) public view returns (uint256) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        unchecked {
            uint256 index = getIndex(value);
        }

        endGas = gasleft();
        console.log("gas used: %d", startGas - endGas);
    }

    function getIndex(uint256 value) public pure returns (uint256) {
        unchecked {
            if (value <= 8) {
                return value;
            }

            // find major
            uint256 min = 2;
            uint256 max = 32;
            uint256 major = 0;

            uint256 mid;
            uint256 power;
            while (min <= max) {
                mid = (min + max) / 2;
                power = 2 ** mid;

                if (power <= value) {
                    major = mid; // mid is a valid candidate
                    min = mid + 1; // search for a larger power
                } else {
                    max = mid - 1; // search for a smaller power
                }
            }

            // // find major 2
            // uint256 major = 5;
            // if (0x8 >= value) major = 3; // 274
            // if (0x10 >= value) major = 4; // 297
            // if (0x20 >= value) major = 5; // 297



            // find minor 
            uint256 twoToPowerMinus3 = 2 ** (major - 3);
            uint256 minor = (value - twoToPowerMinus3 * 8) / twoToPowerMinus3;

            return major * 10 + minor;
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

            {
                uint256 num1 = 12030312;
                uint256 num2 = 12423;
                startGas = gasleft();
                num1 - num2;
                endGas = gasleft();
                console.log("gas used uint256 - uint256  : %d", startGas - endGas); 
                console.log("result  : %d", num1 - num2);     
            }

            {
                uint256 value = 2 ** 12 + 243;
                uint256 power = 12;
                startGas = gasleft();
                
                // 137 gas
                // uint256 twoToPowerMinus3 = 2 ** (power - 3);
                // uint256 res1 = (value - twoToPowerMinus3 * 8) / twoToPowerMinus3;
                
                uint256 result;
                assembly {
                    let powerValue := exp(2, power)
                    let powerMinusThreeValue := exp(2, sub(power, 3))
                    
                    // Perform (value - powerValue) / powerMinusThreeValue
                    result := div(sub(value, powerValue), powerMinusThreeValue)
                }


                // uint res1 = 180000 / 90; // (2 ** (power - 3));
                endGas = gasleft();
                console.log("gas used complex  : %d", startGas - endGas); 
                // console.log("result  : %d", num1 ** num2);     
            }

            {
                uint256 num1 = 12030312;
                uint256 num2 = 12423;
                startGas = gasleft();
                TickMath.getTickAtSqrtRatio(429512873900003);
                endGas = gasleft();
                console.log("gas used TickMath.getTickAtSqrtRatio  : %d", startGas - endGas); 
                // console.log("result  : %d", num1 - num2);     
            }
            
        }
    }
}
