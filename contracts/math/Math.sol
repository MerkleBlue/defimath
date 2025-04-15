// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Uncomment this line to use console.log
import "hardhat/console.sol";

/**
 * @title Math library for common math functions like exponential, logarithm, 
 * square root, error function, standard normal distribution, etc..
 * @author DeFiMath
 * @notice This library provides a set of mathematical functions for use in Solidity smart contracts.
 * @dev The functions are designed to be gas-efficient and to avoid overflows and underflows.
 */
library DeFiMath {

    error ExpUpperBoundError();

    // exponential function - 
    function expPositive(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            // WARNING: this function doesn't check input parameter x, and should 
            // not be called directly if x is not in the range [0, 135]. This
            // function is used only for internal calculations, and should be
            // called only from exp(int256) function.

            // How it works: it starts by reducing the range of x from [0, 135] down to
            // [0, ln(2)] by factoring out powers of two using the formula
            // exp(x) = exp(x') * 2 ** k, where k is an integer. k is calculated
            // simply by dividing x by ln(2) and rounding down to the nearest integer.
            // The value of x' is calculated by subtracting k * ln(2) from x.
            // Credit for this method: https://xn--2-umb.com/22/exp-ln/
            // The range is then reduced to [0, 0.0027] by dividing x by 256. 
            uint256 k = x / 693147180559945309;             // find integer k
            x -= k * 693147180559945309;                    // reduce x to [0, ln(2)]
            x >>= 8;                                        // reduce x to [0, 0.0027]


            // The function then uses a rational approximation formula to calculate
            // exp(x) in the range [0, 0.0027]. The formula is given by:
            // exp(x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
            uint256 q = (x - 3e18) * (x - 3e18) + 3e36;
            x *= 1e9;
            uint256 p = (3e27 + x) * (3e27 + x) + 3e54;

            /// @solidity memory-safe-assembly
            assembly {
                y := div(p, q)                              // assembly for gas savings
            }


            // The result is then raised to the power of 256 to account for the
            // earlier division of x by 256. Since y is in [1, exp(0.0027), we can safely 
            // raise to the power of 4 in one expression. Finally, the result is 
            // multiplied by 2 ** k, to account for the earlier factorization of powers of two.
            y = y * y * y * y / 1e54;                       // y ** 4 
            y = y * y * y * y / 1e54;                       // y ** 16
            y = y * y * y * y / 1e54;                       // y ** 64
            y = y * y * y * y / 1e54;                       // y ** 256
            y <<= k;                                        // multiply y by 2 ** k
        }
    }

    function exp(int256 x) internal pure returns (uint256 y) {
        unchecked {
            uint256 absX = (uint256(x) + uint256(x >> 255)) ^ uint256(x >> 255);

            // check input
            if (absX >= 135305999368893231589) revert ExpUpperBoundError(); // todo rename

            // negative
            if (x <= 0) {
                y = expPositive(absX);
                /// @solidity memory-safe-assembly
                assembly {
                    y := div(1000000000000000000000000000000000000, y)
                }
                return y;
            } 

            // positive
            return expPositive(absX);
        }
    }

    function ln(uint256 x) internal pure returns (int256) {
        unchecked {
            if (x >= 1e18) {
                return int256(lnUpper(x));
            }

            return -int256(lnUpper(1e36 / x));
        }
    }

    function log2(uint256 x) internal pure returns (int256) {
        unchecked {
            if (x >= 1e18) {
                return int256(lnUpper(x)) * 1e18 / 693147180559945309;
            }

            return -int256(lnUpper(1e36 / x)) * 1e18 / 693147180559945309;
        }
    }

    function log10(uint256 x) internal pure returns (int256) {
        unchecked {
            if (x >= 1e18) {
                return int256(lnUpper(x)) * 1e18 / 2302585092994045684;
            }

            return -int256(lnUpper(1e36 / x)) * 1e18 / 2302585092994045684;
        }
    }

    function sqrt(uint256 x) internal pure returns (uint256) {
        unchecked {
            if (x >= 1e18) {
                return sqrtUpper(x);
            }

            return 1e36 / sqrtUpper(1e36 / x);
        }
    }

    function expPositive2(uint256 x) internal pure returns (uint256) {
        unchecked {
            uint256 exp123 = 1;

            // x: [32, 50)
            if (x >= 32e18) {
                // console.log(x / 32e18);
                exp123 = 78962960182681; // todo: getExp1Precompute(x / 32e18); // this is always 1 if x < 50
                x %= 32e18;
            }

            // x: [1, 32)
            if (x >= 1e18) {
                exp123 *= getExp2Precompute(x / 1e18);
                x %= 1e18;
            } else {
                exp123 *= 1e15;
            }

            // x: [0.03125, 1)
            if (x >= 3125e13) {
                exp123 *= getExp3Precompute(x / 3125e13);
                x %= 3125e13;
            } else {
                exp123 *= 1e15;
            }

            // if (log) { if (exp1 > 0) { console.log("exp1 SOL: %d", uint256(exp1)); } else { console.log("exp1 SOL: -%d", uint256(-exp1)); }}

            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
            uint256 denominator = ((3e18 - x) * (3e18 - x)) + 3e36;
            x /= 1e6;
            uint256 numerator = ((x + 3e12) * (x + 3e12)) + 3e24;

            return exp123 * numerator / denominator; // using e ^ (a + b) = e ^ a * e ^ b
        }
    }

    function expPositive3(uint256 x) internal pure returns (uint256 r) {
        unchecked {
            // `x` is now in the range `(-42, 136) * 1e18`. Convert to `(-42, 136) * 2**96`
            // for more intermediate precision and a binary basis. This base conversion
            // is a multiplication by 1e18 / 2**96 = 5**18 / 2**78.
            x = (x << 78) / 5 ** 18;

            // Reduce range of x to (-½ ln 2, ½ ln 2) * 2**96 by factoring out powers
            // of two such that exp(x) = exp(x') * 2**k, where k is an integer.
            // Solving this gives k = round(x / log(2)) and x' = x - k * log(2).
            uint256 k = (x << 96) / 54916777467707473351141471128 + 2 ** 95 >> 96;
            x = x - k * 54916777467707473351141471128;

            // `k` is in the range `[-61, 195]`.

            // Evaluate using a (6, 7)-term rational approximation.
            // `p` is made monic, we'll multiply by a scale factor later.
            int256 intX = int256(x);
            int256 y = intX + 1346386616545796478920950773328;
            y = ((y * intX) >> 96) + 57155421227552351082224309758442;
            int256 p = y + intX - 94201549194550492254356042504812;
            p = ((p * y) >> 96) + 28719021644029726153956944680412240;
            p = p * intX + (4385272521454847904659076985693276 << 96);

            // We leave `p` in `2**192` basis so we don't need to scale it back up for the division.
            int256 q = intX - 2855989394907223263936484059900;
            q = ((q * intX) >> 96) + 50020603652535783019961831881945;
            q = ((q * intX) >> 96) - 533845033583426703283633433725380;
            q = ((q * intX) >> 96) + 3604857256930695427073651918091429;
            q = ((q * intX) >> 96) - 14423608567350463180887372962807573;
            q = ((q * intX) >> 96) + 26449188498355588339934803723976023;

            /// @solidity memory-safe-assembly
            assembly {
                // Div in assembly because solidity adds a zero check despite the unchecked.
                // The q polynomial won't have zeros in the domain as all its roots are complex.
                // No scaling is necessary because p is already `2**96` too large.
                r := sdiv(p, q)
            }

            // r should be in the range `(0.09, 0.25) * 2**96`.

            // We now need to multiply r by:
            // - The scale factor `s ≈ 6.031367120`.
            // - The `2**k` factor from the range reduction.
            // - The `1e18 / 2**96` factor for base conversion.
            // We do this all at once, with an intermediate result in `2**213`
            // basis, so the final right shift is always by a positive amount.
            r = (r * 3822833074963236453042738258902158003155416615667 >> uint256(195 - k));
        }
    }

    // x: [1, 16] 
    function lnUpper(uint256 x) internal pure returns (uint256) {
        unchecked {
            uint256 multiplier;

            // x: [1.0905, 16)
            if (x >= 1_090507732665257659) {
                uint256 divider;
                (divider, multiplier) = getLnPrecompute(x); // todo: should we return multiplier, why not value?
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

    // x: [1, 1e8]
    function sqrtUpper(uint256 x) internal pure returns (uint256) {
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
                sqrtPrecompute = getSqrtPrecompute(x);
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

    // using erf function
    function stdNormCDF(int256 x) internal pure returns (uint256) {
        unchecked {
            // todo: make sure erf(x) is < 1
            // int256 erfResult = erf(x * 707106781186547524 / 1e18);
            // if (log) { if (erfResult > 0) { console.log("erfResult SOL: %d", uint256(erfResult)); } else { console.log("erfResult SOL: -%d", uint256(-erfResult)); }}
            int256 argument = x * 707106781186547524 / 1e18;



            if (argument >= 0) {
                if (argument >= 11.63e18) {
                    return 1e18;
                }

                return 5e17 + erfPositiveHalf(uint256(argument));
            } 

            if (argument <= -11.63e18) {
                return 0;
            }
                
            return 5e17 - erfPositiveHalf(uint256(-argument));
        }
    }

    // erf from West's paper - https://s2.smu.edu/~aleskovs/emis/sqc2/accuratecumnorm.pdf 
    // abs error 1e-15, now exp function is bottleneck
    function erfPositiveHalf(uint256 x) internal pure returns (uint256) {
        unchecked {
            uint256 t = x * 1414213562373095049 / 1e18;
            uint256 t2 = t * t / 1e18;
            uint256 t3 = t2 * t / 1e18;
            uint256 t4 = t3 * t / 1e18;

            uint256 num = (35262496599891100 * t4 + 700383064443688000 * t3 + 6373962203531650000 * t2) / 1e18 * t2 + 33912866078383000000 * t3 + 112079291497871000000 * t2 + 221213596169931000000 * t + 220206867912376000000e18; 
            uint256 denom = (88388347648318400 * t4 + 1755667163182640000 * t3 + 16064177579207000000 * t2 + 86780732202946100000 * t) / 1e18 * t3  + 296564248779674000000 * t3 + 637333633378831000000 * t2 + 793826512519948000000 * t + 440413735824752000000e18;

            return 5e17 - 1e36 / expPositive(t2 / 2) * num / denom;
        }

        // let xAbs = Math.abs(x) * Math.SQRT2;
        // let c = 0;
        
        // if (xAbs <= 37) {
        //     let e = this.exp(-xAbs * xAbs / 2);
        //     if (xAbs < 7.07106781186547) {
        //     let num = 0.0352624965998911 * xAbs ** 6 + 0.700383064443688 * xAbs ** 5 + 6.37396220353165 * xAbs ** 4 + 33.912866078383 * xAbs ** 3 + 112.079291497871 * xAbs ** 2 + 221.213596169931 * xAbs + 220.206867912376;
        //     let den = 0.0883883476483184 * xAbs ** 7 + 1.75566716318264 * xAbs ** 6 + 16.064177579207 * xAbs ** 5 + 86.7807322029461 * xAbs ** 4 + 296.564248779674 * xAbs ** 3 + 637.333633378831 * xAbs ** 2 + 793.826512519948 * xAbs + 440.413735824752;
        //     c = e * num / den;
        //     } else {
        //         let b = xAbs + 0.65;
        //         b = xAbs + 4 / b;
        //         b = xAbs + 3 / b;
        //         b = xAbs + 2 / b;
        //         b = xAbs + 1 / b;
        //         c = e / b / 2.506628274631;
        //     }
        // }
        
        // return x > 0 ? 1 - 2 * c : 2 * c - 1;
    }

    // todo: implement erf

    function getExp1Precompute(uint256 exponent) internal pure returns (uint256) {
        unchecked {
            return 78962960182681 ** exponent;
        }
    }

    function getExp2Precompute(uint256 exponent) internal pure returns (uint256) {
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

    function getExp3Precompute(uint256 exponent) internal pure returns (uint256) {
        // base is 1.031743407499102671
        unchecked {
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

    function getLnPrecompute(uint256 exponent) internal pure returns (uint256, uint256) {
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

    function getSqrtPrecompute(uint256 exponent) internal pure returns (uint256) {
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

    function getSqrtZerosPrecompute(uint256 x) internal pure returns (uint256) {
        // we only need up to a 100 million, which is 1e26
        // return 10; 

        unchecked {
            if (x >= 1e22) { // 4 + 18
                if (x >= 1e24) { // 6 + 18
                    return 1000;
                } else {
                    return 100;
                }
            }
            // x is always >= 100 
            return 10;
        }
    }
}
