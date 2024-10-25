// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesPOC {
    struct Range {
        uint64 num1;
        uint64 num2;
        uint64 num3;
        uint64 num4;
    }

    // single mapping is faster than map of map 
    mapping(uint40 => Range) private rangeMap;

    mapping(uint40 => uint256) private rangeMapU;

    constructor() {
        uint32 lenA = 10;
        uint32 lenB = 10;
        // fill the map
        for (uint32 i = 0; i < lenA; i++) {
            for (uint32 j = 0; j < lenB; j++) {
                rangeMap[uint40(i) * 1e6 + uint40(j)] = Range({
                    num1: 5,
                    num2: 6,
                    num3: 7,
                    num4: 8
                });
            }
        }

        // fill the map
        for (uint32 i = 0; i < lenA; i++) {
            for (uint32 j = 0; j < lenB; j++) {
                rangeMapU[uint40(i) * 1e6 + uint40(j)] = 5 * 1e54 + 6 * 1e36 + 7 * 1e18 + 8;
            }
        }
    }

    function getCallPriceMap(
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
            Range storage range = rangeMap[index1 * 1e6 + index2];

            // calcualate price
            price = range.num1 + range.num2 + range.num3 + range.num4;
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

            uint256 num1 = range / 1e54;
            uint256 num2 = range / 1e36 - num1 * 1e18;
            uint256 num3 = range / 1e18 - num1 * 1e36 - num2 * 1e18;
            uint256 num4 = range - num1 * 1e54 - num2 * 1e36 - num3 * 1e18;
            // uint64 num4 = range.num4;

            // calcualate price
            price = num1 + num2 + num3 + num4;
        
        }
    }
}
