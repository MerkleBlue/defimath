// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../math/Math.sol";

/// @title DeFiMathRates: Continuous-compounding interest, present value, and rate conversions
/// @author DeFiMath (https://defimath.com)
/// @notice Scalar finance primitives built on top of DeFiMath's exp / ln / expm1 / log1p.
/// @dev All values are in 18-decimal fixed-point format unless otherwise noted. Time is in seconds.
library DeFiMathRates {

    /// @notice Number of seconds in a year (365 days)
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    // limits
    /// @notice Minimum allowed principal / future value: 0.000001 USD
    uint256 internal constant MIN_PRINCIPAL = 1e12 - 1;

    /// @notice Maximum allowed principal / future value: 1 quadrillion (1e15) in 18-decimal base
    uint256 internal constant MAX_PRINCIPAL = 1e33 + 1;

    /// @notice Maximum allowed time interval: 2 years in seconds
    uint256 internal constant MAX_TIME_INTERVAL = 63072000 + 1;

    /// @notice Maximum allowed annualized rate (400%)
    uint256 internal constant MAX_RATE = 4e18 + 1;

    // errors
    /// @notice Reverts when principal or future value is below the allowed minimum
    error PrincipalLowerBoundError();

    /// @notice Reverts when principal or future value exceeds the allowed maximum
    error PrincipalUpperBoundError();

    /// @notice Reverts when annualized rate exceeds the allowed maximum
    error RateUpperBoundError();

    /// @notice Reverts when time interval exceeds 2 years
    error TimeIntervalUpperBoundError();

    /// @notice Reverts when price input is below the allowed minimum
    error PriceLowerBoundError();

    /// @notice Reverts when price input exceeds the allowed maximum
    error PriceUpperBoundError();

    /// @notice Future value under continuous compounding: P · e^(r·t). Same as futurePrice().
    /// @param principal Initial value (scaled by 1e18)
    /// @param rate Annualized continuous rate (scaled by 1e18, e.g. 0.05e18 = 5% APR)
    /// @param timeInterval Duration in seconds
    /// @return amount Compounded value (scaled by 1e18)
    function compoundInterest(uint128 principal, uint64 rate, uint32 timeInterval) internal pure returns (uint256 amount) {
        unchecked {
            // check inputs
            if (principal <= MIN_PRINCIPAL) revert PrincipalLowerBoundError();
            if (MAX_PRINCIPAL <= principal) revert PrincipalUpperBoundError();
            if (MAX_TIME_INTERVAL <= timeInterval) revert TimeIntervalUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            uint256 timeYear = uint256(timeInterval) * 1e18 / SECONDS_IN_YEAR;
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;
            amount = uint256(principal) * DeFiMath.expPositive(scaledRate) / 1e18;
        }
    }

    /// @notice Present value under continuous discounting: FV · e^(-r·t)
    /// @param futureValue Future value (scaled by 1e18)
    /// @param rate Annualized continuous rate (scaled by 1e18)
    /// @param timeInterval Duration in seconds
    /// @return amount Discounted value (scaled by 1e18)
    function presentValue(uint128 futureValue, uint64 rate, uint32 timeInterval) internal pure returns (uint256 amount) {
        unchecked {
            // check inputs
            if (futureValue <= MIN_PRINCIPAL) revert PrincipalLowerBoundError();
            if (MAX_PRINCIPAL <= futureValue) revert PrincipalUpperBoundError();
            if (MAX_TIME_INTERVAL <= timeInterval) revert TimeIntervalUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            uint256 timeYear = uint256(timeInterval) * 1e18 / SECONDS_IN_YEAR;
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;
            amount = uint256(futureValue) * 1e18 / DeFiMath.expPositive(scaledRate);
        }
    }

    /// @notice Continuously-compounded return: ln(newPrice / oldPrice)
    /// @param newPrice Current price (scaled by 1e18)
    /// @param oldPrice Reference price (scaled by 1e18)
    /// @return Signed log return (scaled by 1e18)
    function logReturn(uint128 newPrice, uint128 oldPrice) internal pure returns (int256) {
        unchecked {
            // check inputs
            if (newPrice <= MIN_PRINCIPAL) revert PriceLowerBoundError();
            if (MAX_PRINCIPAL <= newPrice) revert PriceUpperBoundError();
            if (oldPrice <= MIN_PRINCIPAL) revert PriceLowerBoundError();
            if (MAX_PRINCIPAL <= oldPrice) revert PriceUpperBoundError();

            return DeFiMath.ln(uint256(newPrice) * 1e18 / uint256(oldPrice));
        }
    }

    /// @notice Convert continuous rate to discrete (per-period) rate: e^r − 1
    /// @dev Uses expm1 for precision when r is small; matches `Math.expm1` semantics
    /// @param r Continuous rate (signed, scaled by 1e18)
    /// @return Discrete equivalent (signed, scaled by 1e18)
    function continuousToDiscrete(int256 r) internal pure returns (int256) {
        unchecked {
            return DeFiMath.expm1(r);
        }
    }

    /// @notice Convert discrete (per-period) rate to continuous rate: ln(1 + r)
    /// @dev Uses log1p for precision when r is small; matches `Math.log1p` semantics
    /// @param r Discrete rate (signed, scaled by 1e18, must satisfy r > -1)
    /// @return Continuous equivalent (signed, scaled by 1e18)
    function discreteToContinuous(int256 r) internal pure returns (int256) {
        unchecked {
            return DeFiMath.log1p(r);
        }
    }
}
