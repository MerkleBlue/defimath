// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title DeFiMath: High-precision Math Library for Solidity
/// @author DeFiMath (https://defimath.com)
/// @notice Provides optimized implementations of mathematical functions such as exp, ln, sqrt, erf, and standard normal CDF.
/// @dev All functions use fixed-point arithmetic with 18 decimals (1e18) and are optimized for gas efficiency.
library DeFiMath {

    // limits
    /// @notice Largest x where exp(x) still fits in uint256 fixed-point — exp reverts at or above this.
    ///         Equals ⌊ln(2^256 / 1e18) · 1e18⌋ + 1 = floor(ln(2^256) · 1e18) at the wrap point.
    uint256 internal constant EXP_UPPER_BOUND = 135.305999368893231589e18;

    /// @notice Lowest x where e^x is still representable in 18-decimal fixed-point.
    ///         Equals −⌊ln(1e18) · 1e18⌋ − 1 — at or below this, exp(x) silently returns 0.
    int256 internal constant EXP_LOWER_BOUND = -41.446531673892822313e18;

    /// @notice Largest sqrt input that doesn't overflow during the FP18 scaling step (`x · 1e18`).
    ///         Equals ⌊(2^256 − 1) / 1e18⌋ + 1 — i.e. the smallest input for which `x · 1e18` overflows uint256.
    uint256 internal constant SQRT_UPPER_BOUND = type(uint256).max / 1e18 + 1;

    /// @notice Largest cbrt input that keeps the cubed output under 2^228 (and the answer under 2^26 in FP).
    ///         Equals 2^76 in fixed-point (= 2^76 · 1e18).
    uint256 internal constant CBRT_UPPER_BOUND = 7.5557863725914323e40;

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

    /// @notice Thrown when input to sqrt() exceeds the upper bound at which the FP18 scaling step (`x · 1e18`) would overflow uint256.
    error SqrtUpperBoundError();

    /// @notice Thrown when input to cbrt() exceeds the upper bound (~2^76)
    error CbrtUpperBoundError();

    /// @notice Thrown when mulDiv() is called with denominator == 0
    error MulDivByZeroError();

    /// @notice Thrown when mulDiv() result would overflow uint256
    error MulDivOverflowError();
    
    /// @notice Thrown when mul() result would overflow uint256
    error MulOverflowError();

    /// @notice Computes exp(x) for signed input x
    /// @dev Automatically handles negative inputs via reciprocal logic
    /// @param x Signed input in 18-decimal fixed-point format
    /// @return y Result in 18-decimal fixed-point format
    function exp(int256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x >= 0) {
                // positive
                uint256 absX = uint256(x);                         // since x is positive, absX = x

                if (absX >= EXP_UPPER_BOUND) revert ExpUpperBoundError();

                uint256 k = absX / LN_2;             // find integer k
                absX -= k * LN_2;                    // reduce x to [0, ln(2)]
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
                // negative — check input first, then compute absX for the math
                if (x <= EXP_LOWER_BOUND) return 0;
                uint256 absX = uint256(-x);

                uint256 k = absX / LN_2;             // find integer k
                absX -= k * LN_2;                    // reduce x to [0, ln(2)]
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
                if (x >= SQRT_UPPER_BOUND) revert SqrtUpperBoundError();

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

    /// @notice Computes cbrt(x) using Newton's method
    /// @dev Single-branch: result = integer_cbrt(x · 1e36), exact at the 1e18-FP scale
    /// @param x Input in 18-decimal fixed-point format
    /// @return y Cube root in 18-decimal fixed-point format
    function cbrt(uint256 x) internal pure returns (uint256 y) {
        unchecked {
            if (x == 0) return 0;
            if (x >= CBRT_UPPER_BOUND) revert CbrtUpperBoundError(); // up to 2^76

            assembly ("memory-safe") {
                x := mul(x, 1000000000000000000000000000000000000) // shift to 1e54 base

                // CLZ-derived initial guess: y = 2^ceil(bits/3), within factor ∛2 of cbrt(x)
                y := shl(div(add(sub(256, clz(x)), 2), 3), 1)

                // 6x Newton method: y = (2y + x/y²) / 3
                y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                y := div(add(shl(1, y), div(x, mul(y, y))), 3)
                y := div(add(shl(1, y), div(x, mul(y, y))), 3)
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
            uint256 k = x / LN_2;             // find integer k
            x -= k * LN_2;                    // reduce x to [0, ln(2)]
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
    /// @dev Optimized for values up to 32 years
    /// @param x Time in years, in 18-decimal fixed-point format (e.g. 1e18 = 1 year)
    /// @return z Resulting sqrt in 18-decimal fixed-point format (sqrt(years))
    function sqrtTime(uint256 x) internal pure returns (uint256 z) {
        // WARNING: this function doesn't check input parameter x. It is specialized
        // for Black-Scholes option pricing where x (time to expiry, in years) has
        // already been validated by the caller. Not intended for direct external use;
        // outside the [1s, 32y] range precision is not guaranteed.
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
}
