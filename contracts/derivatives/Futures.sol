// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../math/Math.sol";

/// @title DeFiMathFutures: Futures Pricing Library for Solidity
/// @notice Provides a gas-efficient method for calculating futures contract prices using continuous compounding
/// @dev All values are in 18-decimal fixed-point format unless otherwise noted
library DeFiMathFutures {

    /// @notice Number of seconds in a year (365 days)
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    // limits
    /// @notice Minimum allowed spot price: 0.000001 USD
    uint256 internal constant MIN_SPOT = 1e12 - 1;

    /// @notice Maximum allowed spot price: 1 quadrillion USD
    uint256 internal constant MAX_SPOT = 1e33 + 1;

    /// @notice Maximum allowed time to expiration: 2 years in seconds
    uint256 internal constant MAX_EXPIRATION = 63072000 + 1;

    /// @notice Maximum allowed risk-free interest rate (400%)
    uint256 internal constant MAX_RATE = 4e18 + 1;

    // errors
    /// @notice Reverts when spot price is below the allowed minimum
    error SpotLowerBoundError();

    /// @notice Reverts when spot price exceeds the allowed maximum
    error SpotUpperBoundError();

    /// @notice Reverts when time to expiration exceeds 2 years
    error TimeToExpiryUpperBoundError();

    /// @notice Reverts when risk-free rate exceeds 400%
    error RateUpperBoundError();


    /// @notice Computes the fair price of a futures contract using continuous compounding
    /// @param spot Current spot price of the underlying asset (scaled by 1e18)
    /// @param timeToExpirySec Time to contract expiration in seconds
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return price Futures price (scaled by 1e18)
    function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint64 rate) internal pure returns (uint256) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (MAX_EXPIRATION <= timeToExpirySec) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired future 
            if (timeToExpirySec == 0) {
                return spot;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate
            return uint256(spot) * DeFiMath.expPositive(scaledRate) / 1e18;
        }
    }
}
