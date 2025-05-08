// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../math/Math.sol";

/// @title DeFiMathOptions: Options Pricing and Greeks Library for Solidity
/// @notice Computes Black-Scholes option prices and Greeks (Delta, Gamma, Theta, Vega)
/// @dev All values are in 18-decimal fixed-point format unless otherwise stated
library DeFiMathOptions {

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


    /// @notice Computes the price of a European call option using the Black-Scholes model
    /// @param spot Current spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return price Call option price (scaled by 1e18)
    function getCallOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 price) {
        unchecked {
            // todo: maybe have something like scale, and calculate always for $100, and then scale it to the actual spot
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_SS_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_SS_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExpirySec) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired call 
            if (timeToExpirySec == 0) {
                if (spot > strike) {
                    return spot - strike;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / DeFiMath.expPositive(scaledRate); // todo try with exp, could be cheaper

            uint256 spotNd1 = uint256(spot) * DeFiMath.stdNormCDF(d1);              // spot * N(d1)
            uint256 strikeNd2 = discountedStrike * DeFiMath.stdNormCDF(d2);         // strike * N(d2)

            if (spotNd1 > strikeNd2) {
                price = (spotNd1 - strikeNd2) / 1e18;
            }
        }
    }

    /// @notice Computes the price of a European put option using the Black-Scholes model
    /// @param spot Current spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return price Put option price (scaled by 1e18)
    function getPutOptionPrice(
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

            // handle expired put 
            if (timeToExpirySec == 0) {
                if (strike > spot) {
                    return strike - spot;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / DeFiMath.expPositive(scaledRate);

            uint256 spotNd1 = uint256(spot) * DeFiMath.stdNormCDF(-d1);             // spot * N(-d1)
            uint256 strikeNd2 = discountedStrike * DeFiMath.stdNormCDF(-d2);        // strike * N(-d2)

            if (strikeNd2 > spotNd1) {
                price = (strikeNd2 - spotNd1) / 1e18;
            }
        }
    }

    /// @notice Computes Delta for both call and put options (sensitivity to spot price change)
    /// @param spot Spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return deltaCall Call option delta (scaled by 1e18)
    /// @return deltaPut Put option delta (scaled by 1e18)
    function getDelta(
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
                if (spot > strike) {
                    return (1e18, 0);
                }
                return (0, 1e18);
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);

            deltaCall = int128(int256(DeFiMath.stdNormCDF(d1)));
            deltaPut = deltaCall - 1e18;
        }
    }

    /// @notice Computes Gamma of the option (sensitivity to delta change)
    /// @param spot Spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return gamma Option Gamma (scaled by 1e18)
    function getGamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 gamma) {
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
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            uint256 phi = DeFiMath.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)
            gamma = phi * 1e18 / (spot * scaledVol / 1e18);                                         // N'(d1) / (spot * scaledVol)
        }
    }

    /// @notice Computes Theta of the option (time decay per day)
    /// @param spot Spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return thetaCall Call option theta per day (scaled by 1e18)
    /// @return thetaPut Put option theta per day (scaled by 1e18)
    function getTheta(
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

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;                   // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate
            uint256 _spot = uint256(spot);
            uint256 _rate = rate;

            int256 d1 = (DeFiMath.ln16(uint256(_spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / DeFiMath.expPositive(scaledRate);

            uint256 phi = DeFiMath.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)

            int256 timeDecay = int256(_spot * phi * scaledVol / (2e18 * timeYear));             // spot * N'(d1) * sigma / (2 * sqrt(T))

            int256 carryCall = int256(_rate * discountedStrike * DeFiMath.stdNormCDF(d2) / 1e36); 

            int256 carryPut = int256(_rate * discountedStrike * DeFiMath.stdNormCDF(-d2) / 1e36);

            return (int128(-timeDecay - carryCall) / 365, int128(-timeDecay + carryPut) / 365);
        }
    }

    /// @notice Computes Vega of the option (sensitivity to volatility change)
    /// @param spot Spot price of the asset (scaled by 1e18)
    /// @param strike Strike price of the option (scaled by 1e18)
    /// @param timeToExpirySec Time to expiration in seconds
    /// @param volatility Annualized implied volatility (scaled by 1e18)
    /// @param rate Annualized risk-free interest rate (scaled by 1e18)
    /// @return vega Option Vega (scaled by 1e18)
    function getVega(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 vega) {
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
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 sqrtTimeYear = DeFiMath.sqrtTime(timeYear);
            uint256 scaledVol = volatility * DeFiMath.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (DeFiMath.ln16(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);

            uint256 phi = DeFiMath.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)
            vega = spot * sqrtTimeYear * phi / 100e36;                              // N'(d1) * spot * sqrt(T) / 100
        }
    }
}
