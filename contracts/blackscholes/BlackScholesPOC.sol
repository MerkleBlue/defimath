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

    // Range [] private rangeArray;

    mapping(uint40 => Range) private rangeMap;


    constructor() {
        uint32 length = 100;
        // // fill the array
        // for (uint32 i = 0; i < length; i++) {
        //     rangeArray.push(Range({
        //         num1: i + 1,
        //         num2: i + 1,
        //         num3: i + 1,
        //         num4: i + 1
        //     }));
        // }

        // fill the map
        for (uint32 i = 0; i < length; i++) {
            rangeMap[uint40(i)] = Range({
                num1: i + 1,
                num2: i + 1,
                num3: i + 1,
                num4: i + 1
            });
        }
    }

    // function getCallPrice(
    //     uint128 spot,
    //     uint128 strike,
    //     uint32 timeToExpirySec,
    //     uint80 volatility,
    //     uint32 riskFreeRate
    // ) external view returns (uint256 price) {
    //     // access array element
    //     Range memory range = rangeArray[4];

    //     // calcualate price
    //     price = range.num1;
    // }

    function getCallPriceMap(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint80 volatility,
        uint32 riskFreeRate
    ) external view returns (uint256 price) {
        // access array element
        Range memory range = rangeMap[4];

        // calcualate price
        price = range.num1;
    }
}
