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

    /// @notice Reverts when rate is below the allowed minimum (for signed-rate conversions)
    error RateLowerBoundError();

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

    /// @notice Continuously-compounded log return: ln(currentPrice / previousPrice)
    /// @dev `rate` is NOT annualized — it is the continuous rate over the implicit period
    ///      between the two prices. Callers wanting an annualized figure should scale by
    ///      (SECONDS_IN_YEAR / periodSec) themselves.
    /// @param currentPrice Latest price observation (scaled by 1e18)
    /// @param previousPrice Earlier reference price (scaled by 1e18)
    /// @return rate Signed continuous rate over the unspecified period (scaled by 1e18)
    function logReturn(uint128 currentPrice, uint128 previousPrice) internal pure returns (int256 rate) {
        unchecked {
            // check inputs
            if (currentPrice <= MIN_PRINCIPAL) revert PriceLowerBoundError();
            if (MAX_PRINCIPAL <= currentPrice) revert PriceUpperBoundError();
            if (previousPrice <= MIN_PRINCIPAL) revert PriceLowerBoundError();
            if (MAX_PRINCIPAL <= previousPrice) revert PriceUpperBoundError();

            rate = DeFiMath.ln(uint256(currentPrice) * 1e18 / uint256(previousPrice));
        }
    }

    /// @notice Convert continuous APR to effective APY: e^APR − 1
    /// @dev Uses expm1 for precision when apr is small; matches `Math.expm1` semantics
    /// @param apr Continuous annual rate (signed, scaled by 1e18, e.g. 0.05e18 = 5% APR)
    /// @return apy Effective annual yield (signed, scaled by 1e18)
    function continuousToDiscrete(int256 apr) internal pure returns (int256 apy) {
        unchecked {
            // check inputs
            if (apr >= int256(MAX_RATE)) revert RateUpperBoundError();
            if (apr <= -int256(MAX_RATE)) revert RateLowerBoundError();

            apy = DeFiMath.expm1(apr);
        }
    }

    /// @notice Convert effective APY to continuous APR: ln(1 + APY)
    /// @dev Uses log1p for precision when apy is small; matches `Math.log1p` semantics
    /// @param apy Effective annual yield (signed, scaled by 1e18, must satisfy apy > -1)
    /// @return apr Continuous annual rate (signed, scaled by 1e18)
    function discreteToContinuous(int256 apy) internal pure returns (int256 apr) {
        unchecked {
            // check inputs
            if (apy >= int256(MAX_RATE)) revert RateUpperBoundError();
            if (apy <= -1e18) revert RateLowerBoundError();

            apr = DeFiMath.log1p(apy);
        }
    }
}
