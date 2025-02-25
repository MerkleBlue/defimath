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

    // x is in range [1, 16] 
    function ln(uint256 x) public pure returns (uint256) {
        unchecked {
            uint256 multiplier;

            // x: [1, 16)
            if (x >= 1_090507732665257659) {
                uint256 divider;
                (divider, multiplier) = getLnPrecalculated(x);
                x = x * 1e18 / divider;
            }

            // we use Pade approximation for ln(x)
            // ln(x) ≈ (x - 1) / (x + 1) * (1 + 1/3 * ((x - 1) / (x + 1)) ^ 2 + 1/5 * ((x - 1) / (x + 1)) ^ 4 + 1/7 * ((x - 1) / (x + 1)) ^ 6)
            // fraction = (x - 1) / (x + 1)
            uint256 fraction = (x - 1e18) * 1e18 / (x + 1e18);
            // if (log) { console.log("SOL fraction: %d", fraction); }

            uint256 fraction2 = fraction ** 2 / 1e18;
            uint256 fraction4 = fraction2 ** 2 / 1e18;
            uint256 fraction6 = fraction2 * fraction4 / 1e18;
            uint256 naturalLog = fraction * (1e36 + 333333333333333334 * fraction2 + 200000000000000000 * fraction4 + 142857142857142857 * fraction6);
            
            return 2 * naturalLog / 1e36 + multiplier * 86643397569993164; // using ln(a * b) = ln(a) + ln(b)
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

    function getLnPrecalculated(uint256 exponent) private pure returns (uint256, uint256) {
        // use >=, fastest
        unchecked {
            if (exponent >= 4e18) { // 16
                if (exponent >= 8e18) { // 24
                    if (exponent >= 11_313708498984760395) { // 28
                        if (exponent >= 13_454342644059432688) { // 30
                            if (exponent >= 14_672064691274739708) { // 31
                                return (14_672064691274739708, 31);
                            } else {
                                return (13_454342644059432688, 30);
                            }
                        } else {
                            if (exponent >= 12_337686603263526589) { // 29
                                return (12_337686603263526589, 29);
                            } else {
                                return (11_313708498984760395, 28);
                            }
                        }
                    } else {
                        if (exponent >= 9_513656920021768534) { // 26
                            if (exponent >= 10_374716437208077327) { // 27
                                return (10_374716437208077327, 27);
                            } else {
                                return (9_513656920021768534, 26);
                            }
                        } else {
                            if (exponent >= 8_724061861322061274) { // 25
                                return (8_724061861322061274, 25);
                            } else {
                                return (8e18, 24);
                            }
                        }
                    }
                } else {
                    if (exponent >= 5_656854249492380195) { // 20
                        if (exponent >= 6_727171322029716344) { // 22
                            if (exponent >= 7_336032345637369854) { // 23
                                return (7_336032345637369854, 23);
                            } else {
                                return (6_727171322029716344, 22);
                            }
                        } else {
                            if (exponent >= 6_168843301631763294) { // 21
                                return (6_168843301631763294, 21);
                            } else {
                                return (5_656854249492380195, 20);
                            }
                        }
                    } else {
                        if (exponent >= 4_756828460010884267) { // 18
                            if (exponent >= 5_187358218604038664) { // 19
                                return (5_187358218604038664, 19);
                            } else {
                                return (4_756828460010884267, 18);
                            }
                        } else {
                            if (exponent >= 4_362030930661030637) { // 17
                                return (4_362030930661030637, 17);
                            } else {
                                return (4e18, 16);
                            }
                        }
                    }
                }
            } else {
                if (exponent >= 2e18) { // 8
                    if (exponent >= 2_828427124746190098) { // 12
                        if (exponent >= 3_363585661014858172) { // 14
                            if (exponent >= 3_668016172818684927) { // 15
                                return (3_668016172818684927, 15);
                            } else {
                                return (3_363585661014858172, 14);
                            }
                        } else {
                            if (exponent >= 3_084421650815881647) { // 13
                                return (3_084421650815881647, 13);
                            } else {
                                return (2_828427124746190098, 12);
                            }
                        }
                    } else {
                        if (exponent >= 2_378414230005442133) { // 10
                            if (exponent >= 2_593679109302019332) { // 11
                                return (2_593679109302019332, 11);
                            } else {
                                return (2_378414230005442133, 10);
                            }
                        } else {
                            if (exponent >= 2_181015465330515318) { // 9
                                return (2_181015465330515318, 9);
                            } else {
                                return (2e18, 8);
                            }
                        }
                    }
                } else {
                    if (exponent >= 1_414213562373095049) { // 4
                        if (exponent >= 1_681792830507429086) { // 6
                            if (exponent >= 1_834008086409342464) { // 7
                                return (1_834008086409342464, 7);
                            } else {
                                return (1_681792830507429086, 6);
                            }
                        } else {
                            if (exponent >= 1_542210825407940824) { // 5
                                return (1_542210825407940824, 5);
                            } else {
                                return (1_414213562373095049, 4);
                            }
                        }
                    } else {
                        if (exponent >= 1_189207115002721067) { // 2
                            if (exponent >= 1_296839554651009666) { // 3
                                return (1_296839554651009666, 3);
                            } else {
                                return (1_189207115002721067, 2);
                            }
                        } else {
                            // there is no 0
                            return (1_090507732665257659, 1);
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

        endGas = gasleft();

        return startGas - endGas;
    }

    function lnMeasureGas(uint256 x) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = ln(x);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    // function _abs(int x) internal pure returns (uint result) {
    //     unchecked {
    //         result = uint(x < 0 ? -x : x);
    //     }
    // }
}
