// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DeFiMathFutures} from "../../contracts/derivatives/Futures.sol";
import {DeFiMath} from "../../contracts/math/Math.sol";

/// @notice Property-based fuzz tests for DeFiMathFutures. Validates linearity in spot,
///         monotonicity in spot/time/rate, identity cases (zero-time, zero-rate),
///         the semigroup composition property, and the no-arbitrage lower bound.
///
/// @dev Filter by category prefix:
///          forge test --match-test test_MONO_   (monotonicity)
///          forge test --match-test test_ID_     (known identities)
///          forge test --match-test test_BNDS_   (output bounds)
contract FuturesPropertyTest is Test {

    uint256 private constant FP_ONE = 1e18;
    uint256 private constant SECONDS_IN_YEAR = 31536000;

    uint256 private constant REL_1e_10 = 1e8;
    uint256 private constant REL_1e_8  = 1e10;

    // Typical input domain — inside the library's accepted envelope, with margin.
    uint128 private constant SPOT_TYPICAL_LO = uint128(0.001e18);     // $0.001
    uint128 private constant SPOT_TYPICAL_HI = uint128(1_000_000e18); // $1M
    uint64  private constant RATE_TYPICAL_HI = uint64(1e18);           // 100% annual
    uint32  private constant TIME_TYPICAL_HI = 730 days;

    /// Slack absorbed by monotonicity asserts at the FP-precision floor.
    /// Future price magnitudes range across many orders of magnitude; proportional
    /// slack tracks the rounding floor regardless of price size.
    function _slack(uint256 priceMagnitude) private pure returns (uint256) {
        return priceMagnitude / 1e10 + 1e6;
    }

    /// Standard 3-input boundary.
    function _boundInputs(uint128 spot, uint32 timeToExp, uint64 rate)
        private pure returns (uint128, uint32, uint64)
    {
        spot      = uint128(bound(spot,      SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        timeToExp = uint32(bound(timeToExp, 1, TIME_TYPICAL_HI));
        rate      = uint64(bound(rate,       0, RATE_TYPICAL_HI));
        return (spot, timeToExp, rate);
    }

    // ====================================================================
    // Monotonicity — output ordering preserved with one input varied
    // ====================================================================

    /// Future price is monotone non-decreasing in spot — strictly linear, in fact.
    function test_MONO_increasingInSpot(uint128 spotLo, uint128 spotHi, uint32 t, uint64 rate) public pure {
        spotLo = uint128(bound(spotLo, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI / 2));
        spotHi = uint128(bound(spotHi, uint256(spotLo) + 1, SPOT_TYPICAL_HI));
        t      = uint32(bound(t, 1, TIME_TYPICAL_HI));
        rate   = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        uint256 fLo = DeFiMathFutures.futurePrice(spotLo, t, rate);
        uint256 fHi = DeFiMathFutures.futurePrice(spotHi, t, rate);
        assertLe(fLo, fHi + _slack(fHi), "F not monotone increasing in spot");
    }

    /// Future price is monotone non-decreasing in time (for rate ≥ 0, more time
    /// compounds more carry).
    function test_MONO_increasingInTime(uint128 spot, uint32 tLo, uint32 tHi, uint64 rate) public pure {
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        tLo  = uint32(bound(tLo, 1, TIME_TYPICAL_HI / 2));
        tHi  = uint32(bound(tHi, uint256(tLo) + 1, TIME_TYPICAL_HI));
        rate = uint64(bound(rate, 1, RATE_TYPICAL_HI));   // rate > 0 to make monotone strict
        uint256 fLo = DeFiMathFutures.futurePrice(spot, tLo, rate);
        uint256 fHi = DeFiMathFutures.futurePrice(spot, tHi, rate);
        assertLe(fLo, fHi + _slack(fHi), "F not monotone increasing in time");
    }

    /// Future price is monotone non-decreasing in rate (for time > 0).
    function test_MONO_increasingInRate(uint128 spot, uint32 t, uint64 rLo, uint64 rHi) public pure {
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        t    = uint32(bound(t, 1 days, TIME_TYPICAL_HI));
        rLo  = uint64(bound(rLo, 0, RATE_TYPICAL_HI / 2));
        rHi  = uint64(bound(rHi, uint256(rLo) + 1, RATE_TYPICAL_HI));
        uint256 fLo = DeFiMathFutures.futurePrice(spot, t, rLo);
        uint256 fHi = DeFiMathFutures.futurePrice(spot, t, rHi);
        assertLe(fLo, fHi + _slack(fHi), "F not monotone increasing in rate");
    }

    // ====================================================================
    // Known identities — algebraic relationships that hold for any input
    // ====================================================================

    /// F(S, 0, r) == S — no time, no carry.
    function test_ID_zeroTimeReturnsSpot(uint128 spot, uint64 rate) public pure {
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        rate = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        assertEq(DeFiMathFutures.futurePrice(spot, 0, rate), spot, "F(S, 0, r) != S");
    }

    /// F(S, t, 0) == S — no rate, no carry.
    function test_ID_zeroRateReturnsSpot(uint128 spot, uint32 t) public pure {
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        t    = uint32(bound(t, 0, TIME_TYPICAL_HI));
        assertEq(DeFiMathFutures.futurePrice(spot, t, 0), spot, "F(S, t, 0) != S");
    }

    /// Spot homogeneity: F(k·S, t, r) == k · F(S, t, r). The future price is linear
    /// in spot since e^(r·t) factors out cleanly.
    function test_ID_spotHomogeneity(uint128 spot, uint32 t, uint64 rate) public pure {
        // Keep 2·spot inside the contract's MAX_SPOT bound.
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI / 2));
        t    = uint32(bound(t, 1, TIME_TYPICAL_HI));
        rate = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        uint256 f1 = DeFiMathFutures.futurePrice(spot, t, rate);
        uint256 f2 = DeFiMathFutures.futurePrice(spot * 2, t, rate);
        assertApproxEqRel(f2, 2 * f1, REL_1e_10, "F(2S) != 2 * F(S)");
    }

    /// F(S, t, r) ≈ S · e^(r·t) — verified against DeFiMath.exp directly.
    function test_ID_matchesSpotTimesExp(uint128 spot, uint32 t, uint64 rate) public pure {
        (spot, t, rate) = _boundInputs(spot, t, rate);
        uint256 actual = DeFiMathFutures.futurePrice(spot, t, rate);
        uint256 timeYear = uint256(t) * FP_ONE / SECONDS_IN_YEAR;
        uint256 scaledRate = uint256(rate) * timeYear / FP_ONE;
        uint256 expected = uint256(spot) * DeFiMath.expPositive(scaledRate) / FP_ONE;
        assertEq(actual, expected, "F != S * e^(r*t) computed directly");
    }

    /// Semigroup composition: F(S, t1+t2, r) ≈ F(F(S, t1, r), t2, r).
    /// Pricing a future over t1+t2 is equivalent to pricing it over t1 then taking the
    /// result as a new spot and pricing it over t2. Tests both compositional integrity
    /// and stability under repeated `exp` applications.
    function test_ID_semigroupComposition(uint128 spot, uint32 t1, uint32 t2, uint64 rate) public pure {
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI / 100));  // leave room for compounding
        t1   = uint32(bound(t1, 1, TIME_TYPICAL_HI / 2));
        t2   = uint32(bound(t2, 1, TIME_TYPICAL_HI / 2));
        rate = uint64(bound(rate, 0, RATE_TYPICAL_HI));
        // F(S, t1+t2, r)
        uint256 oneStep = DeFiMathFutures.futurePrice(spot, t1 + t2, rate);
        // F(F(S, t1, r), t2, r) — intermediate result must fit in uint128 for the second call
        uint256 firstStep = DeFiMathFutures.futurePrice(spot, t1, rate);
        if (firstStep >= type(uint128).max) return;   // skip if intermediate overflows
        uint256 twoStep = DeFiMathFutures.futurePrice(uint128(firstStep), t2, rate);
        assertApproxEqRel(twoStep, oneStep, REL_1e_10, "F(S, t1+t2, r) != F(F(S, t1, r), t2, r)");
    }

    // ====================================================================
    // Output bounds — no-arbitrage and sign constraints
    // ====================================================================

    /// F ≥ spot — for any rate ≥ 0 and time ≥ 0, the future price never falls below
    /// spot (no arbitrage: you can always sell the future and hold cash earning ≥ 0%).
    function test_BNDS_atLeastSpot(uint128 spot, uint32 t, uint64 rate) public pure {
        (spot, t, rate) = _boundInputs(spot, t, rate);
        uint256 f = DeFiMathFutures.futurePrice(spot, t, rate);
        // Allow 1 wei slack for FP rounding at near-zero rate·time products.
        assertGe(f + 1, spot, "F < spot (impossible for r*t >= 0)");
    }
}
