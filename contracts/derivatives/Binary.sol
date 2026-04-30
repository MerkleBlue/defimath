// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../math/Math.sol";

/// @title DeFiMathBinary: Binary Options Pricing Library for Solidity
/// @notice Computes binary (cash-or-nothing) option prices using the Black-Scholes model
/// @dev All values are in 18-decimal fixed-point format unless otherwise stated. Payout is fixed at 1.
library DeFiMathBinary {

    // constants
    /// @notice Number of seconds in a year (365 days)
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    /// @notice Precomputed value of sqrt(2π) ≈ 2.5066e18
    uint256 internal constant SQRT_2PI = 2506628274631000502;

    // limits
    /// @notice Minimum allowed spot price: 0.000001 USD
    uint256 internal constant MIN_SPOT = 1e12 - 1;

    /// @notice Maximum allowed spot price: 1 quadrillion USD
    uint256 internal constant MAX_SPOT = 1e33 + 1;

    /// @notice Maximum strike/spot ratio (5x and 1/5x range)
    uint256 internal constant MAX_SS_RATIO = 5;

    /// @notice Maximum allowed time to expiration: 2 years in seconds
    uint256 internal constant MAX_EXPIRATION = 63072000 + 1;

    /// @notice Maximum allowed risk-free interest rate (400%)
    uint256 internal constant MAX_RATE = 4e18 + 1;

    // errors
    /// @notice Reverts when spot price is below the allowed minimum
    error SpotLowerBoundError();

    /// @notice Reverts when spot price exceeds the allowed maximum
    error SpotUpperBoundError();

    /// @notice Reverts when strike is too low relative to spot
    error StrikeLowerBoundError();

    /// @notice Reverts when strike is too high relative to spot
    error StrikeUpperBoundError();

    /// @notice Reverts when time to expiration exceeds 2 years
    error TimeToExpiryUpperBoundError();

    /// @notice Reverts when risk-free rate exceeds 400%
    error RateUpperBoundError();


    /// @notice Computes the price of a binary cash-or-nothing call option using the Black-Scholes model
    /// @dev Formula: price = e^(-r*τ) * Φ(d2). Payout is fixed at 1; multiply externally for other payouts.
    /// @param spot Current spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return price Binary call option price for unit payout (scaled by 1e18)
    function getBinaryCallPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 price) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_SS_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_SS_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExpirySec) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired binary call
            if (timeToExpirySec == 0) {
                if (spot > strike) {
                    return 1e18;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            price = DeFiMath.stdNormCDF(d2) * 1e18 / DeFiMath.expPositive(scaledRate);  // e^(-r*τ) * Φ(d2)
        }
    }

    /// @notice Computes the price of a binary cash-or-nothing put option using the Black-Scholes model
    /// @dev Formula: price = e^(-r*τ) * Φ(-d2). Payout is fixed at 1; multiply externally for other payouts.
    /// @param spot Current spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return price Binary put option price for unit payout (scaled by 1e18)
    function getBinaryPutPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 price) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_SS_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_SS_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExpirySec) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired binary put
            if (timeToExpirySec == 0) {
                if (strike > spot) {
                    return 1e18;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            price = DeFiMath.stdNormCDF(-d2) * 1e18 / DeFiMath.expPositive(scaledRate); // e^(-r*τ) * Φ(-d2)
        }
    }

    /// @notice Computes Delta for binary cash-or-nothing call and put options
    /// @dev Formula: ΔCall = e^(-r*τ) * φ(d2) / (S*σ*√τ); ΔPut = -ΔCall. Payout is fixed at 1.
    /// @param spot Spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return deltaCall Binary call option delta for unit payout (scaled by 1e18)
    /// @return deltaPut Binary put option delta for unit payout (scaled by 1e18)
    function getBinaryDelta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (int128 deltaCall, int128 deltaPut) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_SS_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_SS_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExpirySec) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option
            if (timeToExpirySec == 0) {
                return (0, 0);
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            // e^(-r*τ) * φ(d2) / (S * σ * √τ)
            uint256 absDelta = (1e36 / DeFiMath.expPositive(scaledRate))
                             * (DeFiMath.exp(-d2 * d2 / 2e18) * 1e18 / SQRT_2PI)
                             / (uint256(spot) * scaledVol / 1e18);

            deltaCall = int128(int256(absDelta));
            deltaPut = -deltaCall;
        }
    }

    /// @notice Computes Gamma for binary cash-or-nothing call and put options
    /// @dev Formula: ΓCall = -e^(-r*τ) * φ(d2) * d1 / (S² * σ²*τ); ΓPut = -ΓCall. Payout is fixed at 1.
    /// @dev Note: binary gamma is signed and changes sign at ATM (d1 = 0)
    /// @param spot Spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return gammaCall Binary call option gamma for unit payout (scaled by 1e18)
    /// @return gammaPut Binary put option gamma for unit payout (scaled by 1e18)
    function getBinaryGamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (int128 gammaCall, int128 gammaPut) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_SS_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_SS_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExpirySec) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option
            if (timeToExpirySec == 0) {
                return (0, 0);
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            // |γ| = e^(-r*τ) * φ(d2) * |d1| / (S * σ * √τ)²; sign of γ_call = -sign(d1)
            uint256 svS = uint256(spot) * scaledVol / 1e18;                                            // (S * σ√τ) × 1e18

            uint256 num = (1e36 / DeFiMath.expPositive(scaledRate))                                    // e^(-r*τ) × 1e18
                        * (DeFiMath.exp(-d2 * d2 / 2e18) * 1e18 / SQRT_2PI) / 1e18                     // × φ(d2) → × 1e18
                        * uint256(d1 >= 0 ? d1 : -d1);                                                 // × |d1| × 1e18 → × 1e36

            uint256 absGamma = svS == 0 ? 0 : num * 1e18 / (svS * svS);                                // × 1e18 / ((S·σ√τ)² × 1e36) → × 1e18

            gammaCall = int128(d1 >= 0 ? -int256(absGamma) : int256(absGamma));
            gammaPut = -gammaCall;
        }
    }

    /// @notice Computes Theta for binary cash-or-nothing call and put options (per day)
    /// @dev Formula (per year):
    ///      Θ_call = r·e^(-r*τ)·Φ(d2) + e^(-r*τ)·φ(d2)·(d1/(2τ) - r/(σ√τ))
    ///      Θ_put  = r·e^(-r*τ)·Φ(-d2) - e^(-r*τ)·φ(d2)·(d1/(2τ) - r/(σ√τ))
    ///      Returned values are per-day (divided by 365). Payout is fixed at 1.
    /// @param spot Spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return thetaCall Binary call option theta per day for unit payout (scaled by 1e18)
    /// @return thetaPut Binary put option theta per day for unit payout (scaled by 1e18)
    function getBinaryTheta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (int128 thetaCall, int128 thetaPut) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_SS_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_SS_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExpirySec) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option
            if (timeToExpirySec == 0) {
                return (0, 0);
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)

            return _binaryThetaCore(spot, strike, scaledVol, uint256(rate) * timeYear / 1e18, timeYear, rate);
        }
    }

    /// @dev Core binary theta math, separated to keep stack shallow
    function _binaryThetaCore(
        uint128 spot,
        uint128 strike,
        uint256 scaledVol,
        uint256 scaledRate,
        uint256 timeYear,
        uint64 rate
    ) private pure returns (int128 thetaCall, int128 thetaPut) {
        unchecked {
            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discount = 1e36 / DeFiMath.expPositive(scaledRate);                                // e^(-r*τ) × 1e18
            uint256 phi = DeFiMath.exp(-d2 * d2 / 2e18) * 1e18 / SQRT_2PI;                             // φ(d2) × 1e18

            // term = e^(-r*τ) · φ(d2) · (d1/(2τ) - r/(σ√τ))
            // d1/(2τ) - r/(σ√τ) in 18-dec: d1*1e18/(2*timeYear) - rate*1e18/scaledVol
            int256 dDecay = d1 * 1e18 / int256(2 * timeYear) - int256(uint256(rate) * 1e18 / scaledVol);
            int256 term = int256(discount * phi / 1e18) * dDecay / 1e18;                              // 18-dec, signed

            // carry_call = r · e^(-r*τ) · Φ(d2);  carry_put uses Φ(-d2)
            int256 carryCall = int256(uint256(rate) * discount / 1e18 * DeFiMath.stdNormCDF(d2) / 1e18);
            int256 carryPut  = int256(uint256(rate) * discount / 1e18 * DeFiMath.stdNormCDF(-d2) / 1e18);

            thetaCall = int128((carryCall + term) / 365);
            thetaPut  = int128((carryPut  - term) / 365);
        }
    }
}
