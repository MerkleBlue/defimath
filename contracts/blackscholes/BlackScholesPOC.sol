// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesPOC {
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    uint256 internal constant SPOT_FIXED = 100; // $100
    uint256 internal constant VOL_FIXED = 12 * 1e16; // 12%
    uint256 internal constant STRIKE_INDEX_MULTIPLIER = 100;

    // bool log = false;

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

            price = finalPrice * spotScale / 1e18;
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
                                if (value >= 0x100000000) { // 32
                                    if (value >= 0x200000000) { // 33
                                        major = 33;
                                    } else {
                                        major = 32;
                                    }
                                } else {
                                    major = 31;
                                }
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

    function interpolatePrice(
        uint256 strikeScaled,
        uint256 timeToExpirySecScaled
    ) private view returns (uint256 finalPrice) {
        unchecked {
            // step 1) get the specific cell
            uint256 strikeIndex = getIndexFromStrike(strikeScaled);
            uint256 timeToExpiryIndex = getIndexFromTime(timeToExpirySecScaled);
            // if (log) console.log("strikeIndex:", strikeIndex);
            // if (log) console.log("timeToExpirySecScaled:", timeToExpirySecScaled);
            // if (log) console.log("timeToExpiryIndex:", timeToExpiryIndex);
            // if (log) console.log("cell index:", strikeIndex * 1000 + timeToExpiryIndex);
            uint256 cell = lookupTable[uint40(strikeIndex * 1000 + timeToExpiryIndex)];
            // if (log) console.log("cell:", cell);

            // step 2) calculate timeToExpiry weight
            uint256 timeToExpiryFromIndex = getTimeFromIndex(timeToExpiryIndex);
            uint256 expirationStep = maxUint256(1, 2 ** (timeToExpiryIndex / 10 - 3));
            uint256 timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) * 1e18 / expirationStep;
            // if (log) console.log("timeToExpiryFromIndex: %d", timeToExpiryFromIndex);
            // if (log) console.log("expirationStep: %d", expirationStep);
            // if (log) console.log("timeToExpiryWeight: %d", timeToExpiryWeight);

            // step 3) calculate strike weight
            uint256 strikeA = getStrikeFromIndex(strikeIndex);
            uint256 deltaStrike = strikeScaled - strikeA;
            (uint256 step, ) = getStrikeStepAndBoundary(strikeScaled);
            uint256 strikeWeight = deltaStrike * 1e18 / step;
            // if (log) console.log("deltaStrike: %d", deltaStrike);
            // if (log) console.log("strikeWeight: %d", strikeWeight);

            // step 4) and 5)  
            finalPrice = step4(cell, strikeWeight, timeToExpiryWeight, strikeA, step, timeToExpiryIndex < 160);
        }
    }

    function step4(
        uint256 cell,
        uint256 strikeWeight,
        uint256 timeToExpiryWeight,
        uint256 strikeA,
        uint256 step,
        bool isLowerTime
    ) private view returns (uint256) { // pure

        unchecked {

            (int256 interpolatedPrice1, int256 interpolatedPrice2) = getInterpolatedPrice12(cell, timeToExpiryWeight, isLowerTime);

            int256 interpolatedStrikeWeightw = getInterpolatedStrikeWeightw(cell, strikeWeight, timeToExpiryWeight, isLowerTime);
            // if (log) { if (interpolatedStrikeWeightw > 0) { console.log("interpolatedStrikeWeightw: %d", uint256(interpolatedStrikeWeightw)); } else { console.log("interpolatedStrikeWeightw: -%d", uint256(-interpolatedStrikeWeightw)); }}

            uint256 finalPrice = step5(cell, strikeA, step, interpolatedPrice1, interpolatedPrice2, interpolatedStrikeWeightw, isLowerTime);

            return finalPrice;
        }
    }

    function getInterpolatedPrice12(
        uint256 cell,
        uint256 timeToExpiryWeight,
        bool isLowerTime
    ) private view returns (int256 interpolatedPrice1, int256 interpolatedPrice2) {
        unchecked {
            int256 a1;
            int256 b1;
            int256 c1;
            if (isLowerTime) {
                a1 = int256((cell << 256 - 179 - 7) >> 256 - 7) - 54;
                b1 = int256((cell << 256 - 170 - 9) >> 256 - 9) - 299;
                c1 = int256((cell << 256 - 156 - 14) >> 256 - 14);
            } else {
                a1 = int256((cell << 256 - 191 - 15) >> 256 - 15) - 5256;
                b1 = int256((cell << 256 - 172 - 19) >> 256 - 19) - 236590;
                c1 = int256((cell << 256 - 149 - 23) >> 256 - 23);
            }

            interpolatedPrice1 = a1 * 1e12 * int256(timeToExpiryWeight ** 3) / 1e54 + b1 * 1e12 * int256(timeToExpiryWeight ** 2) / 1e36 + c1 * 1e12 * int256(timeToExpiryWeight) / 1e18;

            int256 a2diff;
            int256 b2diff;
            int256 c2diff;
            if (isLowerTime) {
                a2diff = int256((cell << 256 - 149 - 7) >> 256 - 7) - 81;
                b2diff = int256((cell << 256 - 141 - 8) >> 256 - 8) - 43;
                c2diff = int256((cell << 256 - 130 - 11) >> 256 - 11) - 770;
            } else {
                a2diff = int256((cell << 256 - 140 - 9) >> 256 - 9) - 134;
                b2diff = int256((cell << 256 - 127 - 13) >> 256 - 13) - 2580;
                c2diff = int256((cell << 256 - 111 - 16) >> 256 - 16) - 25636;
            }

            interpolatedPrice2 = (a1 - a2diff) * 1e12 * int256(timeToExpiryWeight ** 3) / 1e54 + (b1 - b2diff) * 1e12 * int256(timeToExpiryWeight ** 2) / 1e36 + (c1 - c2diff) * 1e12 * int256(timeToExpiryWeight) / 1e18;

            // if (log) { if (interpolatedPrice1 > 0) { console.log("interpolatedPrice1: %d", uint256(interpolatedPrice1)); } else { console.log("interpolatedPrice1: -%d", uint256(-interpolatedPrice1)); }}
            // if (log) { if (interpolatedPrice2 > 0) { console.log("interpolatedPrice2: %d", uint256(interpolatedPrice2)); } else { console.log("interpolatedPrice2: -%d", uint256(-interpolatedPrice2)); }}

            // if (log) { if (a1 > 0) { console.log("a1: %d", uint256(a1)); } else { console.log("a1: -%d", uint256(-a1)); }}
            // if (log) { if (b1 > 0) { console.log("b1: %d", uint256(b1)); } else { console.log("b1: -%d", uint256(-b1)); }}
            // if (log) { if (c1 > 0) { console.log("c1: %d", uint256(c1)); } else { console.log("c1: -%d", uint256(-c1)); }}

            // if (log) { if (a2diff > 0) { console.log("a2diff: %d", uint256(a2diff)); } else { console.log("a2diff: -%d", uint256(-a2diff)); }}
            // if (log) { if (b2diff > 0) { console.log("b2diff: %d", uint256(b2diff)); } else { console.log("b2diff: -%d", uint256(-b2diff)); }}
            // if (log) { if (c2diff > 0) { console.log("c2diff: %d", uint256(c2diff)); } else { console.log("c2diff: -%d", uint256(-c2diff)); }}
        }
    }

    function getInterpolatedStrikeWeightw(
        uint256 cell,
        uint256 strikeWeight,
        uint256 timeToExpiryWeight,
        bool isLowerTime
    ) private view returns (int256 interpolatedStrikeWeightw) {
        unchecked {
            int256 a3w;
            int256 b3w;
            int256 c3w;
            if (isLowerTime) {
                a3w = int256((cell << 256 - 106 - 24) >> 256 - 24) - 312610;
                b3w = int256((cell << 256 - 81 - 25) >> 256 - 25) - 14254104;
                c3w = int256((cell << 256 - 58 - 23) >> 256 - 23);
            } else {
                a3w = int256((cell << 256 - 93 - 18) >> 256 - 18) - 735;
                b3w = int256((cell << 256 - 73 - 20) >> 256 - 20) - 758836;
                c3w = int256((cell << 256 - 52 - 21) >> 256 - 21);
            }
            int256 interpolatedStrikeWeight3w = a3w * 1e12 * int256(strikeWeight ** 3) / 1e54 + b3w * 1e12 * int256(strikeWeight ** 2) / 1e36 + c3w * 1e12 * int256(strikeWeight) / 1e18;

            int256 a4wdiff;
            int256 b4wdiff;
            int256 c4wdiff;
            if (isLowerTime) {
                a4wdiff = int256((cell << 256 - 39 - 19) >> 256 - 19) - 16531;
                b4wdiff = int256((cell << 256 - 19 - 20) >> 256 - 20) - 667013;
                c4wdiff = int256((cell << 256 - 19) >> 256 - 19) - 14163;
            } else {
                a4wdiff = int256((cell << 256 - 36 - 16) >> 256 - 16) - 102;
                b4wdiff = int256((cell << 256 - 18 - 18) >> 256 - 18) - 100020;
                c4wdiff = int256((cell << 256 - 18) >> 256 - 18) - 973;
            }

            // if (log) { if (a3w > 0) { console.log("a3w: %d", uint256(a3w)); } else { console.log("a3w: -%d", uint256(-a3w)); }}
            // if (log) { if (b3w > 0) { console.log("b3w: %d", uint256(b3w)); } else { console.log("b3w: -%d", uint256(-b3w)); }}
            // if (log) { if (c3w > 0) { console.log("c3w: %d", uint256(c3w)); } else { console.log("c3w: -%d", uint256(-c3w)); }}

            // if (log) { if (a4wdiff > 0) { console.log("a4wdiff: %d", uint256(a4wdiff)); } else { console.log("a4wdiff: -%d", uint256(-a4wdiff)); }}
            // if (log) { if (b4wdiff > 0) { console.log("b4wdiff: %d", uint256(b4wdiff)); } else { console.log("b4wdiff: -%d", uint256(-b4wdiff)); }}
            // if (log) { if (c4wdiff > 0) { console.log("c4wdiff: %d", uint256(c4wdiff)); } else { console.log("c4wdiff: -%d", uint256(-c4wdiff)); }}

            int256 interpolatedStrikeWeight4w = (a3w - a4wdiff) * 1e12 * int256(strikeWeight ** 3) / 1e54 + (b3w - b4wdiff) * 1e12 * int256(strikeWeight ** 2) / 1e36 + (c3w - c4wdiff) * 1e12 * int256(strikeWeight) / 1e18;

            // if (log) { if (interpolatedStrikeWeight3w > 0) { console.log("interpolatedStrikeWeight3w: %d", uint256(interpolatedStrikeWeight3w)); } else { console.log("interpolatedStrikeWeight3w: -%d", uint256(-interpolatedStrikeWeight3w)); }}
            // if (log) { if (interpolatedStrikeWeight4w > 0) { console.log("interpolatedStrikeWeight4w: %d", uint256(interpolatedStrikeWeight4w)); } else { console.log("interpolatedStrikeWeight4w: -%d", uint256(-interpolatedStrikeWeight4w)); }}

            interpolatedStrikeWeightw = interpolatedStrikeWeight3w + int256(timeToExpiryWeight) * (interpolatedStrikeWeight4w - interpolatedStrikeWeight3w) / 1e18; // todo: Math.min(1, ...)
            // if factors are zeroed, use default strike weight
            if (interpolatedStrikeWeightw == 0){
                interpolatedStrikeWeightw = int256(strikeWeight);
            }
            // if (log) { if (interpolatedStrikeWeightw > 0) { console.log("interpolatedStrikeWeightw: %d", uint256(interpolatedStrikeWeightw)); } else { console.log("interpolatedStrikeWeightw: -%d", uint256(-interpolatedStrikeWeightw)); }}
        }
    }

    function step5(
        uint256 cell,
        uint256 strikeA,
        uint256 step,
        int256 interpolatedPrice1, 
        int256 interpolatedPrice2,
        int256 interpolatedStrikeWeightw,
        bool isLowerTime
    ) private view returns (uint256 finalPrice) {
        unchecked {
            uint256 extrinsicPriceAA = uint256(maxInt256(0, int256(SPOT_FIXED * 1e18) - int256(strikeA)));
            uint256 extrinsicPriceBA = uint256(maxInt256(0, int256(SPOT_FIXED * 1e18) - int256(strikeA) - int256(step)));
            // if (log) { console.log("extrinsicPriceAA: %d", extrinsicPriceAA);}
            // if (log) { console.log("extrinsicPriceBA: %d", extrinsicPriceBA);}

            int256 intrinsicPriceAA;
            int256 intrinsicPriceBAdiff;
            if (isLowerTime) {
                intrinsicPriceAA = int256((cell << 256 - 202 - 18) >> 256 - 18);
                intrinsicPriceBAdiff = int256((cell << 256 - 186 - 16) >> 256 - 16) - 24112;
            } else {
                intrinsicPriceAA = int256((cell << 256 - 226 - 27) >> 256 - 27);
                intrinsicPriceBAdiff = int256((cell << 256 - 206 - 20) >> 256 - 20) - 452963;
            }
            int256 intrinsicPriceBA = intrinsicPriceAA - intrinsicPriceBAdiff;
            // if (log) { if (intrinsicPriceAA > 0) { console.log("intrinsicPriceAA: %d", uint256(intrinsicPriceAA)); } else { console.log("intrinsicPriceAA: -%d", uint256(-intrinsicPriceAA)); }}
            // if (log) { if (intrinsicPriceBAdiff > 0) { console.log("intrinsicPriceBAdiff: %d", uint256(intrinsicPriceBAdiff)); } else { console.log("intrinsicPriceBAdiff: -%d", uint256(-intrinsicPriceBAdiff)); }}

            int256 optionPriceAT = int256(extrinsicPriceAA) + intrinsicPriceAA * 1e12 + interpolatedPrice1;
            int256 optionPriceBT = int256(extrinsicPriceBA) + intrinsicPriceBA * 1e12 + interpolatedPrice2;
            // if (log) { if (optionPriceAT > 0) { console.log("optionPriceAT: %d", uint256(optionPriceAT)); } else { console.log("optionPriceAT: -%d", uint256(-optionPriceAT)); }}
            // if (log) { if (optionPriceBT > 0) { console.log("optionPriceBT: %d", uint256(optionPriceBT)); } else { console.log("optionPriceBT: -%d", uint256(-optionPriceBT)); }}

            finalPrice = uint256(maxInt256(0, optionPriceAT - interpolatedStrikeWeightw * (optionPriceAT - optionPriceBT) / 1e18));
        }
    }

    function maxInt256(int256 a, int256 b) internal pure returns (int256) {
        return a > b ? a : b;
    }

    function maxUint256(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
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

            // {
            //     startGas = gasleft();
            //     range / TWO_POW_192;
            //     endGas = gasleft();
            //     console.log("gas used uint256 / uint256  : %d", startGas - endGas);
            // }

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
