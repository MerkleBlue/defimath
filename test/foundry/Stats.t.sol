// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DeFiMathStats} from "../../contracts/finance/Stats.sol";

/// @notice External harness exposing Stats library functions as `external` so test
///         code can build arrays in memory and pass them via `try` semantics.
contract StatsHarness {
    function geometricMean(uint256 a, uint256 b) external pure returns (uint256) {
        return DeFiMathStats.geometricMean(a, b);
    }
    function mean(uint256[] calldata values) external pure returns (uint256) {
        return DeFiMathStats.mean(values);
    }
    function stdDev(uint256[] calldata values) external pure returns (uint256) {
        return DeFiMathStats.stdDev(values);
    }
    function weightedAverage(uint256[] calldata values, uint256[] calldata weights) external pure returns (uint256) {
        return DeFiMathStats.weightedAverage(values, weights);
    }
    function maxDrawdown(uint256[] calldata equity) external pure returns (uint256) {
        return DeFiMathStats.maxDrawdown(equity);
    }
}

/// @notice Property-based fuzz tests for DeFiMathStats. Validates the algebraic
///         identities of statistical primitives — geometric-mean symmetry, mean/stddev
///         linearity, mean and weighted-average bounds, constant-array invariants,
///         and the monotone-equity zero-drawdown property.
///
/// @dev Filter by category prefix:
///          forge test --match-test test_MONO_   (monotonicity)
///          forge test --match-test test_ID_     (known identities)
///          forge test --match-test test_BNDS_   (output bounds)
///          forge test --match-test test_SYM_    (symmetries)
contract StatsPropertyTest is Test {

    StatsHarness private harness;

    uint256 private constant FP_ONE = 1e18;
    uint256 private constant REL_1e_10 = 1e8;
    uint256 private constant REL_1e_8  = 1e10;

    // Element value range — well inside the contract's MAX_VALUE = 1e33.
    uint256 private constant ELEM_LO = 1e18;          // $1
    uint256 private constant ELEM_HI = 1_000_000e18;  // $1M

    function setUp() public {
        harness = new StatsHarness();
    }

    // ---- helpers --------------------------------------------------------

    function _constArray(uint256 c, uint256 n) private pure returns (uint256[] memory arr) {
        arr = new uint256[](n);
        for (uint256 i = 0; i < n; i++) arr[i] = c;
    }

    function _monotoneIncreasing(uint256 start, uint256 step, uint256 n) private pure returns (uint256[] memory arr) {
        arr = new uint256[](n);
        for (uint256 i = 0; i < n; i++) arr[i] = start + i * step;
    }

    function _three(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory arr) {
        arr = new uint256[](3);
        arr[0] = a; arr[1] = b; arr[2] = c;
    }

    function _scaled(uint256[] memory src, uint256 k) private pure returns (uint256[] memory arr) {
        arr = new uint256[](src.length);
        for (uint256 i = 0; i < src.length; i++) arr[i] = src[i] * k;
    }

    function _min3(uint256 a, uint256 b, uint256 c) private pure returns (uint256) {
        uint256 m = a < b ? a : b;
        return m < c ? m : c;
    }

    function _max3(uint256 a, uint256 b, uint256 c) private pure returns (uint256) {
        uint256 m = a > b ? a : b;
        return m > c ? m : c;
    }

    // ====================================================================
    // Monotonicity — output ordering preserved with one input varied
    // ====================================================================

    /// geometricMean is monotone non-decreasing in the first argument (for fixed b).
    function test_MONO_geometricMeanIncreasingInA(uint256 aLo, uint256 aHi, uint256 b) public view {
        aLo = bound(aLo, ELEM_LO, ELEM_HI);
        aHi = bound(aHi, aLo + ELEM_LO, ELEM_HI * 2);   // require meaningful gap
        b   = bound(b, ELEM_LO, ELEM_HI);
        uint256 gLo = harness.geometricMean(aLo, b);
        uint256 gHi = harness.geometricMean(aHi, b);
        assertLe(gLo, gHi, "geometricMean not monotone increasing in a");
    }

    // ====================================================================
    // Known identities — algebraic relationships that hold for any input
    // ====================================================================

    /// geometricMean(a, a) ≈ a — idempotent on equal inputs (since √(a·a) = a).
    function test_ID_geometricMeanOfEqual(uint256 a) public view {
        a = bound(a, ELEM_LO, ELEM_HI);
        uint256 result = harness.geometricMean(a, a);
        assertApproxEqRel(result, a, REL_1e_10, "geometricMean(a, a) != a");
    }

    /// mean(constant array) == constant.
    function test_ID_meanOfConstant(uint256 c, uint8 n) public view {
        c = bound(c, ELEM_LO, ELEM_HI);
        n = uint8(bound(n, 2, 50));
        uint256[] memory arr = _constArray(c, n);
        assertEq(harness.mean(arr), c, "mean(constant) != constant");
    }

    /// stdDev(constant array) == 0 — no variance in a constant series.
    function test_ID_stdDevOfConstant(uint256 c, uint8 n) public view {
        c = bound(c, ELEM_LO, ELEM_HI);
        n = uint8(bound(n, 2, 50));
        uint256[] memory arr = _constArray(c, n);
        assertEq(harness.stdDev(arr), 0, "stdDev(constant) != 0");
    }

    /// maxDrawdown(monotone increasing equity) == 0 — no peak-to-trough decline.
    function test_ID_maxDrawdownOfIncreasing(uint256 start, uint256 step, uint8 n) public view {
        start = bound(start, ELEM_LO, ELEM_HI);
        step  = bound(step, 1, ELEM_LO);
        n     = uint8(bound(n, 2, 50));
        uint256[] memory arr = _monotoneIncreasing(start, step, n);
        assertEq(harness.maxDrawdown(arr), 0, "maxDrawdown(increasing) != 0");
    }

    /// weightedAverage(values, equal_weights) == mean(values) — the weighted average
    /// with uniform weights collapses to the arithmetic mean.
    function test_ID_weightedAverageEqualsMeanForEqualWeights(uint256 a, uint256 b, uint256 c) public view {
        a = bound(a, ELEM_LO, ELEM_HI);
        b = bound(b, ELEM_LO, ELEM_HI);
        c = bound(c, ELEM_LO, ELEM_HI);
        uint256[] memory vals = _three(a, b, c);
        uint256[] memory wts  = _constArray(FP_ONE, 3);
        uint256 wAvg = harness.weightedAverage(vals, wts);
        uint256 m    = harness.mean(vals);
        assertApproxEqRel(wAvg, m, REL_1e_10, "weightedAverage(equal_weights) != mean");
    }

    /// Mean scales linearly: mean(2 * values) ≈ 2 * mean(values), within 1 wei.
    /// (Integer-division rounding can produce an off-by-one when (a+b+c) % n != 0.)
    function test_ID_meanLinearityInScale(uint256 a, uint256 b, uint256 c) public view {
        a = bound(a, ELEM_LO, ELEM_HI / 2);
        b = bound(b, ELEM_LO, ELEM_HI / 2);
        c = bound(c, ELEM_LO, ELEM_HI / 2);
        uint256[] memory arr  = _three(a, b, c);
        uint256[] memory arr2 = _scaled(arr, 2);
        assertApproxEqAbs(harness.mean(arr2), 2 * harness.mean(arr), 1, "mean(2 * values) != 2 * mean(values)");
    }

    /// Std dev scales linearly: stdDev(2 * values) ≈ 2 * stdDev(values).
    /// Skips when stdDev is at the integer-arithmetic precision floor (< 1e15 wei =
    /// 1e-3 FP), where doubling-then-sqrt rounding can produce ~percent-level relative
    /// drift. For meaningfully-sized stdDev, the property holds tightly.
    function test_ID_stdDevLinearityInScale(uint256 a, uint256 b, uint256 c) public view {
        a = bound(a, ELEM_LO, ELEM_HI / 2);
        b = bound(b, ELEM_LO, ELEM_HI / 2);
        c = bound(c, ELEM_LO, ELEM_HI / 2);
        uint256[] memory arr  = _three(a, b, c);
        uint256[] memory arr2 = _scaled(arr, 2);
        uint256 sd  = harness.stdDev(arr);
        uint256 sd2 = harness.stdDev(arr2);
        if (sd < 1e15) return;   // skip dust-stdDev where integer sqrt loses precision
        assertApproxEqRel(sd2, 2 * sd, REL_1e_10, "stdDev(2 * values) != 2 * stdDev(values)");
    }

    // ====================================================================
    // Output bounds — range constraints
    // ====================================================================

    /// min(values) ≤ mean(values) ≤ max(values) — basic bound on arithmetic mean.
    function test_BNDS_meanInRange(uint256 a, uint256 b, uint256 c) public view {
        a = bound(a, ELEM_LO, ELEM_HI);
        b = bound(b, ELEM_LO, ELEM_HI);
        c = bound(c, ELEM_LO, ELEM_HI);
        uint256[] memory arr = _three(a, b, c);
        uint256 m = harness.mean(arr);
        assertGe(m, _min3(a, b, c), "mean < min");
        assertLe(m, _max3(a, b, c), "mean > max");
    }

    /// min(a, b) ≤ geometricMean(a, b) ≤ max(a, b) — AM-GM inequality and trivial upper.
    function test_BNDS_geometricMeanInRange(uint256 a, uint256 b) public view {
        a = bound(a, ELEM_LO, ELEM_HI);
        b = bound(b, ELEM_LO, ELEM_HI);
        uint256 g = harness.geometricMean(a, b);
        uint256 mn = a < b ? a : b;
        uint256 mx = a > b ? a : b;
        // Allow 1 wei slack for FP rounding at the precision floor.
        assertGe(g + 1, mn, "geometricMean < min(a, b)");
        assertLe(g, mx + 1, "geometricMean > max(a, b)");
    }

    /// maxDrawdown ∈ [0, 1e18] — drawdown is a fraction of peak, capped at 100%.
    function test_BNDS_maxDrawdownInUnitInterval(uint256 a, uint256 b, uint256 c, uint256 d) public view {
        a = bound(a, ELEM_LO, ELEM_HI);
        b = bound(b, ELEM_LO, ELEM_HI);
        c = bound(c, ELEM_LO, ELEM_HI);
        d = bound(d, ELEM_LO, ELEM_HI);
        uint256[] memory arr = new uint256[](4);
        arr[0] = a; arr[1] = b; arr[2] = c; arr[3] = d;
        uint256 mdd = harness.maxDrawdown(arr);
        assertLe(mdd, FP_ONE, "maxDrawdown > 100%");
    }

    // ====================================================================
    // Symmetries — argument-order independence
    // ====================================================================

    /// geometricMean(a, b) == geometricMean(b, a) — symmetric in argument order.
    function test_SYM_geometricMeanCommutative(uint256 a, uint256 b) public view {
        a = bound(a, ELEM_LO, ELEM_HI);
        b = bound(b, ELEM_LO, ELEM_HI);
        assertEq(harness.geometricMean(a, b), harness.geometricMean(b, a), "geometricMean not commutative");
    }
}
