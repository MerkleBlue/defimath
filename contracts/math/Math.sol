// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title DeFiMath: High-precision Math Library for Solidity
/// @author DeFiMath (https://defimath.com)
/// @notice Provides optimized implementations of mathematical functions such as exp, ln, sqrt, erf, and standard normal CDF.
/// @dev All functions use fixed-point arithmetic with 18 decimals (1e18) and are optimized for gas efficiency.
library DeFiMath {

    // errors
    /// @notice Thrown when input to exp() exceeds the upper bound (~135)
    error ExpUpperBoundError();

    /// @notice Thrown when input to ln() is zero
    error LnLowerBoundError();

    /// @notice Thrown when input to log1p() is at or below -1 (i.e., 1+x ≤ 0)
    error Log1pLowerBoundError();

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

                assembly ("memory-safe") {
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

                assembly ("memory-safe") {
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

                assembly ("memory-safe") {
                    y := div(1000000000000000000000000000000000000, y)
                }
            }
        }
    }

    /// @notice Computes exp(x) - 1 with high precision for small |x|
    /// @dev Uses a Taylor series for |x| < 0.01 to avoid precision loss when subtracting two near-equal numbers
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format (signed)
    function expm1(int256 x) internal pure returns (int256 y) {
        unchecked {
            // For |x| >= 0.01, naive exp(x) - 1 has sufficient precision
            if (x >= 0.01e18 || x <= -0.01e18) {
                return int256(exp(x)) - 1e18;
            }
            // Taylor series x + x²/2! + ... + x¹⁰/10! gives ~1e-29 truncation at |x|=0.01
            int256 x2 = x * x / 1e18;
            int256 x3 = x2 * x / 1e18;
            int256 x4 = x3 * x / 1e18;
            int256 x5 = x4 * x / 1e18;
            int256 x6 = x5 * x / 1e18;
            int256 x7 = x6 * x / 1e18;
            int256 x8 = x7 * x / 1e18;
            int256 x9 = x8 * x / 1e18;
            int256 x10 = x9 * x / 1e18;
            y = x + x2 / 2 + x3 / 6 + x4 / 24 + x5 / 120
                + x6 / 720 + x7 / 5040 + x8 / 40320 + x9 / 362880 + x10 / 3628800;
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
                    let bits := sub(255, clz(xRound))         // floor(log2(xRound))

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
                    let bits := sub(255, clz(xRound))         // floor(log2(xRound))

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

    /// @notice Computes ln(1 + x) with high precision for small |x|
    /// @dev Uses a Taylor series for |x| < 0.01 to avoid precision loss when forming 1 + x for tiny x
    /// @param x Input in 18-decimal fixed-point format. Must satisfy x > -1e18 (i.e., 1+x > 0)
    /// @return y Result in 18-decimal fixed-point format (signed)
    function log1p(int256 x) internal pure returns (int256 y) {
        if (x <= -1e18) revert Log1pLowerBoundError();
        unchecked {
            // For |x| >= 0.01, naive ln(1 + x) has sufficient precision
            if (x >= 0.01e18 || x <= -0.01e18) {
                return ln(uint256(int256(1e18) + x));
            }
            // Taylor series x - x²/2 + x³/3 - ... + x¹⁰/10 (alternating) gives ~1e-21 truncation at |x|=0.01
            int256 x2 = x * x / 1e18;
            int256 x3 = x2 * x / 1e18;
            int256 x4 = x3 * x / 1e18;
            int256 x5 = x4 * x / 1e18;
            int256 x6 = x5 * x / 1e18;
            int256 x7 = x6 * x / 1e18;
            int256 x8 = x7 * x / 1e18;
            int256 x9 = x8 * x / 1e18;
            int256 x10 = x9 * x / 1e18;
            y = x - x2 / 2 + x3 / 3 - x4 / 4 + x5 / 5
                - x6 / 6 + x7 / 7 - x8 / 8 + x9 / 9 - x10 / 10;
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

    /// @notice Computes x^a using the identity x^a = exp(a * ln(x))
    /// @dev Composes ln() and exp(), with a fast path for a = 0
    /// @param x Base in 18-decimal fixed-point format
    /// @param a Exponent in 18-decimal fixed-point format (signed)
    /// @return y Result in 18-decimal fixed-point format
    function pow(uint256 x, int256 a) internal pure returns (uint256 y) {
        unchecked {
            if (a == 0) return 1e18;                    // x^0 = 1 (also covers 0^0 = 1 by convention)
            y = exp(a * ln(x) / 1e18);
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

                assembly ("memory-safe") {
                    x := mul(x, 1000000000000000000) // convert to 1e36 base

                    // CLZ-derived initial guess: y = 2^ceil(bits/2), within factor √2 of sqrt(x)
                    y := shl(shr(1, sub(256, clz(x))), 1)

                    // 6x Newton method (sufficient for bit-exact from factor-√2 start)
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                }
            } else {
                if (x == 0) return 0;

                assembly ("memory-safe") {
                    x := div(1000000000000000000000000000000000000000000000000000000, x)

                    // CLZ-derived initial guess: y = 2^ceil(bits/2), within factor √2 of sqrt(x)
                    y := shl(shr(1, sub(256, clz(x))), 1)

                    // 6x Newton method
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

            assembly ("memory-safe") {
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

    /// @notice Computes sqrt(x) with fixed-point precision for time values
    /// @dev Optimized for values up to 8 years
    /// @param x Time value in 18-decimal fixed-point format
    /// @return z Resulting sqrt in 18-decimal fixed-point format
    function sqrtTime(uint256 x) internal pure returns (uint256 z) {
        assembly {
            x := mul(x, 1000000000000000000) // convert to 1e36 base

            // CLZ-derived initial guess: z = 2^ceil(bits/2), within factor √2 of sqrt(x)
            z := shl(shr(1, sub(256, clz(x))), 1)

            // 6x Newton method
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

}
