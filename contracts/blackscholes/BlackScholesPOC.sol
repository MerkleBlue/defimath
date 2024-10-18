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

    Range [] public ranges;


    constructor() {
        uint32 length = 100;
        for (uint32 i = 0; i < length; i++) {
            ranges.push(Range({
                num1: i + 1,
                num2: i + 1,
                num3: i + 1,
                num4: i + 1
            }));
        }
    }

    function getCallPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint80 volatility
    ) external view returns (uint256 price) {
        // access array element
        Range memory range = ranges[4];

        // calcualate price
        price = range.num1;
    }
}
