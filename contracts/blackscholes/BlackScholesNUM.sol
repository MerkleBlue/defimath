// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Uncomment this line to use console.log
import "hardhat/console.sol";
import "./Math.sol";

contract BlackScholesNUM {

    uint256 internal constant SECONDS_IN_YEAR = 31536000;
    // int256 internal constant E_TO_003125 = 1_031743407499102671;            // e ^ 0.03125
    // int256 internal constant E = 2_718281828459045235;                      // e
    // int256 internal constant E_TO_32 = 78962960182680_695160978022635000;   // e ^ 32

    bool log = true;


    // function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) external pure returns (uint256) {
    //     unchecked {
    //         return _getFuturePrice(spot, timeToExpirySec, rate);
    //     }
    // }

    // function _getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) private pure returns (uint256) {
    //     unchecked {
    //         // we use Pade approximation for exp(x)
    //         // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)

    //         // NOTE: this is slower than below
    //         // uint256 timeToExpiryYears = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;
    //         // uint256 x = rate * timeToExpiryYears / 1e13;

    //         // NOTE: this is faster than the above 
    //         uint256 x = uint256(timeToExpirySec) * 1e5 * rate / SECONDS_IN_YEAR;

    //         // todo: check x is not more than 0.2

    //         uint256 numerator = (x + 3e9) ** 2 + 3e18;
    //         uint256 denominator = (3e9 - x) ** 2 + 3e18;

    //         return numerator * spot / denominator;
    //     }
    // }

    // function _getDiscountedStrikePrice(uint128 strike, uint32 timeToExpirySec, uint16 rate) private pure returns (uint256) {
    //     unchecked {
    //         // we use Pade approximation for exp(x)
    //         // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)

    //         // NOTE: this is faster than the above 
    //         uint256 x = uint256(timeToExpirySec) * 1e5 * rate / SECONDS_IN_YEAR;

    //         // todo: check x is not more than 0.2

    //         uint256 numerator = (x + 3e9) ** 2 + 3e18;
    //         uint256 denominator = (3e9 - x) ** 2 + 3e18;

    //         return denominator * strike / numerator;
    //     }
    // }

    function exp(uint256 x) public pure returns (uint256) {
        unchecked {
            uint256 exp123 = 1;

            // x: [32, 50)
            if (x >= 32e18) {
                exp123 = getExp1Precalculated(x / 32e18);
                x %= 32e18;
            }

            // x: [1, 32)
            if (x >= 1e18) {
                exp123 *= getExp2Precalculated(x / 1e18);
                x %= 1e18;
            } else {
                exp123 *= 1e15;
            }

            // x: [0.03125, 1)
            if (x >= 3125e13) {
                exp123 *= getExp3Precalculated(x / 3125e13);
                x %= 3125e13;
            } else {
                exp123 *= 1e15;
            }

            // if (log) { if (exp1 > 0) { console.log("exp1 SOL: %d", uint256(exp1)); } else { console.log("exp1 SOL: -%d", uint256(-exp1)); }}

            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
            //uint256 x12 = x / 1e12;
            uint256 denominator = ((3e18 - x) ** 2) + 3e36;
            x /= 1e6;
            uint256 numerator = ((x + 3e12) ** 2) + 3e24;


            // if (log) { if (exp2 >= 0) { console.log("exp2 SOL: %d", uint256(exp2)); } else { console.log("exp2 SOL: -%d", uint256(-exp2)); }}
            // if (log) { if (exp3 >= 0) { console.log("exp3 SOL: %d", uint256(exp3)); } else { console.log("exp3 SOL: -%d", uint256(-exp3)); }}
            // if (log) { if (numerator >= 0) { console.log("numerator SOL: %d", uint256(numerator)); } else { console.log("numerator SOL: -%d", uint256(-numerator)); }}
            // if (log) { if (denominator >= 0) { console.log("denominator SOL: %d", uint256(denominator)); } else { console.log("denominator SOL: -%d", uint256(-denominator)); }}

            return exp123 * numerator / denominator; // using e ^ (a + b) = e ^ a * e ^ b
        }
    }

    function getExp1Precalculated(uint256 exponent) private pure returns (uint256) {
        unchecked {
            return 78962960182681 ** exponent;
        }
    }

    function getExp2Precalculated(uint256 exponent) private pure returns (uint256) {
        // use >=, fastest

        // base is e
        unchecked {
            if (exponent >= 16) { // 16
                if (exponent >= 24) { // 24
                    if (exponent >= 28) { // 28
                        if (exponent >= 30) { // 30
                            if (exponent >= 31) { // 31
                                return 29048849665247_425231085682112;
                            } else {
                                return 10686474581524_462146990468651;
                            }
                        } else {
                            if (exponent >= 29) { // 29
                                return 3931334297144_042074388620581;
                            } else {
                                return 1446257064291_475173677047423;
                            }
                        }
                    } else {
                        if (exponent >= 26) { // 26
                            if (exponent >= 27) { // 27
                                return 532048240601_798616683747304;
                            } else {
                                return 195729609428_838764269776398;
                            }
                        } else {
                            if (exponent >= 25) { // 25
                                return 72004899337_385872524161351;
                            } else {
                                return 26489122129_843472294139162;
                            }
                        }
                    }
                } else {
                    if (exponent >= 20) { // 20
                        if (exponent >= 22) { // 22
                            if (exponent >= 23) { // 23
                                return 9744803446_248902600034633;
                            } else {
                                return 3584912846_131591561681164;
                            }
                        } else {
                            if (exponent >= 21) { // 21
                                return 1318815734_483214697209999;
                            } else {
                                return 485165195_409790277969107;
                            }
                        }
                    } else {
                        if (exponent >= 18) { // 18
                            if (exponent >= 19) { // 19
                                return 178482300_963187260844914;
                            } else {
                                return 65659969_137330511138787; // 65659969137330511138787499
                            }
                        } else {
                            if (exponent >= 17) { // 17
                                return 24154952_753575298214775;
                            } else {
                                return 8886110_520507872636763;
                            }
                        }
                    }
                }
            } else {
                if (exponent >= 8) { // 8
                    if (exponent >= 12) { // 12
                        if (exponent >= 14) { // 14
                            if (exponent >= 15) { // 15
                                return 3269017_372472110639302;
                            } else {
                                return 1202604_284164776777749;
                            }
                        } else {
                            if (exponent >= 13) { // 13
                                return 442413_392008920503326;
                            } else {
                                return 162754_791419003920808;
                            }
                        }
                    } else {
                        if (exponent >= 10) { // 10
                            if (exponent >= 11) { // 11
                                return 59874_141715197818455;
                            } else {
                                return 22026_465794806716517;
                            }
                        } else {
                            if (exponent >= 9) { // 9
                                return 8103_083927575384008;
                            } else {
                                return 2980_957987041728275;
                            }
                        }
                    }
                } else {
                    if (exponent >= 4) { // 4
                        if (exponent >= 6) { // 6
                            if (exponent >= 7) { // 7
                                return 1096_633158428458599;
                            } else {
                                return 403_428793492735123;
                            }
                        } else {
                            if (exponent >= 5) { // 5
                                return 148_413159102576603;
                            } else {
                                return 54_598150033144239;
                            }
                        }
                    } else {
                        if (exponent >= 2) { // 2
                            if (exponent >= 3) { // 3
                                return 20_085536923187668;
                            } else {
                                return 7_389056098930650;
                            }
                        } else {
                            // there is no 0
                            return 2_718281828459045;
                            // if (exponent >= 1) { // 1
                            //     return 2_718281828459045;
                            // } else {
                            //     return 1e15;
                            // }
                        }
                    }
                }
            } 
        }
    }

    function getExp3Precalculated(uint256 exponent) private pure returns (uint256) {
        // use >=, fastest

        // base is 1.031743407499102671
        unchecked {
            // if (exponent == 32) {
            //     return E;
            // }

            if (exponent >= 16) { // 16
                if (exponent >= 24) { // 24
                    if (exponent >= 28) { // 28
                        if (exponent >= 30) { // 30
                            if (exponent >= 31) { // 31
                                return 2_634649088815631;
                            } else {
                                return 2_553589458062927;
                            }
                        } else {
                            if (exponent >= 29) { // 29
                                return 2_475023769963025;
                            } else {
                                return 2_398875293967098;
                            }
                        }
                    } else {
                        if (exponent >= 26) { // 26
                            if (exponent >= 27) { // 27
                                return 2_325069660277121;
                            } else {
                                return 2_253534787213208;
                            }
                        } else {
                            if (exponent >= 25) { // 25
                                return 2_184200810815618;
                            } else {
                                return 2_117000016612675;
                            }
                        }
                    }
                } else {
                    if (exponent >= 20) { // 20
                        if (exponent >= 22) { // 22
                            if (exponent >= 23) { // 23
                                return 2_051866773487977;
                            } else {
                                return 1_988737469582292;
                            }
                        } else {
                            if (exponent >= 21) { // 21
                                return 1_927550450167545;
                            } else {
                                return 1_868245957432222;
                            }
                        }
                    } else {
                        if (exponent >= 18) { // 18
                            if (exponent >= 19) { // 19
                                return 1_810766072119387;
                            } else {
                                return 1_755054656960299;
                            }
                        } else {
                            if (exponent >= 17) { // 17
                                return 1_701057301848401;
                            } else {
                                return 1_648721270700128;
                            }
                        }
                    }
                }
            } else {
                if (exponent >= 8) { // 8
                    if (exponent >= 12) { // 12
                        if (exponent >= 14) { // 14
                            if (exponent >= 15) { // 15
                                return 1_597995449950633;
                            } else {
                                return 1_548830298634133;
                            }
                        } else {
                            if (exponent >= 13) { // 13
                                return 1_501177800000123;
                            } else {
                                return 1_454991414618201;
                            }
                        }
                    } else {
                        if (exponent >= 10) { // 10
                            if (exponent >= 11) { // 11
                                return 1_410226034925711;
                            } else {
                                return 1_366837941173796;
                            }
                        } else {
                            if (exponent >= 9) { // 9
                                return 1_324784758728866;
                            } else {
                                return 1_284025416687741;
                            }
                        }
                    }
                } else {
                    if (exponent >= 4) { // 4
                        if (exponent >= 6) { // 6
                            if (exponent >= 7) { // 7
                                return 1_244520107766095;
                            } else {
                                return 1_206230249420981;
                            }
                        } else {
                            if (exponent >= 5) { // 5
                                return 1_169118446169504;
                            } else {
                                return 1_133148453066826;
                            }
                        }
                    } else {
                        if (exponent >= 2) { // 2
                            if (exponent >= 3) { // 3
                                return 1_098285140307826;
                            } else {
                                return 1_064494458917859;
                            }
                        } else {
                            // there is no 0
                            return 1_031743407499103;
                            // if (exponent >= 1) { // 1
                            //     return 1_031743407499103;
                            // } else {
                            //     return 1e15;
                            // }
                        }
                    }
                }
            } 
        }
    }


    // gas 592 when x > 0.05
    // function expPosNeg(int256 x) public pure returns (uint256) {
    //     unchecked {
    //         // handle special case where x = 0
    //         // if (x == 0) {
    //         //     return 1e18;
    //         // }

    //         bool isPositive = x >= 0;
    //         if (!isPositive) {
    //             x = -x;
    //         }

    //         // int256 exp1 = 1e18;
    //         // int256 exp2 = 1e18;
    //         // int256 exp3 = 1e18;

    //         // x: [1, 32)
    //         // if (x >= 1e18) {
    //         //     int256 exponent = x / 1e18;
    //         //     x %= 1e18;
    //         //     exp2 = getExp2Precalculated(exponent);
    //         // }
    //         // {
    //             int256 exponent2 = x / 1e18;
    //             x %= 1e18;
    //             int256 exp2 = exponent2 == 0 ? int256(1e18) : getExp2Precalculated(exponent2);
    //         // }

    //         // if (log) { if (x >= 0) { console.log("x SOL: %d", uint256(x)); } else { console.log("x SOL: -%d", uint256(-x)); }}


    //         // x: [0.03125, 1)
    //         // {
    //             int256 exponent3 = x / 3125e13;
    //             x %= 3125e13;
    //             int256 exp3 = exponent3 == 0 ? int256(1e18) : getExp3Precalculated(exponent3);
    //         // }

    //         // if (log) { if (exp1 > 0) { console.log("exp1 SOL: %d", uint256(exp1)); } else { console.log("exp1 SOL: -%d", uint256(-exp1)); }}
            

    //         // we use Pade approximation for exp(x)
    //         // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    //         int256 numerator = ((x + 3e18) ** 2) + 3e36;
    //         int256 denominator = ((3e18 - x) ** 2) + 3e36;
    //         // int256 exp2 = (numerator * 1e18) / denominator;

    //         // if (log) { if (exp2 >= 0) { console.log("exp2 SOL: %d", uint256(exp2)); } else { console.log("exp2 SOL: -%d", uint256(-exp2)); }}
    //         // if (log) { if (exp3 >= 0) { console.log("exp3 SOL: %d", uint256(exp3)); } else { console.log("exp3 SOL: -%d", uint256(-exp3)); }}
    //         // if (log) { if (numerator >= 0) { console.log("numerator SOL: %d", uint256(numerator)); } else { console.log("numerator SOL: -%d", uint256(-numerator)); }}
    //         // if (log) { if (denominator >= 0) { console.log("denominator SOL: %d", uint256(denominator)); } else { console.log("denominator SOL: -%d", uint256(-denominator)); }}

    //         uint256 result = uint(exp2 * exp3 / 1e18 * numerator / (denominator)); // using e ^ (a + b) = e ^ a * e ^ b

    //         return isPositive ? result : 1 / result;
    //     }
    // }

    function testIfMeasureGas(uint256 exponent) public view returns (uint256) {
        uint256 startGas;
        uint256 endGas;
        uint result;
        startGas = gasleft();

        result = Math.testIf(exponent);
        // uint256[4] memory exp1s;
        // exp1s = [uint256(1_051271096376024000), 1_105170918075648000, 1_161834242728283000, 1_221402758160170000];
        // result = exp1s[exponent];



                // if (0 <= x) {
                //     exp(x);
                //     // uint256[4] memory exp1s;
                //     // exp1s = [uint256(1_051271096376024000), 1_105170918075648000, 1_161834242728283000, 1_221402758160170000];
                // }

        endGas = gasleft();

        console.log("result: %d", result);
        return startGas - endGas;
    }

    

    // todo: delete
    function expMeasureGas(uint256 x) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = exp(x);

                // if (0 <= x) {
                //     exp(x);
                //     // uint256[4] memory exp1s;
                //     // exp1s = [uint256(1_051271096376024000), 1_105170918075648000, 1_161834242728283000, 1_221402758160170000];
                // }

        endGas = gasleft();


        return startGas - endGas;
    }

    // function _abs(int x) internal pure returns (uint result) {
    //     unchecked {
    //         result = uint(x < 0 ? -x : x);
    //     }
    // }
}
