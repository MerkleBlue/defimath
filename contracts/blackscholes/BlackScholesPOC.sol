// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesPOC {
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    uint256 internal constant SPOT_FIXED = 100;                // $100
    uint256 internal constant VOL_FIXED = 12e16;               // 12%
    uint256 internal constant STRIKE_INDEX_MULTIPLIER = 100;

    // limits
    uint256 public constant MIN_SPOT = 1e12 - 1;               // 1 milionth of a $
    uint256 public constant MAX_SPOT = 1e33 + 1;               // 1 quadrillion $
    uint256 public constant MAX_STRIKE_SPOT_RATIO = 5;   
    uint256 public constant MAX_EXPIRATION = 63072000 + 1;     // 2 years
    uint256 public constant MIN_VOLATILITY = 1e16 - 1;         // 1% volatility
    uint256 public constant MAX_VOLATILITY = 192e16 + 1;       // 192% volatility
    uint256 public constant MAX_RATE = 2000 + 1;               // 20% risk-free rate

    // error
    error OutOfBoundsError(uint256);

    // bool log = false;

    // single mapping is faster than map of map, uint is faster than struct
    mapping(uint256 => uint256) private lookupTable;

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
            // step 0) check inputs
            if (spot <= MIN_SPOT) revert OutOfBoundsError(1);
            if (MAX_SPOT <= spot) revert OutOfBoundsError(2);
            if (strike * MAX_STRIKE_SPOT_RATIO < spot) revert OutOfBoundsError(3);
            if (spot * MAX_STRIKE_SPOT_RATIO < strike) revert OutOfBoundsError(4);
            if (MAX_EXPIRATION <= timeToExpirySec) revert OutOfBoundsError(5);
            if (volatility <= MIN_VOLATILITY) revert OutOfBoundsError(6);
            if (MAX_VOLATILITY <= volatility) revert OutOfBoundsError(7);
            if (MAX_RATE <= rate) revert OutOfBoundsError(8);

            // step 1: set the overall scale first
            uint256 spotScale = uint256(spot) / SPOT_FIXED;

            // step 2: calculate strike scaled
            uint256 strikeScaled = uint256(strike) * 1e18 / _getFuturePrice(spot, timeToExpirySec, rate) * SPOT_FIXED; // gas 379


            // step 3: set the expiration based on volatility
            uint256 volRatio = uint256(volatility) * 1e18 / VOL_FIXED; // gas 35
            uint256 timeToExpirySecScaled = uint256(timeToExpirySec) * (volRatio ** 2) / 1e36; // gas 98

            // step 4: interpolate price
            uint256 finalPrice = interpolatePrice(strikeScaled, timeToExpirySecScaled); // 

            // finally, scale the price back to the original spot
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

            // step 2: calculate strike scaled and discounted strike
            uint256 discountedStrike = _getDiscountedStrikePrice(strike, timeToExpirySec, rate);
            uint256 strikeScaled = discountedStrike * 1e18 / uint256(spot) *  SPOT_FIXED;

            // step 3: set the expiration based on volatility
            uint256 volRatio = uint256(volatility) * 1e18 / VOL_FIXED;
            uint256 timeToExpirySecScaled = uint256(timeToExpirySec) * (uint256(volRatio) ** 2) / 1e36;

            // step 4: interpolate price
            uint256 finalPrice = interpolatePrice(strikeScaled, timeToExpirySecScaled);

            uint256 callPrice = finalPrice * spotScale / 1e18;

            // finally, calculate the put price using put-call parity
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

            if (major <= 2) {
                return minor;
            }

            return 2 ** major + 2 ** (major - 3) * minor;
        }
    }

    function getIndexAndWeightFromStrike(uint256 strike) public pure returns (uint256 index, int256 weight, uint256 strikeB) {
        unchecked {
            uint256 step = getStrikeStep(strike); // gas: old 102 when strike 200, 126 gas all other segments

            index = (strike / (step * 1e16)) * step; // old 76

            uint256 strikeFromIndex = index * 1e16;
            weight = int256((strike - strikeFromIndex) * 100 / step);

            strikeB = strikeFromIndex + step * 1e16;
        }
    }

    function getStrikeStep(uint256 strike) private pure returns (uint256 step) {
        unchecked {
            if (strike >= 110e18) {
                if (strike >= 200e18) {          // 200 - 500
                    step = 400; // 4e18;
                } else {
                    if (strike >= 130e18) {      // 130 - 200
                        step = 100; // 1e18;
                    } else {                     // 110 - 130
                        step = 50; // 5e17;
                    }
                }
            } else {
                if (strike >= 99e18) {
                    if (strike >= 101e18) {      // 101 - 110
                        step = 10; // 1e17;
                    } else {                     // 99 - 101
                        step = 5; // 5e16;
                    }
                } else {
                    if (strike >= 90e18) {       // 90 - 99
                        step = 10; // 1e17;
                    } else {                     // 20 - 90
                        step = 50; // 5e17;
                    }
                }
            }
        }
    }

    function interpolatePrice(
        uint256 strikeScaled,
        uint256 timeToExpirySecScaled
    ) private view returns (uint256 finalPrice) {
        unchecked {
            // step 1) get the specific cell
            (uint256 strikeIndex, int256 strikeWeight, uint256 strikeB) = getIndexAndWeightFromStrike(strikeScaled); // gas 332
            uint256 timeToExpiryIndex = getIndexFromTime(timeToExpirySecScaled); // gas 361
            uint256 cell = lookupTable[strikeIndex * 1000 + timeToExpiryIndex]; // gas 2199

            // if (log) console.log("strikeIndex:", strikeIndex);
            // if (log) console.log("timeToExpirySecScaled:", timeToExpirySecScaled);
            // if (log) console.log("timeToExpiryIndex:", timeToExpiryIndex);
            // if (log) console.log("cell index:", strikeIndex * 1000 + timeToExpiryIndex);
            // if (log) console.log("cell:", cell);

            // step 2) calculate strike weight

            uint256 strikeA = strikeIndex * 1e16; // gas 21

            // // if (log) console.log("deltaStrike: %d", deltaStrike);
            // // if (log) console.log("strikeWeight: %d", strikeWeight);

            if (cell > 0) {
                // step 3) calculate timeToExpiry weight
                uint256 timeToExpiryFromIndex = getTimeFromIndex(timeToExpiryIndex);
                uint256 expirationStep = maxUint256(1, 2 ** (timeToExpiryIndex / 10 - 3)); // todo: what if negative???
                int256 timeToExpiryWeight = int256((timeToExpirySecScaled - timeToExpiryFromIndex) * 1e18 / expirationStep); // gas 482 3 lines above
                // if (log) console.log("timeToExpiryFromIndex: %d", timeToExpiryFromIndex);
                // if (log) console.log("expirationStep: %d", expirationStep);
                // if (log) console.log("timeToExpiryWeight: %d", timeToExpiryWeight);

                // step 4) 


                bool isLowerTime = timeToExpiryIndex < 160;
                (int256 interpolatedPrice1, int256 interpolatedPrice2) = getInterpolatedPrice12(cell, timeToExpiryWeight, isLowerTime); // gas 717

                // uint256 startGas = gasleft();
                int256 interpolatedStrikeWeightw = getInterpolatedStrikeWeightw(cell, isLowerTime, strikeWeight, timeToExpiryWeight); // gas 768
                // uint256 endGas = gasleft();
                // console.log("Gas in segment: %d", (startGas - endGas));
                // step 5)
                finalPrice = step5(cell, strikeA, strikeB, interpolatedPrice1, interpolatedPrice2, interpolatedStrikeWeightw, isLowerTime);

            } else {
                finalPrice = finalStep(strikeA, strikeB, uint256(strikeWeight));
            }
        }
    }

    function getInterpolatedPrice12(
        uint256 cell,
        int256 timeWeight,
        bool isLowerTime
    ) private pure returns (int256 interpolatedPrice1, int256 interpolatedPrice2) {
        unchecked {
            if (isLowerTime) {
                int256 a1 = int256((cell << 256 - 179 - 7) >> 256 - 7) - 54;
                int256 b1 = int256((cell << 256 - 170 - 9) >> 256 - 9) - 299;
                int256 c1 = int256((cell << 256 - 156 - 14) >> 256 - 14);

                int256 a2 = a1 - (int256((cell << 256 - 149 - 7) >> 256 - 7) - 81);
                int256 b2 = b1 - (int256((cell << 256 - 141 - 8) >> 256 - 8) - 43);
                int256 c2 = c1 - (int256((cell << 256 - 130 - 11) >> 256 - 11) - 770);

                interpolatedPrice1 = timeWeight * (a1 * timeWeight ** 2 + b1 * timeWeight * 1e18 + c1 * 1e36) / 1e42;
                interpolatedPrice2 = timeWeight * (a2 * timeWeight ** 2 + b2 * timeWeight * 1e18 + c2 * 1e36) / 1e42;
            } else {
                int256 a1 = int256((cell << 256 - 191 - 15) >> 256 - 15) - 5256;
                int256 b1 = int256((cell << 256 - 172 - 19) >> 256 - 19) - 236590;
                int256 c1 = int256((cell << 256 - 149 - 23) >> 256 - 23);

                int256 a2 = a1 - (int256((cell << 256 - 140 - 9) >> 256 - 9) - 134);
                int256 b2 = b1 - (int256((cell << 256 - 127 - 13) >> 256 - 13) - 2580);
                int256 c2 = c1 - (int256((cell << 256 - 111 - 16) >> 256 - 16) - 25636);

                interpolatedPrice1 = timeWeight * (a1 * timeWeight ** 2 + b1 * timeWeight * 1e18 + c1 * 1e36) / 1e42;
                interpolatedPrice2 = timeWeight * (a2 * timeWeight ** 2 + b2 * timeWeight * 1e18 + c2 * 1e36) / 1e42;
            }

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
        bool isLowerTime,
        int256 strikeWeight,
        int256 timeWeight
    ) private pure returns (int256) {
        unchecked {
            int256 interpolatedStrikeWeight3w;
            int256 interpolatedStrikeWeight4w;
            if (isLowerTime) {
                int256 a3w = int256((cell << 256 - 106 - 24) >> 256 - 24) - 312610;
                int256 b3w = int256((cell << 256 - 81 - 25) >> 256 - 25) - 14254104;
                int256 c3w = int256((cell << 256 - 58 - 23) >> 256 - 23);

                int256 a4w = a3w - (int256((cell << 256 - 39 - 19) >> 256 - 19) - 16531);
                int256 b4w = b3w - (int256((cell << 256 - 19 - 20) >> 256 - 20) - 667013);
                // c4wdiff = int256((cell << 256 - 19) >> 256 - 19) - 14163;
                int256 c4w = c3w - (int256(cell & 0x7FFFF) - 14163);

                interpolatedStrikeWeight3w = strikeWeight * (a3w * strikeWeight ** 2 + b3w * strikeWeight * 1e18 + c3w * 1e36);
                interpolatedStrikeWeight4w = strikeWeight * (a4w * strikeWeight ** 2 + b4w * strikeWeight * 1e18 + c4w * 1e36);
            } else {
                int256 a3w = int256((cell << 256 - 93 - 18) >> 256 - 18) - 735;
                int256 b3w = int256((cell << 256 - 73 - 20) >> 256 - 20) - 758836;
                int256 c3w = int256((cell << 256 - 52 - 21) >> 256 - 21);

                int256 a4w = a3w - (int256((cell << 256 - 36 - 16) >> 256 - 16) - 102);
                int256 b4w = b3w - (int256((cell << 256 - 18 - 18) >> 256 - 18) - 100020);
                // c4wdiff = int256((cell << 256 - 18) >> 256 - 18) - 973;
                int256 c4w = c3w - (int256(cell & 0x1FFFF) - 973);

                interpolatedStrikeWeight3w = strikeWeight * (a3w * strikeWeight ** 2 + b3w * strikeWeight * 1e18 + c3w * 1e36);
                interpolatedStrikeWeight4w = strikeWeight * (a4w * strikeWeight ** 2 + b4w * strikeWeight * 1e18 + c4w * 1e36);
            }

            // if (log) { if (a3w > 0) { console.log("a3w: %d", uint256(a3w)); } else { console.log("a3w: -%d", uint256(-a3w)); }}
            // if (log) { if (b3w > 0) { console.log("b3w: %d", uint256(b3w)); } else { console.log("b3w: -%d", uint256(-b3w)); }}
            // if (log) { if (c3w > 0) { console.log("c3w: %d", uint256(c3w)); } else { console.log("c3w: -%d", uint256(-c3w)); }}

            // if (log) { if (a4wdiff > 0) { console.log("a4wdiff: %d", uint256(a4wdiff)); } else { console.log("a4wdiff: -%d", uint256(-a4wdiff)); }}
            // if (log) { if (b4wdiff > 0) { console.log("b4wdiff: %d", uint256(b4wdiff)); } else { console.log("b4wdiff: -%d", uint256(-b4wdiff)); }}
            // if (log) { if (c4wdiff > 0) { console.log("c4wdiff: %d", uint256(c4wdiff)); } else { console.log("c4wdiff: -%d", uint256(-c4wdiff)); }}


            // if (log) { if (interpolatedStrikeWeight3w > 0) { console.log("interpolatedStrikeWeight3w: %d", uint256(interpolatedStrikeWeight3w)); } else { console.log("interpolatedStrikeWeight3w: -%d", uint256(-interpolatedStrikeWeight3w)); }}
            // if (log) { if (interpolatedStrikeWeight4w > 0) { console.log("interpolatedStrikeWeight4w: %d", uint256(interpolatedStrikeWeight4w)); } else { console.log("interpolatedStrikeWeight4w: -%d", uint256(-interpolatedStrikeWeight4w)); }}

            int256 interpolatedStrikeWeightw = (interpolatedStrikeWeight3w + timeWeight * (interpolatedStrikeWeight4w - interpolatedStrikeWeight3w) / 1e18) / 1e42; // todo: Math.min(1, ...)
            // if factors are zeroed, use default strike weight
            if (interpolatedStrikeWeightw == 0) {
                interpolatedStrikeWeightw = strikeWeight;
            }

            return interpolatedStrikeWeightw;
            // if (log) { if (interpolatedStrikeWeightw > 0) { console.log("interpolatedStrikeWeightw: %d", uint256(interpolatedStrikeWeightw)); } else { console.log("interpolatedStrikeWeightw: -%d", uint256(-interpolatedStrikeWeightw)); }}
        }
    }

    function step5(
        uint256 cell,
        uint256 strikeA,
        uint256 strikeB,
        int256 interpolatedPrice1, 
        int256 interpolatedPrice2,
        int256 interpolatedStrikeWeightw,
        bool isLowerTime
    ) private pure returns (uint256 finalPrice) {
        unchecked {
            uint256 extrinsicPriceAA;
            if (SPOT_FIXED * 1e18 > strikeA) {
                extrinsicPriceAA = SPOT_FIXED * 1e18 - strikeA;
            }
            uint256 extrinsicPriceBA;
            if (SPOT_FIXED * 1e18 > strikeB) {
                extrinsicPriceBA = SPOT_FIXED * 1e18 - strikeB;
            }
            // if (log) { console.log("extrinsicPriceAA: %d", extrinsicPriceAA);}
            // if (log) { console.log("extrinsicPriceBA: %d", extrinsicPriceBA);}

            int256 intrinsicPriceAA;
            int256 intrinsicPriceBA;
            if (isLowerTime) {
                intrinsicPriceAA = int256((cell << 256 - 202 - 18) >> 256 - 18);
                intrinsicPriceBA = intrinsicPriceAA - (int256((cell << 256 - 186 - 16) >> 256 - 16) - 24112);
            } else {
                intrinsicPriceAA = int256((cell << 256 - 226 - 27) >> 256 - 27);
                intrinsicPriceBA = intrinsicPriceAA - (int256((cell << 256 - 206 - 20) >> 256 - 20) - 452963);
            }
            // if (log) { if (intrinsicPriceAA > 0) { console.log("intrinsicPriceAA: %d", uint256(intrinsicPriceAA)); } else { console.log("intrinsicPriceAA: -%d", uint256(-intrinsicPriceAA)); }}
            // if (log) { if (intrinsicPriceBAdiff > 0) { console.log("intrinsicPriceBAdiff: %d", uint256(intrinsicPriceBAdiff)); } else { console.log("intrinsicPriceBAdiff: -%d", uint256(-intrinsicPriceBAdiff)); }}

            int256 optionPriceAT = int256(extrinsicPriceAA) + intrinsicPriceAA * 1e12 + interpolatedPrice1;
            int256 optionPriceBT = int256(extrinsicPriceBA) + intrinsicPriceBA * 1e12 + interpolatedPrice2;
            // if (log) { if (optionPriceAT > 0) { console.log("optionPriceAT: %d", uint256(optionPriceAT)); } else { console.log("optionPriceAT: -%d", uint256(-optionPriceAT)); }}
            // if (log) { if (optionPriceBT > 0) { console.log("optionPriceBT: %d", uint256(optionPriceBT)); } else { console.log("optionPriceBT: -%d", uint256(-optionPriceBT)); }}

            finalPrice = uint256(maxInt256(0, optionPriceAT - interpolatedStrikeWeightw * (optionPriceAT - optionPriceBT) / 1e18));
        }
    }

    function finalStep(
        uint256 strikeA,
        uint256 strikeB,
        uint256 strikeWeight
    ) private pure returns (uint256 finalPrice) {
        unchecked {
            // todo: just use extrinsicPrice on a strike
            uint256 extrinsicPriceAA;
            if (SPOT_FIXED * 1e18 > strikeA) {
                extrinsicPriceAA = SPOT_FIXED * 1e18 - strikeA;
            }
            uint256 extrinsicPriceBA;
            if (SPOT_FIXED * 1e18 > strikeB) {
                extrinsicPriceBA = SPOT_FIXED * 1e18 - strikeB;
            }
            // if (log) { console.log("extrinsicPriceAA: %d", extrinsicPriceAA);}
            // if (log) { console.log("extrinsicPriceBA: %d", extrinsicPriceBA);}

            finalPrice = uint256(extrinsicPriceAA - strikeWeight * (extrinsicPriceAA - extrinsicPriceBA) / 1e18);
        }
    }

    function maxInt256(int256 a, int256 b) private pure returns (int256) {
        unchecked {
            return a <= b ? b : a;
        }
    }

    function maxUint256(uint256 a, uint256 b) private pure returns (uint256) {
        unchecked {
            return a > b ? a : b;
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
    // function measureGas() external view returns (uint256) {
    //     unchecked {
    //         // calculate indexes
    //         uint40 index1 = 4;
    //         uint40 index2 = 6;

    //         // access array element
    //         uint256 range = lookupTable[index1 * 1e6 + index2];


    //         uint256 startGas;
    //         uint256 endGas;

    //         // {
    //         //     startGas = gasleft();
    //         //     range / TWO_POW_192;
    //         //     endGas = gasleft();
    //         //     console.log("gas used uint256 / uint256  : %d", startGas - endGas);
    //         // }

    //         {
    //             uint128 num1 = 80000;
    //             uint128 num2 = 200;
    //             startGas = gasleft();
    //             num1 / num2;
    //             endGas = gasleft();
    //             console.log("gas used uint128 / uint128  : %d", startGas - endGas);     
    //         }


    //         {
    //             uint8 num1 = 16;
    //             uint8 num2 = 4;
    //             startGas = gasleft();
    //             num1 / num2;
    //             endGas = gasleft();
    //             console.log("gas used uint8 / uint8  : %d", startGas - endGas);     
    //         }

    //         {
    //             uint256 num1 = 2;
    //             uint256 num2 = 128;
    //             startGas = gasleft();
    //             num1 ** num2;
    //             endGas = gasleft();
    //             console.log("gas used uint256 ** uint256  : %d", startGas - endGas); 
    //             console.log("result  : %d", num1 ** num2);     
    //         }

    //         {
    //             uint256 num1 = 12030312;
    //             uint256 num2 = 12423;
    //             startGas = gasleft();
    //             num1 - num2;
    //             endGas = gasleft();
    //             console.log("gas used uint256 - uint256  : %d", startGas - endGas); 
    //             console.log("result  : %d", num1 - num2);     
    //         }

    //         {
    //             uint256 value = 2 ** 12 + 243;
    //             uint256 power = 12;
    //             startGas = gasleft();
                
    //             // 137 gas
    //             uint256 twoToPowerMinus3 = 2 ** (power - 3);
    //             uint256 res1 = (value - twoToPowerMinus3 * 8) / twoToPowerMinus3;
    //             endGas = gasleft();
    //             console.log("gas used complex  : %d %d", startGas - endGas, res1);   
    //         }
            
    //         return 0;
    //     }
    // }
}
