// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title DeFiMath: High-precision Math Library for Solidity
/// @author DeFiMath
/// @notice Provides optimized implementations of mathematical functions such as exp, ln, sqrt, erf, and standard normal CDF.
/// @dev All functions use fixed-point arithmetic with 18 decimals (1e18) and are optimized for gas efficiency.
library DeFiMath {

    // errors
    /// @notice Thrown when input to exp() exceeds the upper bound (~135)
    error ExpUpperBoundError();

    /// @notice Thrown when input to ln() is zero
    error LnLowerBoundError();

    /// @notice Thrown when input to sqrt() exceeds the upper bound (~2^80)
    error SqrtUpperBoundError();

    /// @notice Computes exp(x) for signed input x
    /// @dev Automatically handles negative inputs via reciprocal logic
    /// @param x Signed input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function exp(int256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x >= 0) {
                // positive
                uint256 absX = uint256(x);                         // since x is positive, absX = x

                if (absX >= 135305999368893231589) revert ExpUpperBoundError();

                uint256 k = absX / 693147180559945309;             // find integer k
                absX -= k * 693147180559945309;                    // reduce x to [0, ln(2)]
                absX >>= 8;                                        // reduce x to [0, 0.0027]


                // The function then uses a rational approximation formula to calculate
                // exp(x) in the range [0, 0.0027]. The formula is given by:
                // exp(x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
                uint256 q = (absX - 3e18) * (absX - 3e18) + 3e36;
                absX *= 1e9;
                uint256 p = (3e27 + absX) * (3e27 + absX) + 3e54;

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
            } else {
                // negative
                uint256 absX = uint256(-x);                         // since x is negative, absX = -x

                // check input
                if (absX >= 41446531673892822313) return 0;

                uint256 k = absX / 693147180559945309;             // find integer k
                absX -= k * 693147180559945309;                    // reduce x to [0, ln(2)]
                absX >>= 8;                                        // reduce x to [0, 0.0027]


                // The function then uses a rational approximation formula to calculate
                // exp(x) in the range [0, 0.0027]. The formula is given by:
                // exp(x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
                uint256 q = (absX - 3e18) * (absX - 3e18) + 3e36;
                absX *= 1e9;
                uint256 p = (3e27 + absX) * (3e27 + absX) + 3e54;

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

                /// @solidity memory-safe-assembly
                assembly {
                    y := div(1000000000000000000000000000000000000, y)
                }
            }
        }
    }

    /// @notice Computes ln(x) for a fixed-point input x
    /// @dev Supports inputs both above and below 1, returns result in fixed-point
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Natural logarithm in 18-decimal fixed-point format
    function ln(uint256 x) internal pure returns (int256 y) {
        unchecked {
            if (x >= 1e18) {
                assembly {
                    let xRound := div(x, 1000000000000000000) // convert to 1e0 base

                    let a := shl(7, lt(0xffffffffffffffffffffffffffffffff, xRound))
                    a := or(a, shl(6, lt(0xffffffffffffffff, shr(a, xRound))))
                    a := or(a, shl(5, lt(0xffffffff, shr(a, xRound))))
                    a := or(a, shl(4, lt(0xffff, shr(a, xRound))))
                    a := or(a, shl(3, lt(0xff, shr(a, xRound))))
                    a := xor(a, byte(and(0x1f, shr(shr(a, xRound), 0x8421084210842108cc6318c6db6d54be)),
                        0xf8f9f9faf9fdfafbf9fdfcfdfafbfcfef9fafdfafcfcfbfefafafcfbffffffff))    

                    let bits := sub(255, a)

                    x := shr(bits, x) // reduce range of x to [1, 2]

                    // reduce range of x to [1, 1.414]
                    let multiplier := gt(x, 1414213562373095049)
                    x := mul(x, 1000000000000000000)
                    x := div(x, add(1000000000000000000, mul(gt(multiplier, 0), 414213562373095049)))

                    multiplier := add(multiplier, shl(1, bits))


                    // we use Mercator series for ln(x)
                    // ln(x) = 1 / (2n+1) * ((x - 1) / (x + 1)) ^ (2n + 1)
                    // t = (x - 1) / (x + 1)

                    let t := mul(sub(x, 1000000000000000000), 1000000000000000000)
                    t := div(t, add(x, 1000000000000000000)) // 18
                    let t2 := div(mul(t, t), 1000000000000000000) // 18
                    y := sdiv(t2, 19)                                              // r: 18 -> 18

                    y := mul(t2, add(58823529411765000, y))   
                    y := mul(t2, add(66666666666666667000000000000000000, y))                       // r: 18 -> 36 
                    y := mul(t2, add(76923076923077000000000000000000000000000000000000000, y)) // r: 36 -> 54
                    y := sdiv(y, 1000000000000000000000000000000000000000000000000000000)
                    
                    y := mul(t2, add(90909090909091000, y)) // 18
                    y := mul(t2, add(111111111111111111000000000000000000, y)) // 36
                    y := mul(t2, add(142857142857143000000000000000000000000000000000000000, y)) // 54
                    y := sdiv(y, 1000000000000000000000000000000000000000000000000000000)

                    y := mul(t2, add(200000000000000000, y)) // 18
                    y := mul(t2, add(333333333333333333000000000000000000, y)) // 36
                    y := mul(t, add(1000000000000000000000000000000000000000000000000000000, y))
                    y := sdiv(y, 500000000000000000000000000000000000000000000000000000)

                    y := add(y, mul(multiplier, 346573590279972655))
                }
            } else {
                if (x == 0) revert LnLowerBoundError();

                assembly {
                    x := div(1000000000000000000000000000000000000, x)

                    let xRound := div(x, 1000000000000000000) // convert to 1e0 base

                    let a := shl(5, lt(0xffffffff, xRound))
                    a := or(a, shl(4, lt(0xffff, shr(a, xRound))))
                    a := or(a, shl(3, lt(0xff, shr(a, xRound))))
                    a := xor(a, byte(and(0x1f, shr(shr(a, xRound), 0x8421084210842108cc6318c6db6d54be)),
                        0xf8f9f9faf9fdfafbf9fdfcfdfafbfcfef9fafdfafcfcfbfefafafcfbffffffff))    

                    let bits := sub(255, a)
                    x := shr(bits, x) // reduce range of x to [1, 2]

                    // reduce range of x to [1, 1.414]
                    let multiplier := gt(x, 1414213562373095049)
                    x := mul(x, 1000000000000000000)
                    x := div(x, add(1000000000000000000, mul(gt(multiplier, 0), 414213562373095049)))

                    multiplier := add(multiplier, shl(1, bits))


                    // we use Mercator series for ln(x)
                    // ln(x) = 1 / (2n+1) * ((x - 1) / (x + 1)) ^ (2n + 1)
                    // t = (x - 1) / (x + 1)

                    let t := mul(sub(x, 1000000000000000000), 1000000000000000000)
                    t := div(t, add(x, 1000000000000000000)) // 18
                    let t2 := div(mul(t, t), 1000000000000000000) // 18
                    y := sdiv(t2, 19)                                              // r: 18 -> 18

                    y := mul(t2, add(58823529411765000, y))   
                    y := mul(t2, add(66666666666666667000000000000000000, y))                       // r: 18 -> 36 
                    y := mul(t2, add(76923076923077000000000000000000000000000000000000000, y)) // r: 36 -> 54
                    y := sdiv(y, 1000000000000000000000000000000000000000000000000000000)
                    
                    y := mul(t2, add(90909090909091000, y)) // 18
                    y := mul(t2, add(111111111111111111000000000000000000, y)) // 36
                    y := mul(t2, add(142857142857143000000000000000000000000000000000000000, y)) // 54
                    y := sdiv(y, 1000000000000000000000000000000000000000000000000000000)

                    y := mul(t2, add(200000000000000000, y)) // 18
                    y := mul(t2, add(333333333333333333000000000000000000, y)) // 36
                    y := mul(t, add(1000000000000000000000000000000000000000000000000000000, y))
                    y := sdiv(y, 500000000000000000000000000000000000000000000000000000)

                    y := sub(sub(0, y), mul(multiplier, 346573590279972655))
                }
            }   
        }
    }

    /// @notice Computes log base 2 of x
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function log2(uint256 x) internal pure returns (int256 y) {
        unchecked {
            // todo: inline
            y = ln(x) * 1e18 / 693147180559945309;
        }
    }

    /// @notice Computes log base 10 of x
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function log10(uint256 x) internal pure returns (int256 y) {
        unchecked {
            // todo: inline
            y = ln(x) * 1e18 / 2302585092994045684;
        }
    }

    /// @notice Computes sqrt(x) using Newton's method
    /// @dev Works for both x >= 1e18 and x < 1e18 via inversion trick
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Square root in 18-decimal fixed-point format
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x >= 1e18) {
                // check input
                if (x >= 1.208925819614629e42) revert SqrtUpperBoundError(); // up to 2^80

                /// @solidity memory-safe-assembly
                assembly {
                    // x to 1e36 base, and y to best guess
                    x := mul(x, 1000000000000000000) // convert to 1e36 base
                    y := 32000000000000000000 // starting point is 32

                    // we want to keep y = sqrt(x) at max 32 times from actual sqrt(x)
                    let multi := div(x, 1048576000000000000000000000000000000000000)
                    multi := add(iszero(multi), multi)  // multi is min 1
                    y := mul(y, multi)                      // up to 2^40  // add 64 - handles when x is 0
                    y := add(y, 64)

                    y := shr(mul(10, gt(multi, 1048576)), y)             // up to 2^60
                    y := shr(mul(10, gt(multi, 1099511627776)), y)       // up to 2^80

                    // 9x Newton method
                    y := shr(1, add(y, div(x, y))) // after this step, we know y > sqrt(x)
                    y := shr(2, add(y, div(x, y))) // so we divide by 4 to speed up convergence (sometimes slow down)
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                }
            } else {
                if (x == 0) return 0;

                /// @solidity memory-safe-assembly
                assembly {
                    // x to 1e36 base, and y to best guess
                    x := div(1000000000000000000000000000000000000000000000000000000, x)
                    y := 32000000000000000000 // starting point is 32

                    // we want to keep y = sqrt(x) at max 32 times from actual sqrt(x)
                    let multi := div(x, 1048576000000000000000000000000000000000000)
                    multi := add(iszero(multi), multi)  // multi is min 1
                    y := mul(y, multi)                      // up to 2^40  // add 64 - handles when x is 0
                    y := add(y, 64)

                    y := shr(mul(10, gt(multi, 1048576)), y)             // up to 2^60

                    // 9x Newton method
                    y := shr(1, add(y, div(x, y))) // after this step, we know y > sqrt(x)
                    y := shr(2, add(y, div(x, y))) // so we divide by 4 to speed up convergence (sometimes slow down)
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))

                    // invert y
                    y := div(1000000000000000000000000000000000000, y)
                }
            }
        }
    }

    /// @notice Computes standard normal cumulative distribution function Φ(x)
    /// @dev Uses erf(x) internally, capped at ±16.447 to return 0 or 1
    /// @param x Input value in 18-decimal fixed-point format
    /// @return y Result in range [0, 1e18]
    function stdNormCDF(int256 x) internal pure returns (uint256 y) {
        unchecked {
            // todo: make sure erf(x) is < 1
            if (x >= 0) {
                if (x >= 16.447e18) {
                    return 1e18;
                }
                // todo: inline
                uint256 absX = uint256(x * 707106781186547524 / 1e18);
                y = 5e17 + erfPositiveHalf(absX);
            } else {
                if (x <= -16.447e18) {
                    return 0;
                }
                // todo: inline
                uint256 absX = uint256(-x * 707106781186547524 / 1e18);
                y = 5e17 - erfPositiveHalf(absX);
            }
        }
    }

    /// @notice Computes the error function erf(x)
    /// @param x Input value in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format, in range [-1e18, 1e18]
    function erf(int256 x) internal pure returns (int256 y) {
        unchecked {
            if (x >= 0) {
                if (x >= 11.63e18) {
                    return 1e18;
                }

                uint256 absX = uint256(x);                         // since x is positive, absX = x

                uint256 t = absX * 1414213562373095049 / 1e18;
                uint256 t2 = t * t / 1e18;
                uint256 t3 = t2 * t / 1e18;
                uint256 t4 = t3 * t / 1e18;

                uint256 num = (35262496599891100 * t4 + 700383064443688000 * t3 + 6373962203531650000 * t2) / 1e18 * t2 + 33912866078383000000 * t3 + 112079291497871000000 * t2 + 221213596169931000000 * t + 220206867912376000000e18; 
                uint256 denom = (88388347648318400 * t4 + 1755667163182640000 * t3 + 16064177579207000000 * t2 + 86780732202946100000 * t) / 1e18 * t3  + 296564248779674000000 * t3 + 637333633378831000000 * t2 + 793826512519948000000 * t + 440413735824752000000e18;

                uint256 expRes = expPositive(t2 >> 1);

                // NOTE: denom and expRes can never be 0
                assembly {
                    y := div(1000000000000000000000000000000000000, expRes)
                    y := mul(y, num)
                    y := div(y, denom)
                    y := sub(500000000000000000, y)
                    y := shl(1, y)
                }
            } else {
                if (x <= -11.63e18) {
                    return -1e18;
                }

                uint256 absX = uint256(-x);                         // since x is negative, absX = -x
                
                uint256 t = absX * 1414213562373095049 / 1e18;
                uint256 t2 = t * t / 1e18;
                uint256 t3 = t2 * t / 1e18;
                uint256 t4 = t3 * t / 1e18;

                uint256 num = (35262496599891100 * t4 + 700383064443688000 * t3 + 6373962203531650000 * t2) / 1e18 * t2 + 33912866078383000000 * t3 + 112079291497871000000 * t2 + 221213596169931000000 * t + 220206867912376000000e18; 
                uint256 denom = (88388347648318400 * t4 + 1755667163182640000 * t3 + 16064177579207000000 * t2 + 86780732202946100000 * t) / 1e18 * t3  + 296564248779674000000 * t3 + 637333633378831000000 * t2 + 793826512519948000000 * t + 440413735824752000000e18;

                uint256 expRes = expPositive(t2 >> 1);

                // NOTE: denom and expRes can never be 0
                assembly {
                    y := div(1000000000000000000000000000000000000, expRes)
                    y := mul(y, num)
                    y := div(y, denom)
                    y := sub(500000000000000000, y)
                    y := shl(1, y)
                    y := sub(0, y)
                }
            }
        }
    }

    /// @notice Computes exp(x) for a positive fixed-point input x in range [0, ~135]
    /// @dev Uses range reduction and rational approximation for gas efficiency
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function expPositive(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            // WARNING: this function doesn't check input parameter x, and should 
            // not be called directly if x is not in the range [0, 135]. This
            // function is used only for internal calculations.

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
            y = y * y * y * y / 1e54;                       // y ^ 4 
            y = y * y * y * y / 1e54;                       // y ^ 16
            y = y * y * y * y / 1e54;                       // y ^ 64
            y = y * y * y * y / 1e54;                       // y ^ 256
            y <<= k;                                        // multiply y by 2 ** k
        }
    }

    /// @notice Computes ln(x) for x in [1/16, 16] using rational approximation
    /// @dev Reduces range using precomputed logarithm multipliers
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function ln16(uint256 x) internal pure returns (int256 y) {
        unchecked {
            if (x >= 1e18) {
                uint256 multiplier;

                // reduce range of x to [1.0905, 16)
                if (x >= 1090507732665257659) {
                    uint256 divider;
                    (divider, multiplier) = getLnPrecompute(x);
                    x *= 1e18;
                    /// @solidity memory-safe-assembly
                    assembly {
                        x := div(x, divider)
                    }
                }

                uint256 t = (x - 1e18) * 1e18;
                /// @solidity memory-safe-assembly
                assembly {
                    t := div(t, add(x, 1000000000000000000))
                }
                uint256 t2 = t * t / 1e18;
                uint256 r = t * (1e18 + t2 / 3 + t2 * t2 / 5e18 + t2 * t2 * t2 / 7e36);
                y = int256(r / 5e17 + multiplier * 86643397569993164);
            } else {
                /// @solidity memory-safe-assembly
                assembly {
                    x := div(1000000000000000000000000000000000000, x)
                }
                uint256 multiplier;

                // reduce range of x to [1.0905, 16)
                if (x >= 1090507732665257659) {
                    uint256 divider;
                    (divider, multiplier) = getLnPrecompute(x);
                    x *= 1e18;
                    /// @solidity memory-safe-assembly
                    assembly {
                        x := div(x, divider)
                    }
                }

                uint256 t = (x - 1e18) * 1e18;
                /// @solidity memory-safe-assembly
                assembly {
                    t := div(t, add(x, 1000000000000000000))
                }
                uint256 t2 = t * t / 1e18;
                uint256 r = t * (1e18 + t2 / 3 + t2 * t2 / 5e18 + t2 * t2 * t2 / 7e36);
                y = -int256(r / 5e17 + multiplier * 86643397569993164);
            }   
        }
    }

    /// @notice Computes sqrt(x) with fixed-point precision for time values
    /// @dev Optimized for values up to 8 years
    /// @param x Time value in 18-decimal fixed-point format
    /// @return z Resulting sqrt in 18-decimal fixed-point format
    function sqrtTime(uint256 x) internal pure returns (uint256 z) {
        assembly {
            x := mul(x, 1000000000000000000) // convert to 1e36 base
            z := 1424579477600000 // starting point

            z := shl(mul(7, gt(x, 519469812544000000000000000000000)), z) // up to 8 years

            // 8x Newton method
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
            z := shr(1, add(z, div(x, z)))
        }
    }

    /// @notice Computes erf(x)/2 for positive x using West’s approximation
    /// @dev Used by stdNormCDF and erf
    /// @param x Positive input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function erfPositiveHalf(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            // erf from West's paper - https://s2.smu.edu/~aleskovs/emis/sqc2/accuratecumnorm.pdf 
            uint256 t = x * 1414213562373095049 / 1e18;
            uint256 t2 = t * t / 1e18;
            uint256 t3 = t2 * t / 1e18;
            uint256 t4 = t3 * t / 1e18;

            uint256 num = (35262496599891100 * t4 + 700383064443688000 * t3 + 6373962203531650000 * t2) / 1e18 * t2 + 33912866078383000000 * t3 + 112079291497871000000 * t2 + 221213596169931000000 * t + 220206867912376000000e18; 
            uint256 denom = (88388347648318400 * t4 + 1755667163182640000 * t3 + 16064177579207000000 * t2 + 86780732202946100000 * t) / 1e18 * t3  + 296564248779674000000 * t3 + 637333633378831000000 * t2 + 793826512519948000000 * t + 440413735824752000000e18;

            uint256 expRes = expPositive(t2 >> 1);

            assembly {
                let res := div(1000000000000000000000000000000000000, expRes)
                res := mul(res, num)
                res := div(res, denom)
                y := sub(500000000000000000, res)
            }
        }
    }

    /// @notice Returns a pair (divider, multiplier) used to reduce range of ln(x) calculation
    /// @dev Used internally by ln16
    /// @param exponent Input value
    /// @return divider Value used to scale x down
    /// @return multiplier Logarithmic offset multiplier
    function getLnPrecompute(uint256 exponent) internal pure returns (uint256, uint256) {
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
                            // NOTE: there is no 0
                            return (1_090507732665257659, 1);
                        }
                    }
                }
            } 
        }
    }
}
