// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesPOC {
    uint256 internal constant TWO_POW_192 = 2 ** 192;
    uint256 internal constant TWO_POW_160 = 2 ** 160;
    uint256 internal constant TWO_POW_128 = 2 ** 128;
    uint256 internal constant TWO_POW_96 = 2 ** 96;
    uint256 internal constant TWO_POW_64 = 2 ** 64;
    uint256 internal constant TWO_POW_32 = 2 ** 32;

    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    uint256 internal constant SPOT_FIXED = 100; // $100
    uint256 internal constant VOL_FIXED = 12 * 1e16; // 12%
    uint256 internal constant STRIKE_INDEX_MULTIPLIER = 100;

    // single mapping is faster than map of map, uint is faster than struct
    mapping(uint40 => uint256) private lookupTable;

    constructor() {
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

    function getCallOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint80 volatility,
        uint16 rate
    ) external view returns (uint256 price) {
        unchecked {
            // step 1: set the overall scale first
            uint256 spotScale = uint256(spot) / SPOT_FIXED;

            // step 2: spot-strike ratio
            uint256 strikeScaled = uint256(strike) * 1e18 / _getFuturePrice(spot, timeToExpirySec, rate) * SPOT_FIXED;

            // step 3: set the expiration based on volatility
            uint256 volRatio = uint256(volatility) * 1e18 / VOL_FIXED;
            uint256 timeToExpirySecScaled = uint256(timeToExpirySec) * (volRatio ** 2) / 1e36;

            // step 4: interpolate price
            uint256 finalPrice = interpolatePrice(strikeScaled, timeToExpirySecScaled);

            // price = finalPrice * spotScale / 1e18;
        }
    }

    function getPutOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint80 volatility,
        uint16 rate
    ) external view returns (uint256 price) {
        unchecked {
            // step 1: set the overall scale first
            uint256 spotScale = uint256(spot) / SPOT_FIXED;

            // step 2: calculate discounted strike and spot-strike ratio
            uint256 discountedStrike = _getDiscountedStrikePrice(strike, timeToExpirySec, rate);
            uint256 strikeScaled = discountedStrike * 1e18 / uint256(spot) *  SPOT_FIXED;

            // step 3: set the expiration based on volatility
            uint256 timeToExpirySecScaled = uint256(timeToExpirySec) * (uint256(volatility) ** 2) / 1e36;

            // step 4: interpolate price
            uint256 finalPrice = interpolatePrice(strikeScaled, timeToExpirySecScaled);

            uint256 callPrice = finalPrice * spotScale / 1e18;

            price = callPrice + discountedStrike - spot;
        }
    }

    function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) external pure returns (uint256) {
        unchecked {
            return _getFuturePrice(spot, timeToExpirySec, rate);
        }
    }

    function _getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) private pure returns (uint256) {
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

    function _getDiscountedStrikePrice(uint128 strike, uint32 timeToExpirySec, uint16 rate) private pure returns (uint256) {
        unchecked {
            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)

            // NOTE: this is faster than the above 
            uint256 x = uint256(timeToExpirySec) * 1e5 * rate / SECONDS_IN_YEAR;

            // todo: check x is not more than 0.2

            uint256 numerator = (x + 3e9) ** 2 + 3e18;
            uint256 denominator = (3e9 - x) ** 2 + 3e18;

            return denominator * strike / numerator;
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

    function getTimeFromIndex(uint256 index) private pure returns (uint256) {
        unchecked {
            uint256 major = index / 10;

            uint256 minor = index % 10;

            if (major < 3) {
                return minor;
            }

            return 2 ** major + 2 ** (major - 3) * minor;
        }
    }

    // OLD CODE: todo: delete 
    // function getIndexFromStrike(uint256 strike) public pure returns (uint256) {
    //     unchecked {
    //         return (strike / 5e18) * STRIKE_RANGE_FIXED;
    //     }
    // }


    function getIndexFromStrike(uint256 strike) public pure returns (uint256) {
    
        (uint256 step, uint256 boundary) = getStrikeStepAndBoundary(strike);

        return boundary * STRIKE_INDEX_MULTIPLIER / 1e18 + ((strike - boundary) / step) * step * STRIKE_INDEX_MULTIPLIER / 1e18;

        // return Math.round(boundary * STRIKE_INDEX_MULTIPLIER + Math.floor((strike + 1e-9 - boundary) / step) * step * STRIKE_INDEX_MULTIPLIER);
    }

    function getStrikeStepAndBoundary(uint256 strike) public pure returns (uint128 step, uint128 boundary) {
        if (strike >= 20 * 1e18 && strike < 90 * 1e18) {
            step = 5 * 1e17;
            boundary = 20 * 1e18;
            return (step, boundary);
        }

        if (strike >= 90 * 1e18 && strike < 99 * 1e18) {
            step = 1 * 1e17;
            boundary = 90 * 1e18;
            return (step, boundary);
        }

        if (strike >= 99 * 1e18 && strike < 101 * 1e18) {
            step = 5 * 1e16;
            boundary = 99 * 1e18;
            return (step, boundary);
        }

        if (strike >= 101 * 1e18 && strike < 110 * 1e18) {
            step = 1 * 1e17;
            boundary = 101 * 1e18;
            return (step, boundary);
        }

        if (strike >= 110 * 1e18 && strike < 130 * 1e18) {
            step = 5 * 1e17;
            boundary = 110 * 1e18;
            return (step, boundary);
        }

        if (strike >= 130 * 1e18 && strike < 200 * 1e18) {
            step = 1 * 1e18;
            boundary = 130 * 1e18;
            return (step, boundary);
        }

        step = 4 * 1e18;
        boundary = 200 * 1e18;
    }

    function getStrikeFromIndex(uint256 index) public pure returns (uint256) {
        unchecked {
            return index * 1e18 / STRIKE_INDEX_MULTIPLIER; // todo: optimize
        }
    }

    function getWeights(
        uint256 spotStrikeRatioIndex,
        uint256 spotStrikeRatio,
        uint256 timeToExpiryIndex,
        uint256 timeToExpirySecScaled
    ) private pure returns (uint256 spotStrikeWeight, uint256 timeToExpiryWeight) {
        unchecked {
            uint256 spotStrikeRatioFromIndex = spotStrikeRatioIndex * 1e16;
            spotStrikeWeight = (spotStrikeRatio - spotStrikeRatioFromIndex) * 20; // 20 if 0.05 is a step

            uint256 expirationStep = 2 ** (timeToExpiryIndex / 10 - 3);
            uint256 timeToExpiryFromIndex = getTimeFromIndex(timeToExpiryIndex);
            timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) * 1e18 / expirationStep;
        }
    }

    // function interpolatePrice(
    //     uint256 spotStrikeRatio,
    //     uint256 timeToExpirySecScaled
    // ) private view returns (uint256 finalPrice) {
    //     unchecked {
    //         uint256 spotStrikeRatioIndex = getIndexFromSpotStrikeRatio(spotStrikeRatio);
    //         uint256 timeToExpiryIndex = getIndexFromTime(timeToExpirySecScaled);
    //         uint256 cell = lookupTable[uint40(spotStrikeRatioIndex * 1000 + timeToExpiryIndex)];

    //         uint256 optionPriceAA = cell / TWO_POW_192;
    //         uint256 optionPriceAB = uint64(cell / TWO_POW_128);
    //         uint256 optionPriceBA = uint64(cell / TWO_POW_64);
    //         uint256 optionPriceBB = uint64(cell);

    //         (uint256 spotStrikeWeight, uint256 timeToExpiryWeight) = getWeights(spotStrikeRatioIndex, spotStrikeRatio, timeToExpiryIndex, timeToExpirySecScaled);

    //         uint256 wPriceA36 = optionPriceAA * (1e18 - timeToExpiryWeight) + optionPriceAB * timeToExpiryWeight;
    //         uint256 wPriceB36 = optionPriceBA * (1e18 - timeToExpiryWeight) + optionPriceBB * timeToExpiryWeight;

    //         finalPrice = (wPriceA36 * (1e18 - spotStrikeWeight) + wPriceB36 * spotStrikeWeight) / 1e36;
    //     }
    // }

    function interpolatePrice(
        uint256 strikeScaled,
        uint256 timeToExpirySecScaled
    ) private view returns (uint256 finalPrice) {
        unchecked {
            // step 1) get the specific cell
            uint256 strikeIndex = getIndexFromStrike(strikeScaled);
            uint256 timeToExpiryIndex = getIndexFromTime(timeToExpirySecScaled);
            console.log("strikeIndex:", strikeIndex);
            console.log("timeToExpiryIndex:", timeToExpiryIndex);
            uint256 cell = lookupTable[uint40(strikeIndex * 1000 + timeToExpiryIndex)];

            // step 2) calculate timeToExpiry weight
            uint256 timeToExpiryFromIndex = getTimeFromIndex(timeToExpiryIndex);
            uint256 expirationStep = 2 ** (timeToExpiryIndex / 10 - 3);
            uint256 timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) * 1e18 / expirationStep;
            console.log("timeToExpiryFromIndex: %d", timeToExpiryFromIndex);
            console.log("expirationStep: %d", expirationStep);
            console.log("timeToExpiryWeight: %d", timeToExpiryWeight);

            // step 3) calculate strike weight
            uint256 deltaStrike = strikeScaled - getStrikeFromIndex(strikeIndex);
            (uint256 step, ) = getStrikeStepAndBoundary(strikeScaled);
            uint256 strikeWeight = deltaStrike * 1e18 / step;
            console.log("deltaStrike: %d", deltaStrike);
            console.log("strikeWeight: %d", strikeWeight);

            // step 4)  
            step4(cell, strikeWeight, timeToExpiryWeight);

            // finalPrice = applyQuadraticFormula(cell, deltaTime, deltaStrike, timeToExpiryWeight);
        }
    }

    function step4(
        uint256 cell,
        uint256 strikeWeight,
        uint256 timeToExpiryWeight
    ) private pure returns (uint256 finalPrice) {

        // intrinsicPriceAA [ 0 - 82.488476 ]               27 bits, 6 decimals
        // intrinsicPriceBAdiff [ -0.452963 - 0.471194 ]    20 bits, 6 decimals
        // a1 [ -0.005256 - 0.011765 ]                      15 bits, 6 decimals
        // b1 [ -0.23659 - 0.056027 ]                       19 bits, 6 decimals
        // c1 [ 0 - 4.857372 ]                              23 bits, 6 decimals,
        // a2diff [ -0.000134 - 0.000207 ]                   9 bits, 6 decimals
        // b2diff [ -0.00258 - 0.001524 ]                   13 bits, 6 decimals
        // c2diff [ -0.025636 - 0.029092 ]                  16 bits, 6 decimals
        // a3w [ -0.001096 - 0.2756 ]                       19 bits, 6 decimals
        // b3w [ -1.052697 - 0 ]                            21 bits, 6 decimals
        // c3w [ 0 - 1.778273 ]                             18 bits, 5 decimals
        // a4wdiff [ -0.000147 - 0.040763 ]                 19 bits, 6 decimals
        // b4wdiff [ -0.116937 - 0.000924 ]                 18 bits, 6 decimals
        // c4wdiff [ -0.000973 - 0.076386 ]                 17 bits, 6 decimals

        // TOTAL: 254 bits
        unchecked {


            int256 interpolatedPrice1;
            int256 interpolatedPrice2;
            {
                int256 a1 = int256((cell << 256 - 192 - 15) >> 256 - 15) - 5256;
                int256 b1 = int256((cell << 256 - 173 - 19) >> 256 - 19) - 236590;
                int256 c1 = int256((cell << 256 - 150 - 23) >> 256 - 23);
                interpolatedPrice1 = a1 * 1e12 * int256(timeToExpiryWeight ** 3) / 1e54 + b1 * 1e12 * int256(timeToExpiryWeight ** 2) / 1e36 + c1 * 1e12 * int256(timeToExpiryWeight) / 1e18;

                int256 a2diff = int256((cell << 256 - 141 - 9) >> 256 - 9) - 134;
                int256 b2diff = int256((cell << 256 - 128 - 13) >> 256 - 13) - 2580;
                int256 c2diff = int256((cell << 256 - 112 - 16) >> 256 - 16) - 25636;

                interpolatedPrice2 = (a1 - a2diff) * 1e12 * int256(timeToExpiryWeight ** 3) / 1e54 + (b1 - b2diff) * 1e12 * int256(timeToExpiryWeight ** 2) / 1e36 + (c1 - c2diff) * 1e12 * int256(timeToExpiryWeight) / 1e18;
            }

            {
                int256 a3w = int256((cell << 256 - 93 - 19) >> 256 - 19) - 1096;
                int256 b3w = int256((cell << 256 - 72 - 21) >> 256 - 21) - 1052697;
                int256 c3w = int256((cell << 256 - 54 - 18) >> 256 - 18);
            }

            {
                int256 a4wdiff = int256((cell << 256 - 35 - 19) >> 256 - 19) - 147;
                int256 b4wdiff = int256((cell << 256 - 18 - 17) >> 256 - 18) - 116937;
                int256 c4wdiff = int256((cell << 256 - 17) >> 256 - 17) - 973;
            }

            if (interpolatedPrice1 > 0) { console.log("interpolatedPrice1: %d", uint256(interpolatedPrice1)); } else { console.log("interpolatedPrice1: -%d", uint256(-interpolatedPrice1)); }
            if (interpolatedPrice2 > 0) { console.log("interpolatedPrice2: %d", uint256(interpolatedPrice2)); } else { console.log("interpolatedPrice2: -%d", uint256(-interpolatedPrice2)); }

            int256 intrinsicPriceAA = int256((cell << 256 - 227 - 27) >> 256 - 27);
            int256 intrinsicPriceBAdiff = int256((cell << 256 - 207 - 20) >> 256 - 20) - 452963;

            // if (intrinsicPriceAA > 0) { console.log("intrinsicPriceAA: %d", uint256(intrinsicPriceAA)); } else { console.log("intrinsicPriceAA: -%d", uint256(-intrinsicPriceAA)); }
            // if (intrinsicPriceBAdiff > 0) { console.log("intrinsicPriceBAdiff: %d", uint256(intrinsicPriceBAdiff)); } else { console.log("intrinsicPriceBAdiff: -%d", uint256(-intrinsicPriceBAdiff)); }

            // if (a1 > 0) { console.log("a1: %d", uint256(a1)); } else { console.log("a1: -%d", uint256(-a1)); }
            // if (b1 > 0) { console.log("b1: %d", uint256(b1)); } else { console.log("b1: -%d", uint256(-b1)); }
            // if (c1 > 0) { console.log("c1: %d", uint256(c1)); } else { console.log("c1: -%d", uint256(-c1)); }

            // if (a2diff > 0) { console.log("a2diff: %d", uint256(a2diff)); } else { console.log("a2diff: -%d", uint256(-a2diff)); }
            // if (b2diff > 0) { console.log("b2diff: %d", uint256(b2diff)); } else { console.log("b2diff: -%d", uint256(-b2diff)); }
            // if (c2diff > 0) { console.log("c2diff: %d", uint256(c2diff)); } else { console.log("c2diff: -%d", uint256(-c2diff)); }

            // if (a3w > 0) { console.log("a3w: %d", uint256(a3w)); } else { console.log("a3w: -%d", uint256(-a3w)); }
            // if (b3w > 0) { console.log("b3w: %d", uint256(b3w)); } else { console.log("b3w: -%d", uint256(-b3w)); }
            // if (c3w > 0) { console.log("c3w: %d", uint256(c3w)); } else { console.log("c3w: -%d", uint256(-c3w)); }

            // if (a4wdiff > 0) { console.log("a4wdiff: %d", uint256(a4wdiff)); } else { console.log("a4wdiff: -%d", uint256(-a4wdiff)); }
            // if (b4wdiff > 0) { console.log("b4wdiff: %d", uint256(b4wdiff)); } else { console.log("b4wdiff: -%d", uint256(-b4wdiff)); }
            // if (c4wdiff > 0) { console.log("c4wdiff: %d", uint256(c4wdiff)); } else { console.log("c4wdiff: -%d", uint256(-c4wdiff)); }
        }
    }

    // todo: rename 
    function applyQuadraticFormula(
        uint256 cell,
        uint256 deltaTime,
        uint256 deltaStrike,
        uint256 timeToExpiryWeight
    ) private pure returns (uint256 finalPrice) {
        unchecked {
            uint256 optionPriceAA = cell / TWO_POW_192;
            int256 a1 = decodeFactor(uint32(cell / TWO_POW_160));
            int256 b1 = decodeFactor(uint32(cell / TWO_POW_128));
            int256 a3 = decodeFactor(uint32(cell / TWO_POW_96));
            int256 b3 = decodeFactor(uint32(cell / TWO_POW_64));
            int256 a4 = decodeFactor(uint32(cell / TWO_POW_32));
            int256 b4 = decodeFactor(uint32(cell));

            int256 interpolatedPrice1 = a1 * 1e12 * int256(deltaTime ** 2) / 1e36 + b1 * 1e12 * int256(deltaTime) / 1e18;
            int256 interpolatedPrice3 = a3 * 1e12 * int256(deltaStrike ** 2) / 1e36 + b3 * 1e12 * int256(deltaStrike) / 1e18;
            int256 interpolatedPrice4 = a4 * 1e12 * int256(deltaStrike ** 2) / 1e36 + b4 * 1e12 * int256(deltaStrike) / 1e18;

            int256 interpolatedPriceStrike = interpolatedPrice3 + int256(timeToExpiryWeight) * (interpolatedPrice4 - interpolatedPrice3) / 1e18;
            finalPrice = uint256(int256(optionPriceAA) * 10 + interpolatedPrice1 + interpolatedPriceStrike);


        }
    }

    function decodeFactor(uint256 number) private pure returns (int256 factor) {
        unchecked {

            // positive
            if (number < 2147483648) {
                factor = int256(number);
            } else {
                factor = -int256(number - 2147483648); // 2 ** 31
            }
        }
    }

    // todo: delete
    function getFuturePriceMeasureGas(uint128 spot, uint32 timeToExpirySec, uint16 rate) public view returns (uint256) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        _getFuturePrice(spot, timeToExpirySec, rate);

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
