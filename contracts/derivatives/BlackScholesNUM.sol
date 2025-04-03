// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../math/OpenMath.sol";

// Uncomment this line to use console.log
import "hardhat/console.sol";

library BlackScholesNUM {

    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    // limits
    uint256 internal constant MIN_SPOT = 1e12 - 1;               // 1 milionth of a $
    uint256 internal constant MAX_SPOT = 1e33 + 1;               // 1 quadrillion $
    uint256 internal constant MAX_SS_RATIO = 5;                  // 1/5x to 5x strike/spot ratio
    uint256 internal constant MAX_EXPIRATION = 63072000 + 1;     // 2 years
    uint256 internal constant MAX_RATE = 4e18 + 1;               // 400% risk-free rate

    // errors
    error SpotLowerBoundError();
    error SpotUpperBoundError();
    error StrikeLowerBoundError();
    error StrikeUpperBoundError();
    error TimeToExpiryUpperBoundError();
    error RateUpperBoundError();

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

            // handle expired option 
            if (timeToExpirySec == 0) {
                if (spot > strike) {
                    return spot - strike;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * OpenMath.sqrt(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (OpenMath.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / OpenMath.expPositive(scaledRate);

            uint256 spotNd1 = uint256(spot) * OpenMath.stdNormCDF(d1);              // spot * N(d1)
            uint256 strikeNd2 = discountedStrike * OpenMath.stdNormCDF(d2);         // strike * N(d2)

            if (spotNd1 > strikeNd2) {
                price = (spotNd1 - strikeNd2) / 1e18;
            }
        }
    }

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

            // handle expired option 
            if (timeToExpirySec == 0) {
                if (strike > spot) {
                    return strike - spot;
                }
                return 0;
            }

            uint256 timeYear = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * OpenMath.sqrt(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (OpenMath.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / OpenMath.expPositive(scaledRate);

            uint256 spotNd1 = uint256(spot) * OpenMath.stdNormCDF(-d1);             // spot * N(-d1)
            uint256 strikeNd2 = discountedStrike * OpenMath.stdNormCDF(-d2);        // strike * N(-d2)

            if (strikeNd2 > spotNd1) {
                price = (strikeNd2 - spotNd1) / 1e18;
            }
        }
    }

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
            return uint256(spot) * OpenMath.expPositive(scaledRate) / 1e18;
        }
    }

    // todo: not used
    function getD1(uint128 spot, uint128 strike, uint256 scaledVol, uint256 scaledRate) internal pure returns (int256) {
        unchecked {
            // todo: maybe use 1000 + ln... -1000, to avoid conversion to int256
            return (OpenMath.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
        }
    }
}
