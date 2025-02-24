// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesNUM {

    uint256 internal constant SECONDS_IN_YEAR = 31536000;
    uint internal constant SQRT_2XPI = 2506628274631000502415765285;  // sqrt(2 * PI)
    uint internal constant SCALE = 1e18;
    uint internal constant SCALE_DOWN = 1e9;

    uint internal constant PRECISE_UNIT = 1e27;
    int internal constant STD_NORMAL_CDF_MINIMUM = -4 * int(PRECISE_UNIT);   // -4
    int internal constant STD_NORMAL_CDF_MAXIMUM = 10 * int(PRECISE_UNIT);   // +10
    int internal constant LOG2_E_SIGNED = 1_442695040888963407;       // log2(e)
    int internal constant HALF_SCALE_SIGNED = 5e17;                   // 0.5 * 10 ** 18
    int internal constant SCALE_SIGNED = 1e18;
    int internal constant SCALE_DOWN_SIGNED = 1e9;

    int256 internal constant E_TO_003125 = 1_031743407499102671;            // e ^ 0.03125
    int256 internal constant E = 2_718281828459045235;                      // e
    int256 internal constant E_TO_32 = 78962960182680_695160978022635000;   // e ^ 32


    bool log = false;

    constructor() {
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

    // gas 592 when x > 0.05
    function exp(int256 x) public view returns (uint256) {
        unchecked {
            // handle special case where x = 0
            if (x == 0) {
                return 1e18;
            }

            bool isPositive = x >= 0;
            if (!isPositive) {
                x = -x;
            }

            int256 exp1 = 1e18;
            int256 exp2 = 1e18;
            int256 exp3 = 1e18;

            // if (x > 1) {
            //     const exponent = Math.floor(x);
            //     x -= exponent;
            //     exp2 = this.getExpPrecalculated(E, exponent);
            // }

            if (x > 3125e13) {
                uint256 exponent = uint(x) / 3125e13;
                x -= int256(exponent * 3125e13);
                exp1 = getExp1Precalculated(exponent); // int256(E_TO_005 ** exponent / (10 ** (18 * (exponent - 1))));
            } 
            // if (log) { if (exp1 > 0) { console.log("exp1 SOL: %d", uint256(exp1)); } else { console.log("exp1 SOL: -%d", uint256(-exp1)); }}
            

            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
            int256 numerator = ((x + 3e18) ** 2) + 3e36;
            int256 denominator = ((3e18 - x) ** 2) + 3e36;
            // int256 exp2 = (numerator * 1e18) / denominator;

            // if (log) { if (exp2 > 0) { console.log("exp2 SOL: %d", uint256(exp2)); } else { console.log("exp2 SOL: -%d", uint256(-exp2)); }}


            uint256 result = uint(exp1 * numerator / denominator); // using e ^ (a + b) = e ^ a * e ^ b

            return isPositive ? result : 1 / result;
        }
    }

    function getExp1Precalculated(uint256 exponent) private pure returns (int256) {
        // use >=, fastest

        // base is 1.031743407499102671

        if (exponent >= 16) { // 16
            if (exponent >= 24) { // 24
                if (exponent >= 28) { // 28
                    if (exponent >= 30) { // 30
                        if (exponent >= 31) { // 31
                            return 2_634649088815631111;
                        } else {
                            return 2_553589458062926873;
                        }
                    } else {
                        if (exponent >= 29) { // 29
                            return 2_475023769963025215;
                        } else {
                            return 2_398875293967097914;
                        }
                    }
                } else {
                    if (exponent >= 26) { // 26
                        if (exponent >= 27) { // 27
                            return 2_325069660277121051;
                        } else {
                            return 2_253534787213208545;
                        }
                    } else {
                        if (exponent >= 25) { // 25
                            return 2_184200810815617925;
                        } else {
                            return 2_117000016612674669;
                        }
                    }
                }
            } else {
                if (exponent >= 20) { // 20
                    if (exponent >= 22) { // 22
                        if (exponent >= 23) { // 23
                            return 2_051866773487976824;
                        } else {
                            return 1_988737469582291831;
                        }
                    } else {
                        if (exponent >= 21) { // 21
                            return 1_927550450167544665;
                        } else {
                            return 1_868245957432222407;
                        }
                    }
                } else {
                    if (exponent >= 18) { // 18
                        if (exponent >= 19) { // 19
                            return 1_810766072119387164;
                        } else {
                            return 1_755054656960298557;
                        }
                    } else {
                        if (exponent >= 17) { // 17
                            return 1_701057301848400679;
                        } else {
                            return 1_648721270700128147;
                        }
                    }
                }
            }
        } else {
            if (exponent >= 8) { // 8
                if (exponent >= 12) { // 12
                    if (exponent >= 14) { // 14
                        if (exponent >= 15) { // 15
                            return 1_597995449950633268;
                        } else {
                            return 1_548830298634133098;
                        }
                    } else {
                        if (exponent >= 13) { // 13
                            return 1_501177800000122752;
                        } else {
                            return 1_454991414618201336;
                        }
                    }
                } else {
                    if (exponent >= 10) { // 10
                        if (exponent >= 11) { // 11
                            return 1_410226034925710706;
                        } else {
                            return 1_366837941173796363;
                        }
                    } else {
                        if (exponent >= 9) { // 9
                            return 1_324784758728865569;
                        } else {
                            return 1_284025416687741484;
                        }
                    }
                }
            } else {
                if (exponent >= 4) { // 4
                    if (exponent >= 6) { // 6
                        if (exponent >= 7) { // 7
                            return 1_244520107766095155;
                        } else {
                            return 1_206230249420980711;
                        }
                    } else {
                        if (exponent >= 5) { // 5
                            return 1_169118446169504402;
                        } else {
                            return 1_133148453066826317;
                        }
                    }
                } else {
                    if (exponent >= 2) { // 2
                        if (exponent >= 3) { // 3
                            return 1_098285140307825849;
                        } else {
                            return 1_064494458917859430;
                        }
                    } else {
                        if (exponent >= 1) { // 1
                            return 1_031743407499102671;
                        } else {
                            return 1e18;
                        }
                    }
                }
            }
        } 
    }

    // todo: delete
    function expMeasureGas(int256 x) public view returns (uint256) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        exp(x);

                // if (0 <= x) {
                //     exp(x);
                //     // uint256[4] memory exp1s;
                //     // exp1s = [uint256(1_051271096376024000), 1_105170918075648000, 1_161834242728283000, 1_221402758160170000];
                // }

        endGas = gasleft();
        return startGas - endGas;
    }

    function _abs(int x) internal pure returns (uint result) {
        unchecked {
            result = uint(x < 0 ? -x : x);
        }
    }
}
