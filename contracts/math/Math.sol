// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title DeFiMath: High-precision Math Library for Solidity
/// @author DeFiMath (https://defimath.com)
/// @notice Provides optimized implementations of mathematical functions such as exp, ln, sqrt, erf, and standard normal CDF.
/// @dev All functions use fixed-point arithmetic with 18 decimals (1e18) and are optimized for gas efficiency.
library DeFiMath {

    // limits
    /// @notice Positive-input ceiling for exp — reverts at or above this.
    ///         Chosen at 135 (not the ~135.306 uint256 wrap point) so `int256(exp(x))` in expm1
    ///         stays comfortably below int256.max even after the ~1.2e-14 approx-error headroom
    ///         on top-of-range inputs. exp(135) ≈ 4.3e58 is already astronomically large.
    int256 internal constant EXP_UPPER_BOUND = 135e18;

    /// @notice Lowest x where e^x is still representable in 18-decimal fixed-point.
    ///         Equals −⌊ln(1e18) · 1e18⌋ − 1 — at or below this, exp(x) silently returns 0.
    int256 internal constant EXP_LOWER_BOUND = -41.446531673892822313e18;

    /// @notice Maximum |a| pow() accepts as exponent, in 18-decimal fixed-point.
    ///         pow internally computes `a · ln(x)` inside `unchecked`; at the worst case ln(2^256 − 1) ≈ 1.78e20
    ///         FP, the product would overflow int256 (~5.78e76) for any |a| ≳ 3.25e56. We cap at 1e54 — well
    ///         below the math wrap point (~30× margin) and astronomically larger than any realistic exponent
    ///         (real value 1e36) — so the only callers it ever rejects are pathological ones.
    ///         Typed as uint256 because it bounds the magnitude `abs(a)`, which is unsigned.
    uint256 internal constant MAX_POW_EXPONENT = 1e54;

    /// @notice Saturation magnitude for stdNormCDF — |x| ≥ this returns 0 (negative) or 1 (positive).
    ///         At ±16.447, Φ(x) is within 1e-18 of {0, 1} so the cap costs no observable precision.
    int256 internal constant STD_NORM_CDF_BOUND = 16.447e18;

    /// @notice Saturation magnitude for erf — |x| ≥ this returns ±1.
    ///         At ±11.63, erf(x) is within 1e-18 of ±1 so the cap costs no observable precision.
    int256 internal constant ERF_BOUND = 11.63e18;

    // math constants
    /// @notice ln(2) in 18-decimal fixed-point — used by exp's range reduction (x → x − k·ln 2)
    ///         and by log2 (ln(x) / ln(2)).
    uint256 internal constant LN_2 = 693147180559945309;

    /// @notice ln(10) in 18-decimal fixed-point — used by log10 (ln(x) / ln(10)).
    int256 internal constant LN_10 = 2302585092994045684;

    /// @notice √2 in 18-decimal fixed-point — used by ln's range reduction
    ///         (compares x against √2 to fold into [1, √2]) and by stdNormCDF
    ///         as `t = |x| · √2` change-of-variable for the West approximation.
    uint256 internal constant SQRT_2 = 1414213562373095049;

    // errors
    /// @notice Thrown when input to exp() exceeds the upper bound (~135)
    error ExpUpperBoundError();

    /// @notice Thrown when input to ln() is zero
    error LnLowerBoundError();

    /// @notice Thrown when input to log1p() is at or below -1 (i.e., 1+x ≤ 0)
    error Log1pLowerBoundError();

    /// @notice Thrown when |a| in pow(x, a) exceeds MAX_POW_EXPONENT, where the
    ///         internal `a · ln(x)` multiplication could silently overflow int256.
    error PowExponentOutOfBoundsError();

    /// @notice Thrown when mulDiv() is called with denominator == 0
    error MulDivByZeroError();

    /// @notice Thrown when mulDiv() result would overflow uint256
    error MulDivOverflowError();
    
    /// @notice Thrown when mul() result would overflow uint256
    error MulOverflowError();

    /// @notice Computes the natural exponential of x in 18-decimal fixed-point.
    /// @dev Reverts with ExpUpperBoundError when x >= EXP_UPPER_BOUND (135e18);
    ///      returns 0 when x <= EXP_LOWER_BOUND (~-41.446e18).
    ///      Max relative error: < 3e-14 for any y >= 1e18.
    ///      Max absolute error: < 1e-15 for any y < 1e18.
    /// @param x Signed input in 18-decimal fixed-point format.
    /// @return y Result e^x in 18-decimal fixed-point format.
    function exp(int256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x >= 0) {
                // check input
                if (x >= EXP_UPPER_BOUND) revert ExpUpperBoundError();

                uint256 x_ = uint256(x);

                // The algorithm works in 3 steps:
                // 1) reduce the range of X to [0, ln(2)/64]
                // 2) approximate result in a narrow range
                // 3) recover reduction
                //
                // Two-stage range reduction:
                //   stage 1 — split x = k·ln(2) + r with integer k, r ∈ [0, ln(2)).
                //             Then exp(x) = exp(k·ln(2)) · exp(r) = 2^k · exp(r).
                //   stage 2 — divide r by 64 (right-shift by 6): r' = r/64 ∈ [0, ~0.0108].
                uint256 k = x_ / LN_2;
                x_ -= k * LN_2;
                x_ >>= 6;

                // Next, we use Padé[3/3] approximant using the following formula:
                // exp(x) ≈ (120 + 60x + 12x² + x³) / (120 - 60x + 12x² - x³)
                uint256 x2 = x_ * x_;
                uint256 even = 120e54 + x2 * 12e18;    // 120 + 12x²  (even powers of x)
                uint256 odd  = x_ * (60e36 + x2);      // 60x + x³    (odd powers of x)
                uint256 p = (even + odd) * 1e18;       // numerator:   120 + 60x + 12x² + x³
                uint256 q = even - odd;                // denominator: 120 − 60x + 12x² − x³

                assembly ("memory-safe") {
                    y := div(p, q)
                }

                // Finally, undo both reductions in reverse order:
                //   stage 2 — raise y to the 64th power to recover exp(r) from exp(r/64).
                //   stage 1 — left-shift by k to multiply by 2^k and undo the ln(2) factoring.
                y = y * y;
                y = y * y / 1e54;
                y = y * y;
                y = y * y / 1e54;
                y = y * y;
                y = y * y / 1e54;
                y <<= k;
            } else {
                // check input
                if (x <= EXP_LOWER_BOUND) return 0;

                // Negative branch: exp(x) = 1 / exp(|x|). Runs the same algorithm as the
                // positive branch on x_ = |x|
                uint256 x_ = uint256(-x);

                // range reduction (see positive branch)
                uint256 k = x_ / LN_2;
                x_ -= k * LN_2;
                x_ >>= 6;

                // Padé[3/3] approximant (see positive branch)
                uint256 x2 = x_ * x_;
                uint256 even = 120e54 + x2 * 12e18;    // 120 + 12x²  (even powers of x)
                uint256 odd  = x_ * (60e36 + x2);      // 60x + x³    (odd powers of x)
                uint256 p = (even + odd) * 1e18;       // numerator:   120 + 60x + 12x² + x³
                uint256 q = even - odd;                // denominator: 120 − 60x + 12x² − x³

                assembly ("memory-safe") {
                    y := div(p, q)
                }

                // undo reductions (see positive branch)
                y = y * y;
                y = y * y / 1e54;
                y = y * y;
                y = y * y / 1e54;
                y = y * y;
                y = y * y / 1e54;
                y <<= k;

                // reciprocate: exp(-|x|) = 1 / exp(|x|)
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
            if (abs(x) >= 0.01e18) {
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
                    let multiplier := gt(x, SQRT_2)
                    x := mul(x, 1000000000000000000)
                    x := div(x, add(1000000000000000000, mul(gt(multiplier, 0), 414213562373095049))) // = SQRT_2 − 1e18

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
                    let multiplier := gt(x, SQRT_2)
                    x := mul(x, 1000000000000000000)
                    x := div(x, add(1000000000000000000, mul(gt(multiplier, 0), 414213562373095049))) // = SQRT_2 − 1e18

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
            if (abs(x) >= 0.01e18) {
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
            y = ln(x) * 1e18 / int256(LN_2);
        }
    }

    /// @notice Computes log base 10 of x
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function log10(uint256 x) internal pure returns (int256 y) {
        unchecked {
            y = ln(x) * 1e18 / LN_10;
        }
    }

    /// @notice Computes x^a using the identity x^a = exp(a * ln(x))
    /// @dev Composes ln() and exp(), with a fast path for a = 0
    /// @param x Base in 18-decimal fixed-point format
    /// @param a Exponent in 18-decimal fixed-point format (signed)
    /// @return y Result in 18-decimal fixed-point format
    function pow(uint256 x, int256 a) internal pure returns (uint256 y) {
        unchecked {
            // check input
            if (abs(a) > MAX_POW_EXPONENT) revert PowExponentOutOfBoundsError();

            // handle special case: x^0 = 1
            // (also covers 0^0 = 1 by convention)
            if (a == 0) {
                return 1e18;
            } 

            // compute using identity: x^a = exp(a * ln(x))
            y = exp(a * ln(x) / 1e18);
        }
    }

    /// @notice Computes square root of x in 18-decimal fixed-point. 
    /// @dev Accepts the full uint256 domain, never reverts.
    ///      Max relative error: < 2e-18 for any y >= 1e18.
    ///      Max absolute error: bit-exact for any y < 1e18.
    /// @param x Input in 18-decimal fixed-point format.
    /// @return y Square root in 18-decimal fixed-point format.
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x <= type(uint128).max) {
                assembly ("memory-safe") {
                    // pre-scale x to 1e36 base (because x can be small)
                    x := mul(x, 1000000000000000000)

                    // generate seed y using clz
                    y := shl(shr(1, sub(254, clz(x))), 2)

                    // refine y using 5x Newton's method
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                }
            } else {
                assembly ("memory-safe") {
                    // generate seed y using clz
                    y := shl(shr(1, sub(254, clz(x))), 2)

                    // refine y using 5x Newton's method
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))
                    y := shr(1, add(y, div(x, y)))

                    // post-scale y to 1e18 base
                    y := mul(y, 1000000000)
                }
            }
        }
    }

    /// @notice Computes square root of x in 18-decimal fixed-point for time values.
    /// @dev Silently overflows for large x. Optimized for values up to 32 years
    /// @param x Time in years, in 18-decimal fixed-point format (e.g. 1e18 = 1 year)
    /// @return y Resulting sqrt in 18-decimal fixed-point format (sqrt(years))
    function sqrtTime(uint256 x) internal pure returns (uint256 y) {
        // WARNING: this function doesn't check input parameter x. It is specialized
        // for Black-Scholes option pricing where x (time to expiry, in years) has
        // already been validated by function calling it. Not intended for direct 
        // external use; outside the [1s, 32y] range precision is not guaranteed.
        // Also, it will OVERFLOW if x is large.
        assembly ("memory-safe") {
            // pre-scale x to 1e36 base (because x can be small)
            x := mul(x, 1000000000000000000)

            // generate seed y using clz
            y := shl(shr(1, sub(254, clz(x))), 2)

            // refine y using 5x Newton's method
            y := shr(1, add(y, div(x, y)))
            y := shr(1, add(y, div(x, y)))
            y := shr(1, add(y, div(x, y)))
            y := shr(1, add(y, div(x, y)))
            y := shr(1, add(y, div(x, y)))
        }
    }

    /// @notice Computes cube root of x in 18-decimal fixed-point.
    /// @dev Accepts the full uint256 domain — never reverts.
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Cube root in 18-decimal fixed-point format
    function cbrt(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x <= type(uint128).max) {
                // lower 128 bits of uint256
                assembly ("memory-safe") {
                    // pre-scale x to 1e54 base (because x can be small)
                    x := mul(x, 1000000000000000000000000000000000000)

                    // generate seed using clz: y = 2^(bits/3), within factor ∛2 of cbrt(x)
                    y := shl(div(sub(258, clz(x)), 3), 1)

                    // refine Y using 6x Newton method: y = (2y + x/y²) / 3
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                }
            } else {
                // higher 128 bits of uint256
                assembly ("memory-safe") {
                    // generate seed using clz: y = 2^(bits/3), within factor ∛2 of cbrt(x)
                    y := shl(div(sub(258, clz(x)), 3), 1)

                    // refine Y using 6x Newton method: y = (2y + x/y²) / 3
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                    y := div(add(shl(1, y), div(x, mul(y, y))), 3)

                    // Post-scale y to 1e18 base 
                    y := mul(y, 1000000000000)
                }
            }
        }
    }

    /// @notice Computes a · b / d with full 512-bit intermediate precision (rounds toward zero)
    /// @dev Splits the 512-bit product into [p1, p0] via mulmod trick (Remco Bloemen / Uniswap V3),
    ///      then performs a 512-by-256 division. Reverts on d == 0 or when the quotient overflows uint256.
    /// @param a First multiplicand (raw uint256, no fixed-point scaling assumed)
    /// @param b Second multiplicand
    /// @param d Divisor; must be non-zero and strictly greater than the high 256 bits of (a · b)
    /// @return z Quotient (a · b) / d
    function mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256 z) {
        unchecked {
            // 512-bit multiply [p1 p0] = a * b.
            //   p0 = (a * b) mod 2^256          (truncating mul)
            //   p1 = ((a * b) - p0) >> 256      (high word, via mulmod trick)
            uint256 p0;
            uint256 p1;
            assembly ("memory-safe") {
                let mm := mulmod(a, b, not(0))   // (a*b) mod (2^256 - 1)
                p0 := mul(a, b)
                p1 := sub(sub(mm, p0), lt(mm, p0))
            }

            // Fast path: a * b fits in uint256.
            if (p1 == 0) {
                if (d == 0) revert MulDivByZeroError();
                return p0 / d;
            }

            // Reject d == 0 (caught implicitly below) and quotient overflow.
            if (d <= p1) {
                if (d == 0) revert MulDivByZeroError();
                revert MulDivOverflowError();
            }

            // 512-by-256 division (Remco Bloemen): subtract remainder to make the
            // dividend an exact multiple of d, factor out powers of two, then
            // multiply by d's modular inverse (Newton-Raphson, 6 doublings for 2^256).
            assembly ("memory-safe") {
                let r := mulmod(a, b, d)
                p1 := sub(p1, gt(r, p0))
                p0 := sub(p0, r)
                let twos := and(sub(0, d), d)
                d := div(d, twos)
                p0 := div(p0, twos)
                p0 := or(p0, mul(p1, add(div(sub(0, twos), twos), 1)))
                let inv := xor(2, mul(3, d))                   // mod 2^4
                inv := mul(inv, sub(2, mul(d, inv)))           // mod 2^8
                inv := mul(inv, sub(2, mul(d, inv)))           // mod 2^16
                inv := mul(inv, sub(2, mul(d, inv)))           // mod 2^32
                inv := mul(inv, sub(2, mul(d, inv)))           // mod 2^64
                inv := mul(inv, sub(2, mul(d, inv)))           // mod 2^128
                z := mul(p0, mul(inv, sub(2, mul(d, inv))))    // mod 2^256
            }
        }
    }

    /// @notice Fixed-point multiply (a · b) / 1e18 with full 512-bit intermediate precision (rounds toward zero)
    /// @dev Specialization of mulDiv with denominator hardcoded to 1e18. All denominator-dependent
    ///      constants are precomputed:
    ///        - 1e18 = 2^18 · 5^18, so the trailing factor of 2 is exactly 2^18 (right-shift by 18)
    ///        - reduced denominator = 5^18 = 3814697265625 (odd)
    ///        - precomputed modular inverse of 5^18 mod 2^256 = 0xaccb18165bd6fe31ae1cf318dc5b51eee0e1ba569b88cd74c1773b91fac10669
    ///      Reverts on overflow (a · b / 1e18 ≥ 2^256). Never reverts on a == 0 or b == 0.
    /// @param a First multiplicand (18-decimal fixed-point)
    /// @param b Second multiplicand (18-decimal fixed-point)
    /// @return z (a · b) / 1e18 (18-decimal fixed-point)
    function mul(uint256 a, uint256 b) internal pure returns (uint256 z) {
        unchecked {
            uint256 p0;
            uint256 p1;
            assembly ("memory-safe") {
                let mm := mulmod(a, b, not(0))
                p0 := mul(a, b)
                p1 := sub(sub(mm, p0), lt(mm, p0))
            }

            // Fast path: a · b fits in uint256.
            if (p1 == 0) return p0 / 1e18;

            // Quotient overflow check: 1e18 must be > p1.
            if (p1 >= 1e18) revert MulOverflowError();

            // 512-by-256 division with d = 1e18 baked in.
            assembly ("memory-safe") {
                let r := mulmod(a, b, 1000000000000000000)
                p1 := sub(p1, gt(r, p0))
                p0 := sub(p0, r)
                p0 := shr(18, p0)                                                // divide low word by 2^18
                p0 := or(p0, shl(238, p1))                                       // stitch high word in
                // Multiply by precomputed inverse of 5^18 mod 2^256.
                z := mul(p0, 0xaccb18165bd6fe31ae1cf318dc5b51eee0e1ba569b88cd74c1773b91fac10669)
            }
        }
    }

    /// @notice Returns the smaller of two unsigned values
    /// @dev Branchless: `x XOR ((x XOR y) · lt(y, x))` — 3 opcodes, no jumps.
    /// @param x First value
    /// @param y Second value
    /// @return z min(x, y)
    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            z := xor(x, mul(xor(x, y), lt(y, x)))
        }
    }

    /// @notice Returns the larger of two unsigned values
    /// @dev Branchless: `x XOR ((x XOR y) · gt(y, x))` — 3 opcodes, no jumps.
    /// @param x First value
    /// @param y Second value
    /// @return z max(x, y)
    function max(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            z := xor(x, mul(xor(x, y), gt(y, x)))
        }
    }

    /// @notice Overflow-safe average `(x + y) / 2` (rounds toward zero)
    /// @dev Uses the bit identity `avg(x, y) = (x & y) + ((x ^ y) >> 1)` — never overflows
    ///      even when `x + y > 2^256 - 1`. 4 opcodes: AND, XOR, SHR, ADD.
    /// @param x First value
    /// @param y Second value
    /// @return z floor((x + y) / 2)
    function avg(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            z := add(and(x, y), shr(1, xor(x, y)))
        }
    }

    /// @notice Clamps x into the closed range [lo, hi] (rounds toward the nearer boundary)
    /// @dev Branchless composition of `max(x, lo)` then `min(_, hi)` — 6 opcodes.
    ///      Does not validate `lo ≤ hi`: with `lo > hi` the function always returns `hi`
    ///      (the second min step squashes the result down). Caller should ensure the range is sane.
    /// @param x Value to clamp
    /// @param lo Lower bound (inclusive)
    /// @param hi Upper bound (inclusive)
    /// @return z `lo` if x < lo, `hi` if x > hi, otherwise x
    function clamp(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            z := xor(x, mul(xor(x, lo), lt(x, lo)))   // max(x, lo)
            z := xor(z, mul(xor(z, hi), gt(z, hi)))   // min(_, hi)
        }
    }

    /// @notice Returns the absolute value of x as an unsigned integer
    /// @dev Branchless: arithmetic-shift-right by 255 broadcasts the sign bit into a mask, then
    ///      `(x XOR mask) - mask` flips and increments for negatives (two's complement).
    ///      Total: 1 SAR + 1 XOR + 1 SUB. Handles `type(int256).min` cleanly — returns 2^255.
    /// @param x Signed input
    /// @return z Absolute value
    function abs(int256 x) internal pure returns (uint256 z) {
        assembly ("memory-safe") {
            let mask := sar(255, x)              // 0 if x ≥ 0, all-ones if x < 0
            z := sub(xor(x, mask), mask)
        }
    }

    /// @notice Computes standard normal cumulative distribution function Φ(x)
    /// @dev Inlines West's half-erf approximation directly — see
    ///      https://s2.smu.edu/~aleskovs/emis/sqc2/accuratecumnorm.pdf.
    ///      West parameterizes by t = z · √2; here z = |x| · (1/√2), so t = |x| directly
    ///      (the 1/√2 and √2 conversions cancel — no pre-scaling needed). Caps at ±16.447
    ///      since Φ(x) is within 1e-18 of {0, 1} beyond that.
    /// @param x Input value in 18-decimal fixed-point format
    /// @return y Result in range [0, 1e18]
    function stdNormCDF(int256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x >= 0) {
                if (x >= STD_NORM_CDF_BOUND) {
                    return 1e18;
                }

                uint256 t = uint256(x);                          // since x is positive, t = x

                uint256 t2 = t * t / 1e18;
                uint256 t3 = t2 * t / 1e18;
                uint256 t4 = t3 * t / 1e18;

                uint256 num = (35262496599891100 * t4 + 700383064443688000 * t3 + 6373962203531650000 * t2) / 1e18 * t2 + 33912866078383000000 * t3 + 112079291497871000000 * t2 + 221213596169931000000 * t + 220206867912376000000e18;
                uint256 denom = (88388347648318400 * t4 + 1755667163182640000 * t3 + 16064177579207000000 * t2 + 86780732202946100000 * t) / 1e18 * t3  + 296564248779674000000 * t3 + 637333633378831000000 * t2 + 793826512519948000000 * t + 440413735824752000000e18;

                uint256 expRes = expPositive(t2 >> 1);

                // NOTE: denom and expRes can never be 0
                assembly {
                    let res := div(1000000000000000000000000000000000000, expRes)
                    res := mul(res, num)
                    res := div(res, denom)
                    y := sub(1000000000000000000, res)             // Φ(x) = 1 − res
                }
            } else {
                if (x <= -STD_NORM_CDF_BOUND) {
                    return 0;
                }

                uint256 t = uint256(-x);                         // since x is negative, t = -x

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
                    y := div(y, denom)                              // Φ(x) = res  (symmetric negative branch)
                }
            }
        }
    }

    /// @notice Computes the error function erf(x)
    /// @param x Input value in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format, in range [-1e18, 1e18]
    function erf(int256 x) internal pure returns (int256 y) {
        unchecked {
            if (x >= 0) {
                if (x >= ERF_BOUND) {
                    return 1e18;
                }

                uint256 absX = uint256(x);                         // since x is positive, absX = x

                uint256 t = absX * SQRT_2 / 1e18;
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
                if (x <= -ERF_BOUND) {
                    return -1e18;
                }

                uint256 absX = uint256(-x);                         // since x is negative, absX = -x
                
                uint256 t = absX * SQRT_2 / 1e18;
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

    /// @notice Computes the natural exponential of x in 18-decimal fixed-point (positive input only).
    /// @dev Internal fast path — does NOT validate input; caller must guarantee x < EXP_UPPER_BOUND (135e18).
    ///      Max relative error: < 3e-14 for any y >= 1e18.
    /// @param x Unsigned input in 18-decimal fixed-point format.
    /// @return y Result e^x in 18-decimal fixed-point format.
    function expPositive(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            // WARNING: this function doesn't check input parameter x, and should 
            // not be called directly if x is not in the range [0, 135]. This
            // function is used only for internal calculations.
            //
            // The algorithm works in 3 steps:
            // 1) reduce the range of X to [0, ln(2)/64]
            // 2) approximate result in a narrow range
            // 3) recover reduction
            //
            // Two-stage range reduction:
            //   stage 1 — split x = k·ln(2) + r with integer k, r ∈ [0, ln(2)).
            //             Then exp(x) = exp(k·ln(2)) · exp(r) = 2^k · exp(r).
            //   stage 2 — divide r by 64 (right-shift by 6): r' = r/64 ∈ [0, ~0.0108].
            uint256 k = x / LN_2;
            x -= k * LN_2;
            x >>= 6;

            // Next, we use Padé[3/3] approximant using the following formula:
            // exp(x) ≈ (120 + 60x + 12x² + x³) / (120 - 60x + 12x² - x³)
            uint256 x2 = x * x;
            uint256 even = 120e54 + x2 * 12e18;    // 120 + 12x²  (even powers of x)
            uint256 odd  = x * (60e36 + x2);       // 60x + x³    (odd powers of x)
            uint256 p = (even + odd) * 1e18;       // numerator:   120 + 60x + 12x² + x³
            uint256 q = even - odd;                // denominator: 120 − 60x + 12x² − x³

            assembly ("memory-safe") {
                y := div(p, q)
            }

            // Finally, undo both reductions in reverse order:
            //   stage 2 — raise y to the 64th power to recover exp(r) from exp(r/64).
            //   stage 1 — left-shift by k to multiply by 2^k and undo the ln(2) factoring.
            y = y * y;
            y = y * y / 1e54;
            y = y * y;
            y = y * y / 1e54;
            y = y * y;
            y = y * y / 1e54;
            y <<= k;
        }
    }
}
