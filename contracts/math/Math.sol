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
    error SqrtUpperBoundError();
    error SqrtLowerBoundError();

    // exponential function - 
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
                // p := mul(p, 1000000000000000000)
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

    function ln(uint256 x) internal pure returns (int256 y) {
        unchecked {
            if (x >= 1e18) {
                assembly {
                    let xRound := div(x, 1000000000000000000) // convert to 1e0 base

                    // a := shl(7, lt(0xffffffffffffffffffffffffffffffff, x))
                    let a := shl(6, lt(0xffffffffffffffff, xRound))
                    a := or(a, shl(5, lt(0xffffffff, shr(a, xRound))))
                    a := or(a, shl(4, lt(0xffff, shr(a, xRound))))
                    a := or(a, shl(3, lt(0xff, shr(a, xRound))))
                    // forgefmt: disable-next-item
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
                assembly {
                    x := div(1000000000000000000000000000000000000, x)

                                        let xRound := div(x, 1000000000000000000) // convert to 1e0 base

                    // a := shl(7, lt(0xffffffffffffffffffffffffffffffff, x))
                    let a := shl(6, lt(0xffffffffffffffff, xRound))
                    a := or(a, shl(5, lt(0xffffffff, shr(a, xRound))))
                    a := or(a, shl(4, lt(0xffff, shr(a, xRound))))
                    a := or(a, shl(3, lt(0xff, shr(a, xRound))))
                    // forgefmt: disable-next-item
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

                return -y;
            }

            
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

    // x: [1, 2^80]
    function sqrtUpper2(uint256 x) internal pure returns (uint256 y) {
        assembly {
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
    }

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

    function sqrtTime(uint256 x) internal pure returns (uint256 z) {
        unchecked {
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
    }

    function lnUpper2(uint256 x) internal pure returns (int256 y) {
        unchecked {
            assembly {

                    let xRound := div(x, 1000000000000000000) // convert to 1e0 base

                    // a := shl(7, lt(0xffffffffffffffffffffffffffffffff, x))
                    let a := shl(6, lt(0xffffffffffffffff, xRound))
                    a := or(a, shl(5, lt(0xffffffff, shr(a, xRound))))
                    a := or(a, shl(4, lt(0xffff, shr(a, xRound))))
                    a := or(a, shl(3, lt(0xff, shr(a, xRound))))
                    // forgefmt: disable-next-item
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
        }
    }

    function lnWad(int256 x) internal pure returns (int256 r) {
        /// @solidity memory-safe-assembly
        assembly {
            // We want to convert `x` from `10**18` fixed point to `2**96` fixed point.
            // We do this by multiplying by `2**96 / 10**18`. But since
            // `ln(x * C) = ln(x) + ln(C)`, we can simply do nothing here
            // and add `ln(2**96 / 10**18)` at the end.

            // Compute `k = log2(x) - 96`, `r = 159 - k = 255 - log2(x) = 255 ^ log2(x)`.
            // r := 195
            r := shl(7, lt(0xffffffffffffffffffffffffffffffff, x)) // 128 bits
            r := or(r, shl(6, lt(0xffffffffffffffff, shr(r, x)))) // 64 bits
            r := or(r, shl(5, lt(0xffffffff, shr(r, x)))) // 32 bits
            r := or(r, shl(4, lt(0xffff, shr(r, x)))) // 16 bits
            r := or(r, shl(3, lt(0xff, shr(r, x))))     // 8 bits
            // We place the check here for more optimal stack operations.
            if iszero(sgt(x, 0)) { // 26 gas
                mstore(0x00, 0x1615e638) // `LnWadUndefined()`.
                revert(0x1c, 0x04)
            }
            // forgefmt: disable-next-item
            r := xor(r, byte(and(0x1f, shr(shr(r, x), 0x8421084210842108cc6318c6db6d54be)),
                0xf8f9f9faf9fdfafbf9fdfcfdfafbfcfef9fafdfafcfcfbfefafafcfbffffffff))

            // // Reduce range of x to (1, 2) * 2**96
            // // ln(2^k * x) = k * ln(2) + ln(x)
            x := shr(159, shl(r, x))

            // Evaluate using a (8, 8)-term rational approximation.
            // `p` is made monic, we will multiply by a scale factor later.
            // forgefmt: disable-next-item
            let p := sub( // This heavily nested expression is to avoid stack-too-deep for via-ir.
                sar(96, mul(add(43456485725739037958740375743393,
                sar(96, mul(add(24828157081833163892658089445524,
                sar(96, mul(add(3273285459638523848632254066296,
                    x), x))), x))), x)), 11111509109440967052023855526967)
            p := sub(sar(96, mul(p, x)), 45023709667254063763336534515857)
            p := sub(sar(96, mul(p, x)), 14706773417378608786704636184526)
            p := sub(mul(p, x), shl(96, 795164235651350426258249787498))
            // We leave `p` in `2**192` basis so we don't need to scale it back up for the division.

            // `q` is monic by convention.
            let q := add(5573035233440673466300451813936, x)
            q := add(71694874799317883764090561454958, sar(96, mul(x, q)))
            q := add(283447036172924575727196451306956, sar(96, mul(x, q)))
            q := add(401686690394027663651624208769553, sar(96, mul(x, q)))
            q := add(204048457590392012362485061816622, sar(96, mul(x, q)))
            q := add(31853899698501571402653359427138, sar(96, mul(x, q)))
            q := add(909429971244387300277376558375, sar(96, mul(x, q)))

            // `p / q` is in the range `(0, 0.125) * 2**96`.

            // Finalization, we need to:
            // - Multiply by the scale factor `s = 5.549…`.
            // - Add `ln(2**96 / 10**18)`.
            // - Add `k * ln(2)`.
            // - Multiply by `10**18 / 2**96 = 5**18 >> 78`.

            // The q polynomial is known not to have zeros in the domain.
            // No scaling required because p is already `2**96` too large.
            p := sdiv(p, q)
            // Multiply by the scaling factor: `s * 5**18 * 2**96`, base is now `5**18 * 2**192`.
            p := mul(1677202110996718588342820967067443963516166, p)
            // Add `ln(2) * k * 5**18 * 2**192`.
            // forgefmt: disable-next-item
            p := add(mul(16597577552685614221487285958193947469193820559219878177908093499208371, sub(159, r)), p)
            // Add `ln(2**96 / 10**18) * 5**18 * 2**192`.
            p := add(600920179829731861736702779321621459595472258049074101567377883020018308, p)
            // Base conversion: mul `2**18 / 2**192`.
            r := sar(174, p)
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

            return 5e17 - 1e36 / expPositive(t2 >> 1) * num / denom;
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
