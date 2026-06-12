// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {DeFiMathBinary} from "../../contracts/derivatives/Binary.sol";
import {DeFiMath} from "../../contracts/math/Math.sol";

/// @notice Property-based fuzz tests for DeFiMathBinary. Validates the binary-options
///         identities (binary put-call parity, Greek sum-to-zero), monotonicity in
///         spot and strike, and no-arbitrage bounds across the input domain.
///
/// @dev Tests are grouped into the same five categories as the Math/Options suites.
///      Filter by category prefix:
///          forge test --match-test test_MONO_   (monotonicity)
///          forge test --match-test test_ID_     (known identities)
///          forge test --match-test test_BNDS_   (output bounds)
///          forge test --match-test test_SYM_    (symmetries)
///
///      No round-trips for binaries — there's no implied-vol solver in this module.
contract BinaryPropertyTest is Test {

    uint256 private constant FP_ONE = 1e18;

    uint256 private constant REL_1e_10 = 1e8;
    uint256 private constant REL_1e_8  = 1e10;
    uint256 private constant REL_1e_6  = 1e12;

    // Typical input domain — well inside the contract validation envelope.
    uint128 private constant SPOT_TYPICAL_LO = uint128(0.001e18);     // $0.001
    uint128 private constant SPOT_TYPICAL_HI = uint128(1_000_000e18); // $1M
    uint64  private constant VOL_TYPICAL_LO  = uint64(0.01e18);       // 1% annualized
    uint64  private constant VOL_TYPICAL_HI  = uint64(5e18);          // 500% annualized
    uint64  private constant RATE_TYPICAL_LO = 0;
    uint64  private constant RATE_TYPICAL_HI = uint64(1e18);          // 100% annualized
    uint32  private constant TIME_TYPICAL_LO = 1 days;
    uint32  private constant TIME_TYPICAL_HI = 730 days;

    /// Proportional slack absorbed in monotonicity asserts at the FP-precision floor.
    /// Binary prices are bounded in [0, 1] (in FP wei: [0, 1e18]) so ≤ 1e18 max, but
    /// dust-OTM/ITM prices can be ~1e8 wei. Hybrid slack scales appropriately.
    function _slack(uint256 priceMagnitude) private pure returns (uint256) {
        return priceMagnitude / 1e10 + 1e6;
    }

    /// Standard 5-input boundary. Strike in [spot/4, spot*4] (tighter than the
    /// library's MAX_STSP_RATIO=5 to leave room).
    function _boundInputs(uint128 spot, uint128 strike, uint32 timeToExp, uint64 vol, uint64 rate)
        private pure returns (uint128, uint128, uint32, uint64, uint64)
    {
        spot      = uint128(bound(spot,      SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        strike    = uint128(bound(strike,    spot / 4,        uint256(spot) * 4));
        timeToExp = uint32(bound(timeToExp, TIME_TYPICAL_LO, TIME_TYPICAL_HI));
        vol       = uint64(bound(vol,        VOL_TYPICAL_LO,  VOL_TYPICAL_HI));
        rate      = uint64(bound(rate,       RATE_TYPICAL_LO, RATE_TYPICAL_HI));
        return (spot, strike, timeToExp, vol, rate);
    }

    // ====================================================================
    // Monotonicity — output ordering preserved with one input varied
    // ====================================================================

    /// Binary call price is monotone non-decreasing in spot (positive δcall).
    /// Constrain spotHi ≤ 5·spotLo so the strike intersection [spotHi/4, spotLo*4]
    /// stays non-empty across both contract validations.
    function test_MONO_callIncreasingInSpot(uint128 spotLo, uint128 spotHi, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        spotLo = uint128(bound(spotLo, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI / 5));
        spotHi = uint128(bound(spotHi, uint256(spotLo) + 1, uint256(spotLo) * 5));
        strike = uint128(bound(strike, spotHi / 4, uint256(spotLo) * 4));
        t = uint32(bound(t, TIME_TYPICAL_LO, TIME_TYPICAL_HI));
        vol = uint64(bound(vol, VOL_TYPICAL_LO, uint64(2e18)));   // cap at 200% to avoid CDF saturation
        rate = uint64(bound(rate, RATE_TYPICAL_LO, RATE_TYPICAL_HI));
        uint256 cLo = DeFiMathBinary.binaryCallPrice(spotLo, strike, t, vol, rate);
        uint256 cHi = DeFiMathBinary.binaryCallPrice(spotHi, strike, t, vol, rate);
        assertLe(cLo, cHi + _slack(cHi), "binary call not monotone increasing in spot");
    }

    /// Binary put price is monotone non-increasing in spot (negative δput).
    function test_MONO_putDecreasingInSpot(uint128 spotLo, uint128 spotHi, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        spotLo = uint128(bound(spotLo, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI / 5));
        spotHi = uint128(bound(spotHi, uint256(spotLo) + 1, uint256(spotLo) * 5));
        strike = uint128(bound(strike, spotHi / 4, uint256(spotLo) * 4));
        t = uint32(bound(t, TIME_TYPICAL_LO, TIME_TYPICAL_HI));
        vol = uint64(bound(vol, VOL_TYPICAL_LO, uint64(2e18)));
        rate = uint64(bound(rate, RATE_TYPICAL_LO, RATE_TYPICAL_HI));
        uint256 pLo = DeFiMathBinary.binaryPutPrice(spotLo, strike, t, vol, rate);
        uint256 pHi = DeFiMathBinary.binaryPutPrice(spotHi, strike, t, vol, rate);
        assertGe(pLo + _slack(pLo), pHi, "binary put not monotone decreasing in spot");
    }

    /// Binary call price is monotone non-increasing in strike (higher strike →
    /// harder to be ITM at expiry).
    function test_MONO_callDecreasingInStrike(uint128 spot, uint128 strikeLo, uint128 strikeHi, uint32 t, uint64 vol, uint64 rate) public pure {
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        strikeLo = uint128(bound(strikeLo, spot / 4, uint256(spot) * 2));
        strikeHi = uint128(bound(strikeHi, uint256(strikeLo) + 1, uint256(spot) * 4));
        t = uint32(bound(t, TIME_TYPICAL_LO, TIME_TYPICAL_HI));
        vol = uint64(bound(vol, VOL_TYPICAL_LO, uint64(2e18)));
        rate = uint64(bound(rate, RATE_TYPICAL_LO, RATE_TYPICAL_HI));
        uint256 cLo = DeFiMathBinary.binaryCallPrice(spot, strikeLo, t, vol, rate);
        uint256 cHi = DeFiMathBinary.binaryCallPrice(spot, strikeHi, t, vol, rate);
        assertGe(cLo + _slack(cLo), cHi, "binary call not monotone decreasing in strike");
    }

    /// Binary put price is monotone non-decreasing in strike.
    function test_MONO_putIncreasingInStrike(uint128 spot, uint128 strikeLo, uint128 strikeHi, uint32 t, uint64 vol, uint64 rate) public pure {
        spot = uint128(bound(spot, SPOT_TYPICAL_LO, SPOT_TYPICAL_HI));
        strikeLo = uint128(bound(strikeLo, spot / 4, uint256(spot) * 2));
        strikeHi = uint128(bound(strikeHi, uint256(strikeLo) + 1, uint256(spot) * 4));
        t = uint32(bound(t, TIME_TYPICAL_LO, TIME_TYPICAL_HI));
        vol = uint64(bound(vol, VOL_TYPICAL_LO, uint64(2e18)));
        rate = uint64(bound(rate, RATE_TYPICAL_LO, RATE_TYPICAL_HI));
        uint256 pLo = DeFiMathBinary.binaryPutPrice(spot, strikeLo, t, vol, rate);
        uint256 pHi = DeFiMathBinary.binaryPutPrice(spot, strikeHi, t, vol, rate);
        assertLe(pLo, pHi + _slack(pHi), "binary put not monotone increasing in strike");
    }

    // ====================================================================
    // Known identities — algebraic relationships that hold for any input
    // ====================================================================

    /// Binary put-call parity: BC + BP == e^(-r·T).
    /// Holds independent of spot, strike, vol — the binary's defining identity since
    /// either the call OR put pays out (mutually exclusive, summing to the discount).
    function test_ID_binaryParity(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        uint256 bc = DeFiMathBinary.binaryCallPrice(spot, strike, t, vol, rate);
        uint256 bp = DeFiMathBinary.binaryPutPrice(spot, strike, t, vol, rate);
        // e^(-r·T) in FP18
        uint256 timeYear = uint256(t) * FP_ONE / 31536000;
        uint256 discount = FP_ONE * FP_ONE / DeFiMath.expPositive(uint256(rate) * timeYear / FP_ONE);
        assertApproxEqRel(bc + bp, discount, REL_1e_10, "binary parity violated: BC + BP != e^(-rT)");
    }

    /// δcall + δput == 0 (since BC + BP is constant in spot).
    function test_ID_deltaSumZero(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        (int128 dC, int128 dP) = DeFiMathBinary.binaryDelta(spot, strike, t, vol, rate);
        // Library directly enforces deltaPut = -deltaCall; sum must be exact zero.
        assertEq(int256(dC) + int256(dP), int256(0), "binary delta sum != 0");
    }

    /// θcall + θput == r · e^(-rT) / 365 (per-day theta carry identity, since the
    /// binary parity's time-derivative is r·e^(-rT)/year).
    function test_ID_thetaCarryIdentity(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        (int128 thC, int128 thP) = DeFiMathBinary.binaryTheta(spot, strike, t, vol, rate);
        uint256 timeYear = uint256(t) * FP_ONE / 31536000;
        uint256 discount = FP_ONE * FP_ONE / DeFiMath.expPositive(uint256(rate) * timeYear / FP_ONE);
        // expected = rate · e^(-rT) / 365 (per-day)
        int256 expected = int256(uint256(rate) * discount / FP_ONE) / 365;
        int256 actual = int256(thC) + int256(thP);
        // 1e9 wei absolute slack — theta is small in $/day; carry identity holds tight.
        assertApproxEqAbs(actual, expected, 1e10, "binary theta carry identity violated");
    }

    // ====================================================================
    // Output bounds — no-arbitrage and sign constraints
    // ====================================================================

    /// 0 ≤ binary call ≤ 1 (unit payout cap; tighter: ≤ e^(-rT) ≤ 1 for r ≥ 0).
    function test_BNDS_callPriceInUnitRange(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        uint256 bc = DeFiMathBinary.binaryCallPrice(spot, strike, t, vol, rate);
        assertLe(bc, FP_ONE, "binary call > 1 (unit payout violation)");
    }

    /// 0 ≤ binary put ≤ 1.
    function test_BNDS_putPriceInUnitRange(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        uint256 bp = DeFiMathBinary.binaryPutPrice(spot, strike, t, vol, rate);
        assertLe(bp, FP_ONE, "binary put > 1");
    }

    /// δcall ≥ 0 — binary call delta is non-negative (more spot → more likely ITM).
    function test_BNDS_deltaCallNonNegative(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        (int128 dC, ) = DeFiMathBinary.binaryDelta(spot, strike, t, vol, rate);
        assertGe(int256(dC), int256(0), "binary delta_call < 0");
    }

    /// δput ≤ 0 — binary put delta is non-positive (more spot → less likely ITM for put).
    function test_BNDS_deltaPutNonPositive(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        (, int128 dP) = DeFiMathBinary.binaryDelta(spot, strike, t, vol, rate);
        assertLe(int256(dP), int256(0), "binary delta_put > 0");
    }

    // ====================================================================
    // Symmetries — Greek pairs that sum to zero by binary parity
    // ====================================================================

    /// γcall == -γput. Since BC + BP is independent of spot, the second derivative
    /// wrt spot sums to zero. Unlike vanilla options where γcall == γput.
    function test_SYM_gammaOppositeSigns(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        (int128 gC, int128 gP) = DeFiMathBinary.binaryGamma(spot, strike, t, vol, rate);
        assertEq(int256(gC) + int256(gP), int256(0), "binary gamma sum != 0");
    }

    /// νcall == -νput. Since BC + BP is independent of vol, dvegasum = 0.
    function test_SYM_vegaOppositeSigns(uint128 spot, uint128 strike, uint32 t, uint64 vol, uint64 rate) public pure {
        (spot, strike, t, vol, rate) = _boundInputs(spot, strike, t, vol, rate);
        (int128 vC, int128 vP) = DeFiMathBinary.binaryVega(spot, strike, t, vol, rate);
        assertEq(int256(vC) + int256(vP), int256(0), "binary vega sum != 0");
    }
}
