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


    bool log = true;

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
    function exp(int256 x) public pure returns (uint256) {
        unchecked {
            // handle special case where x = 0
            if (x == 0) {
                return 1e18;
            }

            bool isPositive = x >= 0;
            if (!isPositive) {
                x = -x;
            }

            // int256 exp1 = 1e18;
            int256 exp2 = 1e18;
            int256 exp3 = 1e18;

            // x: (1, 32]
            if (x >= 1e18) {
                if (x > 1e18) {
                    int256 exponent = x / 1e18;
                    x -= exponent * 1e18;
                    exp2 = getExp2Precalculated(exponent);
                } else {
                    x = 0;
                    exp2 = E;
                }
            }
            // if (log) { if (x >= 0) { console.log("x SOL: %d", uint256(x)); } else { console.log("x SOL: -%d", uint256(-x)); }}


            // x: (0.03125, 1]
            if (x >= 3125e13) {
                if (x > 3125e13) {
                    int256 exponent = x / 3125e13;
                    x -= exponent * 3125e13;
                    exp3 = getExp3Precalculated(exponent);
                } else {
                    x = 0;
                    exp2 = E_TO_003125;
                }
            } 
            // if (log) { if (exp1 > 0) { console.log("exp1 SOL: %d", uint256(exp1)); } else { console.log("exp1 SOL: -%d", uint256(-exp1)); }}
            

            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
            int256 numerator = ((x + 3e18) ** 2) + 3e36;
            int256 denominator = ((3e18 - x) ** 2) + 3e36;
            // int256 exp2 = (numerator * 1e18) / denominator;

            // if (log) { if (exp2 >= 0) { console.log("exp2 SOL: %d", uint256(exp2)); } else { console.log("exp2 SOL: -%d", uint256(-exp2)); }}
            // if (log) { if (exp3 >= 0) { console.log("exp3 SOL: %d", uint256(exp3)); } else { console.log("exp3 SOL: -%d", uint256(-exp3)); }}
            // if (log) { if (numerator >= 0) { console.log("numerator SOL: %d", uint256(numerator)); } else { console.log("numerator SOL: -%d", uint256(-numerator)); }}
            // if (log) { if (denominator >= 0) { console.log("denominator SOL: %d", uint256(denominator)); } else { console.log("denominator SOL: -%d", uint256(-denominator)); }}

            uint256 result = uint(exp2 * exp3 / 1e18 * numerator / (denominator)); // using e ^ (a + b) = e ^ a * e ^ b

            return isPositive ? result : 1 / result;
        }
    }

        function getExp2Precalculated(int256 exponent) private pure returns (int256) {
        // use >=, fastest

        // base is e
        unchecked {
            if (exponent >= 16) { // 16
                if (exponent >= 24) { // 24
                    if (exponent >= 28) { // 28
                        if (exponent >= 30) { // 30
                            if (exponent >= 31) { // 31
                                return 29048849665247_425231085682112499;
                            } else {
                                return 10686474581524_462146990468651499;
                            }
                        } else {
                            if (exponent >= 29) { // 29
                                return 3931334297144_042074388620581499;
                            } else {
                                return 1446257064291_475173677047423499;
                            }
                        }
                    } else {
                        if (exponent >= 26) { // 26
                            if (exponent >= 27) { // 27
                                return 532048240601_798616683747304499;
                            } else {
                                return 195729609428_838764269776398499;
                            }
                        } else {
                            if (exponent >= 25) { // 25
                                return 72004899337_385872524161351499;
                            } else {
                                return 26489122129_843472294139162499;
                            }
                        }
                    }
                } else {
                    if (exponent >= 20) { // 20
                        if (exponent >= 22) { // 22
                            if (exponent >= 23) { // 23
                                return 9744803446_248902600034633499;
                            } else {
                                return 3584912846_131591561681164999;
                            }
                        } else {
                            if (exponent >= 21) { // 21
                                return 1318815734_483214697209999499;
                            } else {
                                return 485165195_409790277969107499;
                            }
                        }
                    } else {
                        if (exponent >= 18) { // 18
                            if (exponent >= 19) { // 19
                                return 178482300_963187260844914999;
                            } else {
                                return 65659969_137330511138787499;
                            }
                        } else {
                            if (exponent >= 17) { // 17
                                return 24154952_753575298214775499;
                            } else {
                                return 8886110_520507872636763499;
                            }
                        }
                    }
                }
            } else {
                if (exponent >= 8) { // 8
                    if (exponent >= 12) { // 12
                        if (exponent >= 14) { // 14
                            if (exponent >= 15) { // 15
                                return 3269017_372472110639302499;
                            } else {
                                return 1202604_284164776777749499;
                            }
                        } else {
                            if (exponent >= 13) { // 13
                                return 442413_392008920503326499;
                            } else {
                                return 162754_791419003920808499;
                            }
                        }
                    } else {
                        if (exponent >= 10) { // 10
                            if (exponent >= 11) { // 11
                                return 59874_141715197818455499;
                            } else {
                                return 22026_465794806716517499;
                            }
                        } else {
                            if (exponent >= 9) { // 9
                                return 8103_083927575384007749;
                            } else {
                                return 2980_957987041728274749;
                            }
                        }
                    }
                } else {
                    if (exponent >= 4) { // 4
                        if (exponent >= 6) { // 6
                            if (exponent >= 7) { // 7
                                return 1096_633158428458599349;
                            } else {
                                return 403_428793492735122615;
                            }
                        } else {
                            if (exponent >= 5) { // 5
                                return 148_413159102576603425;
                            } else {
                                return 54_598150033144239078;
                            }
                        }
                    } else {
                        if (exponent >= 2) { // 2
                            if (exponent >= 3) { // 3
                                return 20_085536923187667741;
                            } else {
                                return 7_389056098930650227;
                            }
                        } else {
                            if (exponent >= 1) { // 1
                                return 2_718281828459045235;
                            } else {
                                return 1e18;
                            }
                        }
                    }
                }
            } 
        }
    }

    function getExp3Precalculated(int256 exponent) private pure returns (int256) {
        // use >=, fastest

        // base is 1.031743407499102671
        unchecked {
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
