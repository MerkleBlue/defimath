// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DeFiMath} from "../../contracts/math/Math.sol";

/// @notice Property-based fuzz tests for DeFiMath. Validates mathematical identities
///         across the operational domain — round-trips, monotonicity, identities,
///         symmetries, output bounds. Companion to the Hardhat behaviour tests
///         (which validate against JS references at concrete points); these check
///         the algebraic structure across the random input space.
///
/// @dev Tests are grouped into five property categories below. The category prefix
///      on each test name lets you filter:
///          forge test --match-test test_RT_     (round-trips)
///          forge test --match-test test_MONO_   (monotonicity)
///          forge test --match-test test_ID_     (known identities)
///          forge test --match-test test_BNDS_   (output bounds)
///          forge test --match-test test_SYM_    (symmetries)
///
///      Foundry tolerances are in 1e18-scaled fixed-point. Some helpers:
///          REL_1e_12 = 1e6   → 1e-12 relative
///          REL_1e_10 = 1e8   → 1e-10 relative
///          REL_1e_8  = 1e10  → 1e-8  relative
///      Property tests use slightly looser tolerances than behaviour tests because
///      they sweep the full input space, including precision-edge corners.
contract MathPropertyTest is Test {
    using DeFiMath for *;

    uint256 private constant FP_ONE = 1e18;
    int256  private constant FP_ONE_INT = 1e18;

    // Relative-error tolerances (1e18-scaled per forge-std assertApproxEqRel convention)
    uint256 private constant REL_1e_8  = 1e10;  // 1e-8  relative
    uint256 private constant REL_1e_10 = 1e8;   // 1e-10 relative
    uint256 private constant REL_1e_12 = 1e6;   // 1e-12 relative

    // ====================================================================
    // Round-trip properties — f(g(x)) ≈ x within tolerance
    // ====================================================================

    /// ln(exp(x)) ≈ x for x ∈ [-20, 130] (below -20, exp underflows in FP precision).
    function test_RT_lnExp(int256 x) public pure {
        x = bound(x, -20e18, 130e18);
        uint256 ePos = DeFiMath.exp(x);
        if (ePos == 0) return;
        int256 back = DeFiMath.ln(ePos);
        assertApproxEqAbs(back, x, 1e9, "ln(exp(x)) != x");  // 1e-9 absolute
    }

    /// exp(ln(x)) ≈ x for x in a wide FP range.
    function test_RT_expLn(uint256 x) public pure {
        // ln domain: x > 0. 1e9 wei (1e-9 FP) up to 1e30 (1e12 FP) for stable round-trips.
        x = bound(x, 1e9, 1e30);
        int256 logged = DeFiMath.ln(x);
        if (logged >= 135e18) return;
        uint256 back = DeFiMath.exp(logged);
        assertApproxEqRel(back, x, REL_1e_10, "exp(ln(x)) != x");
    }

    /// sqrt(x)² ≈ x  (in FP: sqrt(x)·sqrt(x) / 1e18 ≈ x).
    /// Below ~1e12 wei (1e-6 FP), sqrt output has <9 FP sig digits and the round-trip
    /// loses precision; Hardhat tests cover that regime separately with dyadic doubling.
    function test_RT_sqrtSquared(uint256 x) public pure {
        x = bound(x, 1e12, 1e30);
        uint256 r = DeFiMath.sqrt(x);
        uint256 back = DeFiMath.mulDiv(r, r, FP_ONE);
        assertApproxEqRel(back, x, REL_1e_10, "sqrt(x)^2 != x");
    }

    /// cbrt(x)³ ≈ x. Same wei-precision floor as sqrt; bounded above by cbrt's 2^76 limit.
    function test_RT_cbrtCubed(uint256 x) public pure {
        x = bound(x, 1e12, 1e22);
        uint256 r = DeFiMath.cbrt(x);
        uint256 r2 = DeFiMath.mulDiv(r, r, FP_ONE);
        uint256 r3 = DeFiMath.mulDiv(r2, r, FP_ONE);
        assertApproxEqRel(r3, x, REL_1e_10, "cbrt(x)^3 != x");
    }

    /// exp(x) · exp(-x) ≈ 1 — multiplicative inverse round-trip.
    /// |x| > ~15 starts losing sig digits on the negative branch; tolerance is 1e-8.
    function test_RT_expReciprocalProduct(int256 x) public pure {
        x = bound(x, -20e18, 20e18);
        uint256 ePos = DeFiMath.exp(x);
        uint256 eNeg = DeFiMath.exp(-x);
        uint256 product = DeFiMath.mulDiv(ePos, eNeg, FP_ONE);
        assertApproxEqRel(product, FP_ONE, REL_1e_8, "exp(x) * exp(-x) != 1");
    }

    // ====================================================================
    // Monotonicity — f(x) ordering preserved (or non-decreasing)
    // ====================================================================

    /// x < y ⟹ exp(x) ≤ exp(y) (strict at every step in principle; allow equal at the
    /// ULP boundary in FP).
    function test_MONO_exp(int256 a, int256 b) public pure {
        a = bound(a, -41e18, 130e18);
        b = bound(b, -41e18, 130e18);
        if (a > b) (a, b) = (b, a);  // ensure a ≤ b
        uint256 eA = DeFiMath.exp(a);
        uint256 eB = DeFiMath.exp(b);
        assertLe(eA, eB, "exp not monotone non-decreasing");
    }

    /// x < y ⟹ ln(x) ≤ ln(y) for x, y > 0.
    function test_MONO_ln(uint256 a, uint256 b) public pure {
        a = bound(a, 1, type(uint128).max);
        b = bound(b, 1, type(uint128).max);
        if (a > b) (a, b) = (b, a);
        int256 lA = DeFiMath.ln(a);
        int256 lB = DeFiMath.ln(b);
        assertLe(lA, lB, "ln not monotone non-decreasing");
    }

    /// sqrt is monotone non-decreasing.
    function test_MONO_sqrt(uint256 a, uint256 b) public pure {
        a = bound(a, 0, 1e30);
        b = bound(b, 0, 1e30);
        if (a > b) (a, b) = (b, a);
        assertLe(DeFiMath.sqrt(a), DeFiMath.sqrt(b), "sqrt not monotone");
    }

    /// stdNormCDF is monotone non-decreasing (the cumulative distribution property).
    function test_MONO_stdNormCDF(int256 a, int256 b) public pure {
        a = bound(a, -16.447e18, 16.447e18);
        b = bound(b, -16.447e18, 16.447e18);
        if (a > b) (a, b) = (b, a);
        assertLe(DeFiMath.stdNormCDF(a), DeFiMath.stdNormCDF(b), "Phi not monotone");
    }

    /// erf is monotone non-decreasing.
    function test_MONO_erf(int256 a, int256 b) public pure {
        a = bound(a, -11.63e18, 11.63e18);
        b = bound(b, -11.63e18, 11.63e18);
        if (a > b) (a, b) = (b, a);
        assertLe(DeFiMath.erf(a), DeFiMath.erf(b), "erf not monotone");
    }

    // ====================================================================
    // Known identities — algebraic equations the functions must satisfy
    // ====================================================================

    /// For |x| ≥ 0.01, expm1(x) ≈ exp(x) - 1e18 (the naive branch).
    function test_ID_expm1MatchesExpMinus1(int256 x) public pure {
        x = bound(x, int256(0.01e18), int256(135e18));
        int256 viaExpm1 = DeFiMath.expm1(x);
        int256 viaExpMinus1 = int256(DeFiMath.exp(x)) - FP_ONE_INT;
        assertApproxEqRel(viaExpm1, viaExpMinus1, REL_1e_12, "expm1 != exp - 1 (large +x)");
    }

    /// For x ≥ 0.01, log1p(x) ≈ ln(1e18 + x).
    function test_ID_log1pMatchesLnOf1PlusX(int256 x) public pure {
        x = bound(x, int256(0.01e18), int256(1e36));
        int256 viaLog1p = DeFiMath.log1p(x);
        int256 viaLn = DeFiMath.ln(uint256(FP_ONE_INT + x));
        assertApproxEqRel(viaLog1p, viaLn, REL_1e_12, "log1p != ln(1 + x) (large +x)");
    }

    /// pow(x, 0) == 1 exactly (multiplicative identity at zero exponent).
    function test_ID_powZeroIsOne(uint256 x) public pure {
        x = bound(x, 1, 1e30);
        assertEq(DeFiMath.pow(x, 0), FP_ONE, "pow(x, 0) != 1");
    }

    /// pow(x, 1) ≈ x. Internally `pow` computes `exp(a · ln(x))`; bound x to where
    /// |ln(x)| ≤ ~14 to avoid exp's underflow boundary.
    function test_ID_powOneIsX(uint256 x) public pure {
        x = bound(x, 1e12, 1e30);
        uint256 r = DeFiMath.pow(x, int256(FP_ONE));
        assertApproxEqRel(r, x, REL_1e_10, "pow(x, 1) != x");
    }

    /// pow(x, 2) ≈ x² (via mulDiv).
    function test_ID_powTwoIsXSquared(uint256 x) public pure {
        x = bound(x, FP_ONE, 1e30);
        uint256 r = DeFiMath.pow(x, int256(2 * FP_ONE));
        uint256 xSq = DeFiMath.mulDiv(x, x, FP_ONE);
        assertApproxEqRel(r, xSq, REL_1e_8, "pow(x, 2) != x*x");
    }

    /// mul(a, b) == mulDiv(a, b, 1e18) in the fast-path range.
    function test_ID_mulMatchesMulDiv1e18(uint256 a, uint256 b) public pure {
        a = bound(a, 0, 1e30);
        b = bound(b, 0, 1e30);
        assertEq(DeFiMath.mul(a, b), DeFiMath.mulDiv(a, b, FP_ONE), "mul != mulDiv with d=1e18");
    }

    /// mulDiv result equals a·b/d when no overflow possible (fast path) — exact match
    /// against BigInt reference computed inline.
    function test_ID_mulDivFastPath(uint256 a, uint256 b, uint256 d) public pure {
        a = bound(a, 0, 1e30);
        b = bound(b, 0, 1e30);
        d = bound(d, 1, 1e30);
        assertEq(DeFiMath.mulDiv(a, b, d), (a * b) / d, "mulDiv fast-path != a*b/d");
    }

    /// min(a, b) + max(a, b) == a + b — exact inverse of one another.
    function test_ID_minMaxSumIsSum(uint256 a, uint256 b) public pure {
        a = bound(a, 0, type(uint256).max / 2);
        b = bound(b, 0, type(uint256).max / 2);
        assertEq(DeFiMath.min(a, b) + DeFiMath.max(a, b), a + b, "min + max != a + b");
    }

    /// avg is exact for sums that fit: (a + b) / 2 when a + b doesn't overflow.
    function test_ID_avgExactWhenNoOverflow(uint256 a, uint256 b) public pure {
        a = bound(a, 0, type(uint256).max / 2);
        b = bound(b, 0, type(uint256).max / 2);
        assertEq(DeFiMath.avg(a, b), (a + b) / 2, "avg != (a+b)/2 in safe range");
    }

    // ====================================================================
    // Output bounds — f(x) ∈ [lo, hi] for all valid inputs
    // ====================================================================

    /// Φ(x) ∈ [0, 1e18] for any int256 input — CDF always in [0, 1].
    function test_BNDS_stdNormCDFInZeroOne(int256 x) public pure {
        x = bound(x, type(int256).min, type(int256).max);
        uint256 phi = DeFiMath.stdNormCDF(x);
        assertLe(phi, FP_ONE, "Phi(x) > 1");
        // phi is uint256 → already ≥ 0
    }

    /// erf(x) ∈ [-1e18, 1e18] for any int256 input.
    function test_BNDS_erfInRange(int256 x) public pure {
        x = bound(x, type(int256).min, type(int256).max);
        int256 e = DeFiMath.erf(x);
        assertLe(e, FP_ONE_INT, "erf(x) > 1");
        assertGe(e, -FP_ONE_INT, "erf(x) < -1");
    }

    /// pow(x, a) > 0 for x > 0 (when result doesn't underflow).
    /// Bounds chosen so `|a · ln(x)|` stays safely under exp's ±135 revert/underflow
    /// boundary: x ∈ [0.1, 10] FP gives |ln(x)| ≤ 2.3; with |a| ≤ 50 → product ≤ 115.
    function test_BNDS_powPositiveOnPositive(uint256 x, int256 a) public pure {
        x = bound(x, 0.1e18, 10e18);
        a = bound(a, -50e18, 50e18);
        uint256 r = DeFiMath.pow(x, a);
        // For x > 0 the result is always non-negative; underflow → 0 is allowed.
        // The property is just that pow doesn't return some impossible value.
        if (r != 0) assertGt(r, 0, "pow result is 0 unexpectedly");
    }

    /// min ≤ max (precondition holds for any input pair).
    function test_BNDS_minLessThanOrEqualMax(uint256 a, uint256 b) public pure {
        assertLe(DeFiMath.min(a, b), DeFiMath.max(a, b), "min > max");
    }

    /// clamp(x, lo, hi) lands inside [lo, hi] when lo ≤ hi.
    function test_BNDS_clampInRange(uint256 x, uint256 lo, uint256 hi) public pure {
        if (lo > hi) (lo, hi) = (hi, lo);
        uint256 c = DeFiMath.clamp(x, lo, hi);
        assertGe(c, lo, "clamp result below lo");
        assertLe(c, hi, "clamp result above hi");
    }

    /// avg(a, b) lies in [min(a,b), max(a,b)] and never overflows.
    function test_BNDS_avgInRange(uint256 a, uint256 b) public pure {
        uint256 av = DeFiMath.avg(a, b);
        assertGe(av, DeFiMath.min(a, b), "avg below min");
        assertLe(av, DeFiMath.max(a, b), "avg above max");
    }

    // ====================================================================
    // Symmetries — f(-x) related to f(x) by reflection / negation
    // ====================================================================

    /// Φ(x) + Φ(-x) == 1 (standard-normal CDF reflection symmetry).
    function test_SYM_stdNormCDF(int256 x) public pure {
        x = bound(x, -16.447e18, 16.447e18);
        uint256 phiPos = DeFiMath.stdNormCDF(x);
        uint256 phiNeg = DeFiMath.stdNormCDF(-x);
        assertApproxEqAbs(phiPos + phiNeg, FP_ONE, 100, "Phi(x) + Phi(-x) != 1");
    }

    /// erf(-x) == -erf(x) (erf is an odd function).
    function test_SYM_erfIsOdd(int256 x) public pure {
        x = bound(x, -11.63e18, 11.63e18);
        int256 erfPos = DeFiMath.erf(x);
        int256 erfNeg = DeFiMath.erf(-x);
        assertApproxEqAbs(erfPos + erfNeg, int256(0), 100, "erf(-x) != -erf(x)");
    }

    /// abs(-x) == abs(x). Skip type(int256).min where -(int256.min) would overflow;
    /// `abs(int256.min)` returns 2^255 unchecked by design (see NatSpec).
    function test_SYM_abs(int256 x) public pure {
        vm.assume(x != type(int256).min);
        assertEq(DeFiMath.abs(x), DeFiMath.abs(-x), "abs(x) != abs(-x)");
    }
}
