// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../math/Math.sol";

/// @title DeFiMathBinary: Binary Options Pricing Library for Solidity
/// @notice Computes binary (cash-or-nothing) option prices using the Black-Scholes model
/// @dev All values are in 18-decimal fixed-point format unless otherwise stated
library DeFiMathBinary {

    // constants
    /// @notice Number of seconds in a year (365 days)
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

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
    /// @dev Formula: price = payout * e^(-r*τ) * Φ(d2)
    /// @param spot Current spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @param payout Cash payout if option expires in-the-money (scaled by 1e18)
    /// @return price Binary call option price (scaled by 1e18)
    function getBinaryCallPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate,
        uint128 payout
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
                    return payout;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedPayout = uint256(payout) * 1e18 / DeFiMath.expPositive(scaledRate);   // payout * e^(-r*τ)

            price = discountedPayout * DeFiMath.stdNormCDF(d2) / 1e18;                              // payout * e^(-r*τ) * Φ(d2)
        }
    }

    /// @notice Computes the price of a binary cash-or-nothing put option using the Black-Scholes model
    /// @dev Formula: price = payout * e^(-r*τ) * Φ(-d2)
    /// @param spot Current spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @param payout Cash payout if option expires in-the-money (scaled by 1e18)
    /// @return price Binary put option price (scaled by 1e18)
    function getBinaryPutPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate,
        uint128 payout
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
                    return payout;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedPayout = uint256(payout) * 1e18 / DeFiMath.expPositive(scaledRate);   // payout * e^(-r*τ)

            price = discountedPayout * DeFiMath.stdNormCDF(-d2) / 1e18;                             // payout * e^(-r*τ) * Φ(-d2)
        }
    }
}
