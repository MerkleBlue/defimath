// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DeFiMathRates} from "../../contracts/finance/Rates.sol";

/// @notice Property-based fuzz tests for DeFiMathRates. Validates inverse-function
///         round-trips (compound/discount, continuous/discrete rate conversions),
///         monotonicity in principal/rate, identity cases (zero-time, zero-rate),
///         and the bond YTM closed-form round-trip.
///
/// @dev Filter by category prefix:
///          forge test --match-test test_RT_     (round-trips — inverse-function pairs)
///          forge test --match-test test_MONO_   (monotonicity)
///          forge test --match-test test_ID_     (known identities)
///          forge test --match-test test_BNDS_   (output bounds)
///          forge test --match-test test_SYM_    (symmetries)
///
///      No property tests for `internalRateOfReturn` — Newton-Raphson with arbitrary
///      cashflow arrays is structurally hard to fuzz cleanly. Hardhat covers it at
///      concrete points.
contract RatesPropertyTest is Test {

    uint256 private constant FP_ONE = 1e18;
    uint256 private constant SECONDS_IN_YEAR = 31536000;

    uint256 private constant REL_1e_10 = 1e8;
    uint256 private constant REL_1e_8  = 1e10;
    uint256 private constant REL_1e_6  = 1e12;

    // Conservative input ranges — well inside the contract validation envelope.
    uint128 private constant PRINCIPAL_TYPICAL_LO = uint128(1e18);          // $1
    uint128 private constant PRINCIPAL_TYPICAL_HI = uint128(1_000_000e18);  // $1M
    uint64  private constant RATE_TYPICAL_HI       = uint64(0.5e18);        // 50% annual
    uint32  private constant TIME_TYPICAL_HI       = 730 days;

    /// Proportional slack absorbed by monotonicity asserts.
    function _slack(uint256 magnitude) private pure returns (uint256) {
        return magnitude / 1e10 + 1e6;
    }

    // ====================================================================
    // Round-trips — inverse function pairs recover the original input
    // ====================================================================

    /// presentValue(compoundInterest(P, r, t), r, t) ≈ P — core inversion of the
    /// continuous compounding/discounting pair.
    function test_RT_pvCompoundInverse(uint128 principal, uint64 rate, uint32 t) public pure {
        principal = uint128(bound(principal, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        rate      = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        t         = uint32(bound(t, 1, TIME_TYPICAL_HI));
        uint256 fv = DeFiMathRates.compoundInterest(principal, rate, t);
        if (fv >= type(uint128).max) return;     // skip if intermediate overflows uint128
        uint256 back = DeFiMathRates.presentValue(uint128(fv), rate, t);
        assertApproxEqRel(back, principal, REL_1e_10, "PV(CI(P, r, t), r, t) != P");
    }

    /// compoundInterest(presentValue(FV, r, t), r, t) ≈ FV — reverse direction.
    function test_RT_compoundPvInverse(uint128 futureValue, uint64 rate, uint32 t) public pure {
        futureValue = uint128(bound(futureValue, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        rate        = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        t           = uint32(bound(t, 1, TIME_TYPICAL_HI));
        uint256 pv = DeFiMathRates.presentValue(futureValue, rate, t);
        if (pv >= type(uint128).max) return;
        uint256 back = DeFiMathRates.compoundInterest(uint128(pv), rate, t);
        assertApproxEqRel(back, futureValue, REL_1e_10, "CI(PV(FV, r, t), r, t) != FV");
    }

    /// discreteToContinuous(continuousToDiscrete(r)) ≈ r — APR↔APY round-trip.
    function test_RT_aprApyInverse(int256 apr) public pure {
        // continuousToDiscrete bounds: |apr| < MAX_RATE (4e18); narrow for round-trip precision.
        apr = bound(apr, int256(-0.5e18), int256(0.5e18));
        int256 apy = DeFiMathRates.continuousToDiscrete(apr);
        int256 back = DeFiMathRates.discreteToContinuous(apy);
        assertApproxEqAbs(back, apr, 1e9, "d2c(c2d(r)) != r");   // 1e-9 absolute
    }

    /// continuousToDiscrete(discreteToContinuous(r)) ≈ r — reverse direction.
    function test_RT_apyAprInverse(int256 apy) public pure {
        apy = bound(apy, int256(-0.5e18), int256(0.5e18));
        int256 apr = DeFiMathRates.discreteToContinuous(apy);
        int256 back = DeFiMathRates.continuousToDiscrete(apr);
        assertApproxEqAbs(back, apy, 1e9, "c2d(d2c(r)) != r");
    }

    /// presentValue(face, YTM(price, face, t), t) ≈ price — bond YTM closed-form
    /// round-trip. YTM is derived analytically; reapplying as a discount must recover
    /// the original price.
    function test_RT_ytmBondRoundTrip(uint128 price, uint128 faceValue, uint32 t) public pure {
        // Keep price/face ratio bounded so YTM stays within presentValue's MAX_RATE.
        // ytm = ln(F/P)/T; for T up to 2y and MAX_RATE = 400%, we need ln(F/P) < 8.
        // Conservative: face/price ≤ 100 → ln(100) ≈ 4.6, well under the bound.
        faceValue = uint128(bound(faceValue, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        price     = uint128(bound(price, uint256(faceValue) / 100, uint256(faceValue) - 1));
        t         = uint32(bound(t, 1 days, TIME_TYPICAL_HI));
        int256 ytm = DeFiMathRates.yieldToMaturity(price, faceValue, t);
        if (ytm < 0 || ytm >= int256(4e18)) return;   // MAX_RATE guard
        uint256 back = DeFiMathRates.presentValue(faceValue, uint64(uint256(ytm)), t);
        assertApproxEqRel(back, price, REL_1e_8, "PV(F, YTM(P, F, t), t) != P");
    }

    // ====================================================================
    // Monotonicity — output ordering preserved with one input varied
    // ====================================================================

    /// compoundInterest is monotone non-decreasing in principal (linear in fact).
    function test_MONO_compoundIncreasingInPrincipal(uint128 pLo, uint128 pHi, uint64 rate, uint32 t) public pure {
        pLo  = uint128(bound(pLo, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI / 2));
        pHi  = uint128(bound(pHi, uint256(pLo) + 1, PRINCIPAL_TYPICAL_HI));
        rate = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        t    = uint32(bound(t, 1, TIME_TYPICAL_HI));
        uint256 fLo = DeFiMathRates.compoundInterest(pLo, rate, t);
        uint256 fHi = DeFiMathRates.compoundInterest(pHi, rate, t);
        assertLe(fLo, fHi + _slack(fHi), "CI not monotone increasing in principal");
    }

    /// presentValue is monotone non-decreasing in futureValue (linear).
    function test_MONO_pvIncreasingInFutureValue(uint128 fvLo, uint128 fvHi, uint64 rate, uint32 t) public pure {
        fvLo = uint128(bound(fvLo, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI / 2));
        fvHi = uint128(bound(fvHi, uint256(fvLo) + 1, PRINCIPAL_TYPICAL_HI));
        rate = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        t    = uint32(bound(t, 1, TIME_TYPICAL_HI));
        uint256 pvLo = DeFiMathRates.presentValue(fvLo, rate, t);
        uint256 pvHi = DeFiMathRates.presentValue(fvHi, rate, t);
        assertLe(pvLo, pvHi + _slack(pvHi), "PV not monotone increasing in futureValue");
    }

    /// presentValue is monotone non-increasing in rate (higher discount → lower PV).
    function test_MONO_pvDecreasingInRate(uint128 futureValue, uint64 rLo, uint64 rHi, uint32 t) public pure {
        futureValue = uint128(bound(futureValue, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        rLo = uint64(bound(rLo, 0, RATE_TYPICAL_HI / 2));
        rHi = uint64(bound(rHi, uint256(rLo) + 1, RATE_TYPICAL_HI));
        t   = uint32(bound(t, 1 days, TIME_TYPICAL_HI));
        uint256 pvLo = DeFiMathRates.presentValue(futureValue, rLo, t);
        uint256 pvHi = DeFiMathRates.presentValue(futureValue, rHi, t);
        assertGe(pvLo + _slack(pvLo), pvHi, "PV not monotone decreasing in rate");
    }

    /// continuousToDiscrete is monotone increasing (e^x - 1 is strictly increasing).
    /// Require aprHi ≥ aprLo + 1e12 (1e-6 FP) so the expected output gap is large
    /// enough that integer-arithmetic expm1 rounding can't violate monotonicity.
    function test_MONO_continuousToDiscreteIncreasing(int256 aprLo, int256 aprHi) public pure {
        aprLo = bound(aprLo, int256(-1e18), int256(1e18));
        aprHi = bound(aprHi, aprLo + int256(1e12), int256(2e18));
        int256 apyLo = DeFiMathRates.continuousToDiscrete(aprLo);
        int256 apyHi = DeFiMathRates.continuousToDiscrete(aprHi);
        assertLe(apyLo, apyHi, "continuousToDiscrete not monotone");
    }

    // ====================================================================
    // Known identities — algebraic relationships that hold for any input
    // ====================================================================

    /// compoundInterest(P, 0, t) == P — no rate, no carry.
    function test_ID_zeroRateReturnsP(uint128 principal, uint32 t) public pure {
        principal = uint128(bound(principal, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        t         = uint32(bound(t, 0, TIME_TYPICAL_HI));
        assertEq(DeFiMathRates.compoundInterest(principal, 0, t), principal, "CI(P, 0, t) != P");
    }

    /// compoundInterest(P, r, 0) == P — no time, no carry.
    function test_ID_zeroTimeReturnsP(uint128 principal, uint64 rate) public pure {
        principal = uint128(bound(principal, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        rate      = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        assertEq(DeFiMathRates.compoundInterest(principal, rate, 0), principal, "CI(P, r, 0) != P");
    }

    /// logReturn(p, p) == 0 — same price means zero return.
    function test_ID_logReturnSelfIsZero(uint128 price) public pure {
        price = uint128(bound(price, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        assertEq(DeFiMathRates.logReturn(price, price), int256(0), "logReturn(p, p) != 0");
    }

    // ====================================================================
    // Output bounds — no-arbitrage and sign constraints
    // ====================================================================

    /// compoundInterest ≥ principal — for rate ≥ 0, compounding never reduces value.
    function test_BNDS_compoundAtLeastPrincipal(uint128 principal, uint64 rate, uint32 t) public pure {
        principal = uint128(bound(principal, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        rate      = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        t         = uint32(bound(t, 0, TIME_TYPICAL_HI));
        uint256 fv = DeFiMathRates.compoundInterest(principal, rate, t);
        // 1 wei slack for FP rounding at zero rate/time.
        assertGe(fv + 1, principal, "CI < principal (impossible for r >= 0)");
    }

    /// presentValue ≤ futureValue — for rate ≥ 0, discounting never increases value.
    function test_BNDS_pvAtMostFutureValue(uint128 futureValue, uint64 rate, uint32 t) public pure {
        futureValue = uint128(bound(futureValue, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        rate        = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        t           = uint32(bound(t, 0, TIME_TYPICAL_HI));
        uint256 pv = DeFiMathRates.presentValue(futureValue, rate, t);
        assertLe(pv, uint256(futureValue) + 1, "PV > futureValue (impossible for r >= 0)");
    }

    // ====================================================================
    // Symmetries — flip-input identities
    // ====================================================================

    /// logReturn(p1, p0) == -logReturn(p0, p1) — anti-symmetric in argument order
    /// (ln(a/b) = -ln(b/a)).
    function test_SYM_logReturnAntiSymmetric(uint128 p1, uint128 p0) public pure {
        p1 = uint128(bound(p1, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        p0 = uint128(bound(p0, PRINCIPAL_TYPICAL_LO, PRINCIPAL_TYPICAL_HI));
        int256 forward  = DeFiMathRates.logReturn(p1, p0);
        int256 backward = DeFiMathRates.logReturn(p0, p1);
        // Tolerance 1e10 wei (≈ 1e-8 absolute) — for p1/p0 ratios spanning multiple
        // orders of magnitude, the two ln calls operate on FP values of opposite
        // sign and very different magnitudes; their integer-arithmetic rounding
        // doesn't cancel to ULP precision.
        assertApproxEqAbs(forward + backward, int256(0), 1e10, "logReturn(p1, p0) != -logReturn(p0, p1)");
    }
}
