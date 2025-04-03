// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../math/OpenMath.sol";

library OpenFutures {

    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    // limits
    uint256 internal constant MIN_SPOT = 1e12 - 1;               // 1 milionth of a $
    uint256 internal constant MAX_SPOT = 1e33 + 1;               // 1 quadrillion $
    uint256 internal constant MAX_EXPIRATION = 63072000 + 1;     // 2 years
    uint256 internal constant MAX_RATE = 4e18 + 1;               // 400% risk-free rate

    // errors
    error SpotLowerBoundError();
    error SpotUpperBoundError();
    error TimeToExpiryUpperBoundError();
    error RateUpperBoundError();


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
}
