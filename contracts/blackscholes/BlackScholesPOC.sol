// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesPOC {
    uint256 internal constant TWO_POW_64 = 2 ** 64;
    uint256 internal constant TWO_POW_128 = 2 ** 128;
    uint256 internal constant TWO_POW_192 = 2 ** 192;

    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    uint256 internal constant SPOT_FIXED = 1e20; // $100
    uint256 internal constant VOL_FIXED = 1e18; // 100%

    // single mapping is faster than map of map, uint is faster than struct
    mapping(uint40 => uint256) private lookupTable;

    constructor() {
        // uint32 lenA = 10;
        // uint32 lenB = 10;
        // // fill the map
        // for (uint32 i = 0; i < lenA; i++) {
        //     for (uint32 j = 0; j < lenB; j++) {
        //         lookupTable[uint40(i) * 1e6 + uint40(j)] = 5 * TWO_POW_192 + 6 * TWO_POW_128 + 7 * TWO_POW_64 + 8;
        //     }
        // }
    }

    // todo: access management 
    function setLookupTableElements(uint40 [] calldata indexes, uint256 [] calldata data) external {
        for (uint256 i = 0; i < indexes.length; i++) {
            // update is not allowed
            // NOTE: todo: some values can be 0, so we need a flag that tells us if the value is set
            if (lookupTable[indexes[i]] == 0) {
                lookupTable[indexes[i]] = data[i];
            }
        }
    }

    function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) public pure returns (uint256) {
        unchecked {
            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)

            // NOTE: this is slower than below
            // uint256 timeToExpiryYears = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;
            // uint256 x = rate * timeToExpiryYears / 1e13;

            // NOTE: this is faster than the above 
            uint256 x = uint256(timeToExpirySec) * 1e5 * rate / SECONDS_IN_YEAR;

            // todo: check x is not more than 0.2

            uint256 numerator = (x + 3e9) ** 2 + 3e18;
            uint256 denominator = (3e9 - x) ** 2 + 3e18;

            return numerator * spot / denominator;
        }
    }

    function getCallPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint80 volatility,
        uint16 rate
    ) external view returns (uint256 price) {
        unchecked {
            // step 1: set the overall scale first
            uint256 spotScale = spot * 1e18 / SPOT_FIXED;

            // step 2: calculate future and spot-strike ratio
            uint256 future = getFuturePrice(spot, timeToExpirySec, rate);
            uint256 spotStrikeRatio = future * 1e18 / strike;
            console.log("spotStrikeRatio: %d", spotStrikeRatio);

            // step 3: set the expiration based on volatility
            uint256 volRatio = uint256(volatility) * 1e18 / VOL_FIXED;
            uint256 timeToExpirySecScaled = uint32(timeToExpirySec) * (volRatio ** 2) / 1e36;
            console.log("timeToExpirySecScaled: %d", timeToExpirySecScaled);
            // OLD CODE
            // uint256 timeMultiplier = (1e29 / volatility) ** 2;
            // console.log("timeMultiplier: %d", timeMultiplier);

            // step 4: find indexes and then element from lookup table
            uint256 spotStrikeRatioIndex = getIndexFromSpotStrikeRatio(spotStrikeRatio);
            uint256 timeToExpiryIndex = getIndexFromTime(timeToExpirySecScaled);
            console.log("spotStrikeRatioIndex: %d", spotStrikeRatioIndex, "timeToExpiryIndex: %d", timeToExpiryIndex);
            // const cell = this.lookupTable.get(spotStrikeRatioIndex * 1000 + timeToExpiryIndex);


            // calculate indexes
            // uint40 index1 = 4;
            // uint40 index2 = 6;

            // access array element
            uint256 range = lookupTable[100267];
            console.log("range: %d", range);


            // uint256 startGas;
            // uint256 endGas;
            // console.log("Method 2");
            // startGas = gasleft();
            // maybe we can overflow here to get the first 64 bits
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



    function getIndexFromTime(uint256 value) public pure returns (uint256) {
        unchecked {
            if (value <= 7) {
                return value;
            }

            // find major
            uint256 major = 3;
            if (value >= 0x10000) { // 16
                if (value >= 0x1000000) { // 24
                    if (value >= 0x10000000) { // 28
                        if (value >= 0x40000000) { // 30
                            if (value >= 0x80000000) { // 31
                                major = 31;
                            } else {
                                major = 30;
                            }
                        } else {
                            if (value >= 0x20000000) { // 29
                                major = 29;
                            } else {
                                major = 28;
                            }
                        }
                    } else {
                        if (value >= 0x4000000) { // 26
                            if (value >= 0x8000000) { // 27
                                major = 27;
                            } else {
                                major = 26;
                            }
                        } else {
                            if (value >= 0x2000000) { // 25
                                major = 25;
                            } else {
                                major = 24;
                            }
                        }
                    }
                } else {
                    if (value >= 0x100000) { // 20
                        if (value >= 0x400000) { // 22
                            if (value >= 0x800000) { // 23
                                major = 23;
                            } else {
                                major = 22;
                            }
                        } else {
                            if (value >= 0x200000) { // 21
                                major = 21;
                            } else {
                                major = 20;
                            }
                        }
                    } else {
                        if (value >= 0x40000) { // 18
                            if (value >= 0x80000) { // 19
                                major = 19;
                            } else {
                                major = 18;
                            }
                        } else {
                            if (value >= 0x20000) { // 17
                                major = 17;
                            } else {
                                major = 16;
                            }
                        }
                    }
                }
            } else {
                if (value >= 0x100) { // 8
                    if (value >= 0x1000) { // 12
                        if (value >= 0x4000) { // 14
                            if (value >= 0x8000) { // 15
                                major = 15;
                            } else {
                                major = 14;
                            }
                        } else {
                            if (value >= 0x2000) { // 13
                                major = 13;
                            } else {
                                major = 12;
                            }
                        }
                    } else {
                        if (value >= 0x400) { // 10
                            if (value >= 0x800) { // 11
                                major = 11;
                            } else {
                                major = 10;
                            }
                        } else {
                            if (value >= 0x200) { // 9
                                major = 9;
                            } else {
                                major = 8;
                            }
                        }
                    }
                } else {
                    if (value >= 0x10) { // 4
                        if (value >= 0x40) { // 6
                            if (value >= 0x80) { // 7
                                major = 7;
                            } else {
                                major = 6;
                            }
                        } else {
                            if (value >= 0x20) { // 5
                                major = 5;
                            } else {
                                major = 4;
                            }
                        }
                    } 
                }
            } 

            // find minor
            uint256 twoToTheMajorMinus3 = 2 ** (major - 3);
            uint256 minor = (value - twoToTheMajorMinus3 * 8) / twoToTheMajorMinus3;

            return 10 * major + minor;
        }
    }

    function getIndexFromSpotStrikeRatio(uint256 spotStrikeRatio) public pure returns (uint256) {
        unchecked {
            // 0.5 ratio is index 50
            return (spotStrikeRatio / 5e16) * 5;
        }
    }

    // todo: delete
    function getFuturePriceMeasureGas(uint128 spot, uint32 timeToExpirySec, uint16 rate) public view returns (uint256) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        getFuturePrice(spot, timeToExpirySec, rate);

        endGas = gasleft();
        return startGas - endGas;
    }

    // todo: delete
    function getIndexFromTimeMeasureGas(uint256 value) public view returns (uint256) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        getIndexFromTime(value);

        endGas = gasleft();
        return startGas - endGas;
    }

    // todo: delete
    function measureGas() external view returns (uint256) {
        unchecked {
            // calculate indexes
            uint40 index1 = 4;
            uint40 index2 = 6;

            // access array element
            uint256 range = lookupTable[index1 * 1e6 + index2];


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
                uint256 twoToPowerMinus3 = 2 ** (power - 3);
                uint256 res1 = (value - twoToPowerMinus3 * 8) / twoToPowerMinus3;
                endGas = gasleft();
                console.log("gas used complex  : %d %d", startGas - endGas, res1);   
            }
            
            return 0;
        }
    }
}
