// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Uncomment this line to use console.log
import "hardhat/console.sol";
import "./Math.sol";

contract BlackScholesNUM {

    uint256 internal constant SEC_ANNUALIZED = 31709791984; // 31709791983764586504
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    // limits
    uint256 public constant MIN_SPOT = 1e12 - 1;               // 1 milionth of a $
    uint256 public constant MAX_SPOT = 1e33 + 1;               // 1 quadrillion $
    uint256 public constant MAX_STRIKE_SPOT_RATIO = 5;   
    uint256 public constant MAX_EXPIRATION = 63072000 + 1;     // 2 years
    uint256 public constant MIN_VOLATILITY = 1e16 - 1;         // 1% volatility
    uint256 public constant MAX_VOLATILITY = 192e16 + 1;       // 192% volatility
    uint256 public constant MAX_RATE = 2000 + 1;               // 20% risk-free rate

    bool log = true;

    // error
    error OutOfBoundsError(uint256);

    function getCallOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint16 rate
    ) public pure returns (uint256 price) {
        unchecked {
            // step 0) check inputs
            // if (spot <= MIN_SPOT) revert OutOfBoundsError(1);
            // if (MAX_SPOT <= spot) revert OutOfBoundsError(2);
            // if (strike * MAX_STRIKE_SPOT_RATIO < spot) revert OutOfBoundsError(3);
            // if (spot * MAX_STRIKE_SPOT_RATIO < strike) revert OutOfBoundsError(4);
            // if (MAX_EXPIRATION <= timeToExpirySec) revert OutOfBoundsError(5);
            // if (volatility <= MIN_VOLATILITY) revert OutOfBoundsError(6);
            // if (MAX_VOLATILITY <= volatility) revert OutOfBoundsError(7);
            // if (MAX_RATE <= rate) revert OutOfBoundsError(8);

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR; // todo: test later with uint256(timeToExpirySec) * SEC_ANNUALIZED;
            uint256 volAdj = volatility * sqrt(timeYear) / 1e18;
            uint256 rateAdj = uint256(rate) * timeYear / 1e4;


            int256 d1 = getD1(spot, strike, volAdj, rateAdj);
            int256 d2 = d1 - int256(volAdj);

            uint256 discountedStrike = _getDiscountedStrikePrice(strike, uint128(rateAdj));

            uint256 spotxCdfD1 = uint256(spot) * stdNormCDF(d1);
            uint256 strikexCdfD2 = discountedStrike * stdNormCDF(d2);

            if (spotxCdfD1 > strikexCdfD2) {
                price = (spotxCdfD1 - strikexCdfD2) / 1e18;
            }


            // price = (uint256(spot) * stdNormCDF(d1) - discountedStrike * stdNormCDF(d2)) / 1e18;

            // if (log) console.log("part1 SOL: %d", uint256(part1));
            // if (log) console.log("part2 SOL: %d", uint256(part2));
            // console.log("timeYear: %d", uint256(timeYear));
            // console.log("volAdj: %d", uint256(volAdj));
            // console.log("rateAdj: %d", uint256(rateAdj));
            // if (log) { if (d1 > 0) { console.log("d1: %d", uint256(d1)); } else { console.log("d1: -%d", uint256(-d1)); }}
            // if (log) { if (d2 > 0) { console.log("d2: %d", uint256(d2)); } else { console.log("d2: -%d", uint256(-d2)); }}
            // console.log("discountedStrike: %d", uint256(discountedStrike));
        }
    }


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

    function _getDiscountedStrikePrice(uint256 strike, uint128 rateAdj) private pure returns (uint256) {
        unchecked {
            // console.log("strike: %d", uint256(strike));
            // console.log("expPositive(rateAdj): %d", uint256(expPositive(rateAdj)));
            return strike * 1e18 / expPositive(rateAdj);
        }
    }

    function expNegative(uint256 x) public pure returns (uint256) {
        unchecked {
            return 1e36 / expPositive(x);
        }
    }

    function expPositive(uint256 x) public pure returns (uint256) {
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

            return exp123 * numerator / denominator; // using e ^ (a + b) = e ^ a * e ^ b
        }
    }

    function ln(uint256 x) public pure returns (int256) {
        unchecked {
            if (x >= 1e18) {
                return int256(lnUpper(x));
            }

            return -int256(lnUpper(1e36 / x));
        }
    }

    // x: [1, 16] 
    function lnUpper(uint256 x) public pure returns (uint256) {
        unchecked {
            uint256 multiplier;

            // x: [1.0905, 16)
            if (x >= 1_090507732665257659) {
                uint256 divider;
                (divider, multiplier) = getLnPrecalculated(x); // todo: should we return multiplier, why not value?
                x = x * 1e18 / divider;
            }

            // we use Pade approximation for ln(x)
            // ln(x) ≈ (x - 1) / (x + 1) * (1 + 1/3 * ((x - 1) / (x + 1)) ^ 2 + 1/5 * ((x - 1) / (x + 1)) ^ 4 + 1/7 * ((x - 1) / (x + 1)) ^ 6)
            // fraction = (x - 1) / (x + 1)
            uint256 fraction = (x - 1e18) * 1e18 / (x + 1e18);

            uint256 fraction2 = fraction * fraction;
            uint256 fraction4 = fraction2 * fraction2 / 1e36;
            uint256 fraction6 = fraction4 * fraction2 / 1e36;
            uint256 naturalLog = fraction * (1e36 + fraction2 / 3 + fraction4 / 5 + fraction6 / 7);
            
            return naturalLog / 5e35 + multiplier * 86643397569993164; // using ln(a * b) = ln(a) + ln(b)
        }
    }

    function sqrt(uint256 x) public pure returns (uint256) {
        unchecked {
            if (x >= 1e18) {
                return sqrtUpper(x);
            }

            return 1e36 / sqrtUpper(1e36 / x);
        }
    }

    // x: [1, 1e8]
    function sqrtUpper(uint256 x) public pure returns (uint256) {
        unchecked {
            uint256 zeros = 1;
            uint256 sqrtPrecompute = 1e18;

            // x: [100, 1e8) use scalability rule: sqrt(1234) = 10 * sqrt(12.34);
            if (x >= 1e20) {
                zeros = getSqrtZerosPrecompute(x);
                x /= zeros * zeros;
            }

            // x: [1.076, 100) use precomputed values
            if (x >= 1_074607828321317497) {
                sqrtPrecompute = getSqrtPrecomputed(x);
                x = x * 1e36 / (sqrtPrecompute * sqrtPrecompute);
            }

            // x: [1, 1.076] use Maclaurin series
            x -= 1e18;
            uint256 x2 =  x * x / 1e18;
            uint256 x3 = x2 * x / 1e18;
            uint256 x4 = x3 * x / 1e18;
            uint256 sqrtAprox = 1e36 + 5e17 * x - 125e15 * x2 + 625e14 * x3 - 390625e11 * x4 + x4 * (105 * x / 3840 - 945 * x2 / 46080 + 10395 * x3 / 645120 - 135135 * x4 / 10321920);

            return sqrtAprox * sqrtPrecompute * zeros / 1e36;

            // this is 10 gas faster, but maybe there are overflows
            // uint256 result = 1e36 + 5e17 * x - 125e15 * x2 + 625e14 * x3 - 390625e11 * x4 + x4 * (105 * x / 3840 - 945 * x2 / 46080 + 10395 * x3 / 645120);
            // return exp123 * result / 1e54;

            // const result = 1 + x/2 - 1/8 * x^2 + 3/48 * x^3 - 15/384 * x^4 + 105/3840 * x^5 - 945/46080 * x^6 + 10395/645120 * x^7 - 135135/10321920 * x^8;
        }
    }

    function getD1(
        uint128 spot,
        uint128 strike,
        uint256 volAdj, // was uint80
        uint256 rateAdj
    ) public pure returns (int256) {
        unchecked {
            // int256 timeYear = int256(uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR); // todo: optimization multiply by SEC_ANNUALIZED
            // todo: maybe use 1000 + ln... -1000, to avoid conversion to int256
            int256 nominator = ln(uint256(spot) * 1e18 / uint256(strike)) + int256(rateAdj + (volAdj * volAdj / 1e18) / 2) ;
            int256 denominator = int256(volAdj);

            return nominator * 1e18 / denominator;
        }

        // const d1 = (rate * timeToExpiryYear + (vol ** 2) * timeToExpiryYear / 2 - this.lnUpper(strike / spot)) / (vol * Math.sqrt(timeToExpiryYear));
    }

      // using erf function
    function stdNormCDF(int256 x) public pure returns (uint256) {
        unchecked {
            // todo: make sure erf(x) is < 1
            // int256 erfResult = erf(x * 707106781186547524 / 1e18);
            // if (log) { if (erfResult > 0) { console.log("erfResult SOL: %d", uint256(erfResult)); } else { console.log("erfResult SOL: -%d", uint256(-erfResult)); }}

            return uint256(1e18 + erf(x * 707106781186547524 / 1e18)) / 2; // 1 / sqrt(2)
        }
    }


    // erf maximum error: 1.5×10−7 - https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions
    function erf(int256 z) private pure returns (int256) {
        unchecked {
            // if (log) { if (z > 0) { console.log("z: %d", uint256(z)); } else { console.log("z: -%d", uint256(-z)); }}

            // Save the sign of x
            int256 sign = 1;
            if (z < 0) {
                sign = -1;
            }
            z = z * sign;

            int256 t = 1e45 / (1e27 + 327591100 * z);
            // if (log) { if (t > 0) { console.log("t: %d", uint256(t)); } else { console.log("t: -%d", uint256(-t)); }}

            int256 t2 = t * t / 1e18;
            int256 t3 = t2 * t / 1e18;
            int256 t4 = t3 * t / 1e18;
            int256 t5 = t4 * t / 1e18;
            int256 poly = (254829592 * t - 284496736 * t2 + 1421413741 * t3 - 1453152027 * t4 + 1061405429 * t5) / 1e9; 

            // if (log) { if (poly > 0) { console.log("poly: %d", uint256(poly)); } else { console.log("poly: -%d", uint256(-poly)); }}

            int256 approx = (1e36 - poly * int256(expNegative(uint256(z * z) / 1e18))) / 1e18;

            // if (log) { if (approx > 0) { console.log("approx: %d", uint256(approx)); } else { console.log("approx: -%d", uint256(-approx)); }}

            return approx * sign;
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

    function getSqrtPrecomputed(uint256 exponent) private pure returns (uint256) {
        // use >=, fastest

        // base is root(64, 100) = 1.074607828321317497
        unchecked {
            if (exponent >= 10e18) { // 32
                if (exponent >= 31_622776601683793325) { // 48
                    if (exponent >= 56_234132519034908039) { // 56
                        if (exponent >= 74_989420933245582735) { // 60
                            if (exponent >= 86_596432336006535235) { // 62
                                if (exponent >= 93_057204092969897929) { // 63
                                    return 9_646616199111992137;
                                } else {
                                    return 9_305720409296989793;
                                }
                            } else {
                                if (exponent >= 80_584218776148181700) { // 61
                                    return 8_976871324473141945;
                                } else {
                                    return 8_659643233600653524;
                                }
                            }
                        } else {
                            if (exponent >= 64_938163157621131513) { // 58
                                if (exponent >= 69_783058485986633841) { // 59
                                    return 8_353625469578261733;
                                } else {
                                    return 8_058421877614818170;
                                }
                            } else {
                                if (exponent >= 60_429639023813281904) { // 57
                                    return 7_773650302387758033;
                                } else {
                                    return 7_498942093324558273;
                                }
                            }
                        }
                    } else {
                        if (exponent >= 42_169650342858224857) { // 52
                            if (exponent >= 48_696752516586311494) { // 54
                                if (exponent >= 52_329911468149468810) { // 55
                                    return 7_233941627366747615;
                                } else {
                                    return 6_978305848598663384;
                                }
                            } else {
                                if (exponent >= 45_315836376008178832) { // 53
                                    return 6_731703824144982304;
                                } else {
                                    return 6_493816315762113151;
                                }
                            }
                        } else {
                            if (exponent >= 36_517412725483770582) { // 50
                                if (exponent >= 39_241897584845358617) { // 51
                                    return 6_264335366568855612;
                                } else {
                                    return 6_042963902381328190;
                                }
                            } else {
                                if (exponent >= 33_982083289425593715) { // 49
                                    return 5_829415347136073964;
                                } else {
                                    return 5_623413251903490804;
                                }
                            }
                        }
                    }
                } else {
                    if (exponent >= 17_782794100389228012) { // 40
                        if (exponent >= 23_713737056616552617) { // 44
                            if (exponent >= 27_384196342643612942) { // 46
                                if (exponent >= 29_427271762092818114) { // 47
                                    return 5_424690937011326004;
                                } else {
                                    return 5_232991146814946881;
                                }
                            } else {
                                if (exponent >= 25_482967479793465277) { // 45
                                    return 5_048065716667470770;
                                } else {
                                    return 4_869675251658631149;
                                }
                            }
                        } else {
                            if (exponent >= 20_535250264571460746) { // 42
                                if (exponent >= 22_067340690845898003) { // 43
                                    return 4_697588816706491820;
                                } else {
                                    return 4_531583637600817883;
                                }
                            } else {
                                if (exponent >= 19_109529749704405163) { // 41
                                    return 4_371444812611089702;
                                } else {
                                    return 4_216965034285822486;
                                }
                            }
                        }
                    } else {
                        if (exponent >= 13_335214321633240257) { // 36
                            if (exponent >= 15_399265260594919896) { // 38
                                if (exponent >= 16_548170999431814229) { // 39
                                    return 4_067944321083047251;
                                } else {
                                    return 3_924189758484535862;
                                }
                            } else {
                                if (exponent >= 14_330125702369627416) { // 37
                                    return 3_785515249258629973;
                                } else {
                                    return 3_651741272548377058;
                                }
                            }
                        } else {
                            if (exponent >= 11_547819846894581797) { // 34
                                if (exponent >= 12_409377607517195661) { // 35
                                    return 3_522694651473101445;
                                } else {
                                    return 3_398208328942559372;
                                }
                            } else {
                                if (exponent >= 10_746078283213174972) { // 33
                                    return 3_278121151393458639;
                                } else {
                                    return 3_162277660168379332;
                                }
                            }
                        }
                    }
                } 
            } else {
                if (exponent >= 3_162277660168379332) { // 16
                    if (exponent >= 5_623413251903490804) { // 24
                        if (exponent >= 7_498942093324558273) { // 28
                            if (exponent >= 8_659643233600653524) { // 30
                                if (exponent >= 9_305720409296989793) { // 31
                                    return 3_050527890267025537;
                                } else {
                                    return 2_942727176209281811;
                                }
                            } else {
                                if (exponent >= 8_058421877614818170) { // 29
                                    return 2_838735964758754764;
                                } else {
                                    return 2_738419634264361294;
                                }
                            }
                        } else {
                            if (exponent >= 6_493816315762113152) { // 26
                                if (exponent >= 6_978305848598663384) { // 27
                                    return 2_641648320386092458;
                                } else {
                                    return 2_548296747979346528;
                                }
                            } else {
                                if (exponent >= 6_042963902381328190) { // 25
                                    return 2_458244068920197393;
                                } else {
                                    return 2_371373705661655262;
                                }
                            }
                        }
                    } else {
                        if (exponent >= 4_216965034285822486) { // 20
                            if (exponent >= 4_869675251658631149) { // 22
                                if (exponent >= 5_232991146814946881) { // 23
                                    return 2_287573200318395687;
                                } else {
                                    return 2_206734069084589800;
                                }
                            } else {
                                if (exponent >= 4_531583637600817883) { // 21
                                    return 2_128751661796372593;
                                } else {
                                    return 2_053525026457146075;
                                }
                            }
                        } else {
                            if (exponent >= 3_651741272548377058) { // 18
                                if (exponent >= 3_924189758484535862) { // 19
                                    return 1_980956778550338756;
                                } else {
                                    return 1_910952974970440516;
                                }
                            } else {
                                if (exponent >= 3_398208328942559372) { // 17
                                    return 1_843422992409110474;
                                } else {
                                    return 1_778279410038922801;
                                }
                            }
                        }
                    }
                } else {
                    if (exponent >= 1_778279410038922801) { // 8
                        if (exponent >= 2_371373705661655262) { // 12
                            if (exponent >= 2_738419634264361294) { // 14
                                if (exponent >= 2_942727176209281811) { // 15
                                    return 1_715437896342878923;
                                } else {
                                    return 1_654817099943181423;
                                }
                            } else {
                                if (exponent >= 2_548296747979346528) { // 13
                                    return 1_596338544287942240;
                                } else {
                                    return 1_539926526059491990;
                                }
                            }
                        } else {
                            if (exponent >= 2_053525026457146074) { // 10
                                if (exponent >= 2_206734069084589800) { // 11
                                    return 1_485508017172775073;
                                } else {
                                    return 1_433012570236962742;
                                }
                            } else {
                                if (exponent >= 1_910952974970440516) { // 9
                                    return 1_382372227357899619;
                                } else {
                                    return 1_333521432163324026;
                                }
                            }
                        }
                    } else {
                        if (exponent >= 1_333521432163324026) { // 4
                            if (exponent >= 1_539926526059491990) { // 6
                                if (exponent >= 1_654817099943181423) { // 7
                                    return 1_286396944936974508;
                                } else {
                                    return 1_240937760751719566;
                                }
                            } else {
                                if (exponent >= 1_433012570236962742) { // 5
                                    return 1_197085030495729966;
                                } else {
                                    return 1_154781984689458180;
                                }
                            }
                        } else {
                            if (exponent >= 1_154781984689458180) { // 2
                                if (exponent >= 1_240937760751719566) { // 3
                                    return 1_113973859994802376;
                                } else {
                                    return 1_074607828321317497;
                                }
                            } else {
                                // there is no 0
                                return 1_036632928437697997;
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
    }

    function getSqrtZerosPrecompute(uint256 x) private pure returns (uint256) {
        // we only need up to a 100 million, which is 1e26
        // return 10; 

        unchecked {

            // Alternative way, cheaper for x > 1e6
            // if (x >= 1e24) { // 8 + 18
            //     return 1000;
            // }

            // if (x >= 1e22) { // 4 + 18
            //     return 100;
            // } else {
            //     return 10;
            // }

            if (x >= 1e22) { // 4 + 18
                if (x >= 1e24) { // 6 + 18
                    return 1000;
                } else {
                    return 100;
                }
            }
            // } else {
            //     // x is always >= 100 
            //     return 10;
            // }

            // x is always >= 100 
            return 10;
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

        result = expPositive(x);

        endGas = gasleft();

        return startGas - endGas;
    }

    function lnMeasureGas(uint256 x) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = lnUpper(x);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    function sqrtMeasureGas(uint256 x) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = sqrtUpper(x);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    function stdNormCDFMeasureGas(int256 x) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = stdNormCDF(x);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    function getCallOptionPriceMeasureGas(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint16 rate
    ) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    // function _abs(int x) internal pure returns (uint result) {
    //     unchecked {
    //         result = uint(x < 0 ? -x : x);
    //     }
    // }
}
