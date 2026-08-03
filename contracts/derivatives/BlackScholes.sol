// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../math/Math.sol";

/// @title BlackScholes: Black-Scholes Pricing and Greeks Library for Solidity
/// @author DeFiMath (https://defimath.com)
/// @notice Computes Black-Scholes option prices and Greeks (Delta, Gamma, Theta, Vega)
/// @dev All values are in 18-decimal fixed-point format unless otherwise stated
library BlackScholes {

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
    uint256 internal constant MAX_STSP_RATIO = 5;

    /// @notice Maximum allowed time to expiration: 32 years in seconds
    uint256 internal constant MAX_EXPIRATION = 32 * SECONDS_IN_YEAR + 1;

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

    /// @notice Reverts when time to expiration exceeds 32 years
    error TimeToExpiryUpperBoundError();

    /// @notice Reverts when time to expiration is 0 (used in IV calculation)
    error TimeToExpiryLowerBoundError();

    /// @notice Reverts when risk-free rate exceeds 400%
    error RateUpperBoundError();

    /// @notice Reverts when option price is outside no-arbitrage bounds for IV
    error PriceOutOfBoundsError();

    /// @notice Reverts when Newton-Raphson IV solver fails to converge
    error NoConvergenceError();


    /// @notice Computes the price of a European call option using the Black-Scholes model.
    /// @dev Reverts outside the supported domain: spot in (1e-6, 1e15) USD, strike within 5x of spot
    ///      either way, time to expiration < 32 years, and rate < 400%. When expired (timeToExp == 0),
    ///      returns the intrinsic value max(spot - strike, 0).
    ///      Max relative error: < 5e-12 for any price >= 1e18.
    ///      Max absolute error: < 1.3e-10 for any price < 1e18.
    /// @param spot Current spot price of the asset in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return price Call option price in 18-decimal fixed-point format.
    function call(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 price) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired call 
            if (timeToExp == 0) {
                return spot > strike ? spot - strike : 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (Math.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / Math.expPositive(scaledRate); // todo try with exp, could be cheaper

            uint256 spotNd1 = uint256(spot) * Math.stdNormCDF(d1);              // spot * N(d1)
            uint256 strikeNd2 = discountedStrike * Math.stdNormCDF(d2);         // strike * N(d2)

            price = spotNd1 >= strikeNd2 ? (spotNd1 - strikeNd2) / 1e18 : 0;
        }
    }

    /// @notice Computes the price of a European put option using the Black-Scholes model.
    /// @dev Reverts outside the supported domain: spot in (1e-6, 1e15) USD, strike within 5x of spot
    ///      either way, time to expiration < 32 years, and rate < 400%. When expired (timeToExp == 0),
    ///      returns the intrinsic value max(strike - spot, 0).
    ///      Max relative error: < 5e-12 for any price >= 1e18.
    ///      Max absolute error: < 1.3e-10 for any price < 1e18.
    /// @param spot Current spot price of the asset in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return price Put option price in 18-decimal fixed-point format.
    function put(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 price) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired put 
            if (timeToExp == 0) {
                return strike > spot ? strike - spot : 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (Math.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / Math.expPositive(scaledRate);

            uint256 spotNd1 = uint256(spot) * Math.stdNormCDF(-d1);             // spot * N(-d1)
            uint256 strikeNd2 = discountedStrike * Math.stdNormCDF(-d2);        // strike * N(-d2)

            price = strikeNd2 >= spotNd1 ? (strikeNd2 - spotNd1) / 1e18 : 0;
        }
    }

    /// @notice Computes Delta for both call and put options using the Black-Scholes model (sensitivity to spot price change).
    /// @dev Reverts outside the supported domain: spot in (1e-6, 1e15) USD, strike within 5x of spot
    ///      either way, time to expiration < 32 years, and rate < 400%. Delta is bounded to [-1, 1],
    ///      so only an absolute error applies.
    ///      Max absolute error: < 1.2e-13.
    /// @param spot Spot price of the asset in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return deltaCall Call option delta in 18-decimal fixed-point format.
    /// @return deltaPut Put option delta in 18-decimal fixed-point format.
    function delta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (int128 deltaCall, int128 deltaPut) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option 
            if (timeToExp == 0) {
                if (spot > strike) {
                    return (1e18, 0);
                }
                return (0, 1e18);
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (Math.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);

            deltaCall = int128(int256(Math.stdNormCDF(d1)));
            deltaPut = deltaCall - 1e18;
        }
    }

    /// @notice Computes Gamma of the option using the Black-Scholes model (sensitivity to delta change).
    /// @dev Reverts outside the supported domain: spot in (1e-6, 1e15) USD, strike within 5x of spot
    ///      either way, time to expiration < 32 years, and rate < 400%.
    ///      Max relative error: < 5e-12 for any gamma >= 1e18.
    ///      Max absolute error: < 3.2e-15 for any gamma < 1e18.
    /// @param spot Spot price of the asset in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return gammaOut Option Gamma in 18-decimal fixed-point format.
    function gamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 gammaOut) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option 
            if (timeToExp == 0) {
                return 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (Math.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            uint256 phi = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)
            gammaOut = phi * 1e18 / (spot * scaledVol / 1e18);                                       // N'(d1) / (spot * scaledVol)
        }
    }

    /// @notice Computes Theta of the option using the Black-Scholes model (time decay per day).
    /// @dev Reverts outside the supported domain: spot in (1e-6, 1e15) USD, strike within 5x of spot
    ///      either way, time to expiration < 32 years, and rate < 400%. Theta is expressed per day.
    ///      Max relative error: < 5e-12 for any |theta| >= 1e18.
    ///      Max absolute error: < 1.9e-12 for any |theta| < 1e18.
    /// @param spot Spot price of the asset in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return thetaCall Call option theta per day in 18-decimal fixed-point format.
    /// @return thetaPut Put option theta per day in 18-decimal fixed-point format.
    function theta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (int128 thetaCall, int128 thetaPut) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option 
            if (timeToExp == 0) {
                return (0, 0);
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;                   // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate
            uint256 _spot = uint256(spot);
            uint256 _rate = rate;

            int256 d1 = (Math.ln(uint256(_spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 discountedStrike = uint256(strike) * 1e18 / Math.expPositive(scaledRate);

            uint256 phi = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)

            int256 timeDecay = int256(_spot * phi * scaledVol / (2e18 * timeYear));             // spot * N'(d1) * sigma / (2 * sqrt(T))

            int256 carryCall = int256(_rate * discountedStrike * Math.stdNormCDF(d2) / 1e36); 

            int256 carryPut = int256(_rate * discountedStrike * Math.stdNormCDF(-d2) / 1e36);

            return (int128(-timeDecay - carryCall) / 365, int128(-timeDecay + carryPut) / 365);
        }
    }

    /// @notice Computes Vega of the option using the Black-Scholes model (sensitivity to volatility change).
    /// @dev Reverts outside the supported domain: spot in (1e-6, 1e15) USD, strike within 5x of spot
    ///      either way, time to expiration < 32 years, and rate < 400%. Vega is expressed per 1% change in volatility.
    ///      Max relative error: < 5e-12 for any vega >= 1e18.
    ///      Max absolute error: < 4e-13 for any vega < 1e18.
    /// @param spot Spot price of the asset in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return vegaOut Option Vega in 18-decimal fixed-point format.
    function vega(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 vegaOut) {
        unchecked {
            // check inputs
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option 
            if (timeToExp == 0) {
                return 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;   // annualized time to expiration
            uint256 sqrtTimeYear = Math.sqrtTime(timeYear);
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                   // time-adjusted rate

            int256 d1 = (Math.ln(uint256(spot) * 1e18 / uint256(strike)) + int256(scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);

            uint256 phi = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)
            vegaOut = spot * sqrtTimeYear * phi / 100e36;                           // N'(d1) * spot * sqrt(T) / 100
        }
    }

    /// @notice Minimum IV bound (0.01%)
    uint256 internal constant MIN_VOL_IV = 1e14;

    /// @notice Maximum IV bound (1800%)
    uint256 internal constant MAX_VOL_IV = 18e18;

    /// @notice Convergence tolerance (price diff in 18-decimal)
    uint256 internal constant IV_TOLERANCE = 1e6 - 1;

    /// @notice Maximum Newton-Raphson iterations
    uint256 internal constant IV_MAX_ITER = 30;

    /// @notice Holds precomputed values used by IV iteration
    struct IVState {
        uint256 spot;
        uint256 sqrtTimeYear;
        uint256 scaledRate;
        uint256 discountedStrike;
        int256 lnSK;
        uint256 vegaBase;       // spot * sqrtTimeYear / 1e18 — leading factor of vega
        uint256 optionPrice;
        bool isCall;
    }

    /// @notice Computes implied volatility from a market option price using Newton-Raphson.
    /// @dev Solves for σ such that BS(σ) = optionPrice via Newton-Raphson (fixed 55% seed, up to 30
    ///      iterations, price tolerance ~1e6 wei), clamping the result to [0.01%, 1800%] volatility.
    ///      Reverts outside the supported domain: spot in (1e-6, 1e15) USD, strike within 5x of spot
    ///      either way, time to expiration in (0, 32 years), and rate < 400%. Also reverts if optionPrice
    ///      is outside the no-arbitrage range, or if the solver fails to converge within 30 iterations.
    ///      Max relative error: < 1e-6 for any volatility >= 1e18.
    ///      Max absolute error: < 2e-6 for any volatility < 1e18.
    /// @param spot Spot price of the asset in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds (must be > 0).
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @param optionPrice Observed market price of the option in 18-decimal fixed-point format.
    /// @param isCall True for call option, false for put.
    /// @return volatility Implied volatility in 18-decimal fixed-point format.
    function impliedVolatility(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) internal pure returns (uint256 volatility) {
        unchecked {
            // input checks
            if (spot <= MIN_SPOT) revert SpotLowerBoundError();
            if (MAX_SPOT <= spot) revert SpotUpperBoundError();
            if (spot * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();
            if (uint256(strike) * MAX_STSP_RATIO < spot) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();
            if (timeToExp == 0) revert TimeToExpiryLowerBoundError();

            IVState memory s;
            s.spot = spot;
            s.optionPrice = optionPrice;
            s.isCall = isCall;
            {
                uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;
                s.sqrtTimeYear = Math.sqrtTime(timeYear);
                s.scaledRate = uint256(rate) * timeYear / 1e18;
            }
            s.discountedStrike = uint256(strike) * 1e18 / Math.expPositive(s.scaledRate);
            s.lnSK = Math.ln(uint256(spot) * 1e18 / uint256(strike));
            s.vegaBase = uint256(spot) * s.sqrtTimeYear / 1e18;

            if (isCall) {
                // No-arbitrage bound check
                uint256 lower = spot > s.discountedStrike ? spot - s.discountedStrike : 0;
                uint256 upper = uint256(spot);
                if (optionPrice <= lower || optionPrice >= upper) revert PriceOutOfBoundsError();

                return _ivCallIterate(s);
            } else {
                // No-arbitrage bound check
                uint256 lower = s.discountedStrike > spot ? s.discountedStrike - spot : 0;
                uint256 upper = s.discountedStrike;
                if (optionPrice <= lower || optionPrice >= upper) revert PriceOutOfBoundsError();

                return _ivPutIterate(s);
            }
        }
    }

    /// @dev Newton-Raphson iteration loop
    function _ivCallIterate(IVState memory s) private pure returns (uint256 sigma) {
        unchecked {
            // Manaster-Koehler initial guess: σ₀ = √(2·|ln(S/K) + rτ| / τ)
            // Approximated here as a fixed 0.55 (55%) for simplicity — converges in 5–10 iterations across the typical range.
            sigma = 55e16;

            for (uint256 i = 0; i < IV_MAX_ITER; i++) {
                
                (uint256 price, uint256 vegaOut) = _callPriceAndVega(s, sigma);

                // diff = price - optionPrice
                int256 diff = int256(price) - int256(s.optionPrice);
                uint256 absDiff = diff >= 0 ? uint256(diff) : uint256(-diff);
                if (absDiff <= IV_TOLERANCE) return sigma;

                if (vegaOut < 1e6) revert NoConvergenceError();   // vega too small to invert

                // step = diff / vega (signed, in 18-dec)
                int256 step = diff * 1e18 / int256(vegaOut);

                int256 newSigma = int256(sigma) - step;
                if (newSigma < int256(MIN_VOL_IV)) newSigma = int256(MIN_VOL_IV);
                if (newSigma > int256(MAX_VOL_IV)) newSigma = int256(MAX_VOL_IV);
                sigma = uint256(newSigma);
            }
            revert NoConvergenceError();
        }
    }

    /// @dev Newton-Raphson iteration loop
    function _ivPutIterate(IVState memory s) private pure returns (uint256 sigma) {
        unchecked {
            // Manaster-Koehler initial guess: σ₀ = √(2·|ln(S/K) + rτ| / τ)
            // Approximated here as a fixed 0.55 (55%) for simplicity — converges in 5–10 iterations across the typical range.
            sigma = 55e16;

            for (uint256 i = 0; i < IV_MAX_ITER; i++) {
                
                (uint256 price, uint256 vegaOut) = _putPriceAndVega(s, sigma);

                // diff = price - optionPrice
                int256 diff = int256(price) - int256(s.optionPrice);
                uint256 absDiff = diff >= 0 ? uint256(diff) : uint256(-diff);
                if (absDiff <= IV_TOLERANCE) return sigma;

                if (vegaOut < 1e6) revert NoConvergenceError();   // vega too small to invert

                // step = diff / vega (signed, in 18-dec)
                int256 step = diff * 1e18 / int256(vegaOut);

                int256 newSigma = int256(sigma) - step;
                if (newSigma < int256(MIN_VOL_IV)) newSigma = int256(MIN_VOL_IV);
                if (newSigma > int256(MAX_VOL_IV)) newSigma = int256(MAX_VOL_IV);
                sigma = uint256(newSigma);
            }
            revert NoConvergenceError();
        }
    }

    /// @dev Computes call option price and per-unit-vol vega at given σ. Reuses precomputed state.
    function _callPriceAndVega(IVState memory s, uint256 sigma) private pure returns (uint256 price, uint256 vegaOut) {
        unchecked {
            uint256 scaledVol = sigma * s.sqrtTimeYear / 1e18 + 1;
            int256 d1 = (s.lnSK + int256(s.scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            // vega per unit vol = S · sqrt(T) · φ(d1) = vegaBase · φ(d1)
            uint256 phiD1 = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;
            vegaOut = s.vegaBase * phiD1 / 1e18;

            // price
            uint256 spotNd1 = s.spot * Math.stdNormCDF(d1);
            uint256 strikeNd2 = s.discountedStrike * Math.stdNormCDF(d2);
            price = spotNd1 > strikeNd2 ? (spotNd1 - strikeNd2) / 1e18 : 0;
        }
    }

    /// @dev Computes put option price and per-unit-vol vega at given σ. Reuses precomputed state.
    function _putPriceAndVega(IVState memory s, uint256 sigma) private pure returns (uint256 price, uint256 vegaOut) {
        unchecked {
            uint256 scaledVol = sigma * s.sqrtTimeYear / 1e18 + 1;
            int256 d1 = (s.lnSK + int256(s.scaledRate + (scaledVol * scaledVol / 2e18))) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            // vega per unit vol = S · sqrt(T) · φ(d1) = vegaBase · φ(d1)
            uint256 phiD1 = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;
            vegaOut = s.vegaBase * phiD1 / 1e18;

            // price
            uint256 spotNd1 = s.spot * Math.stdNormCDF(-d1);
            uint256 strikeNd2 = s.discountedStrike * Math.stdNormCDF(-d2);
            price = strikeNd2 > spotNd1 ? (strikeNd2 - spotNd1) / 1e18 : 0;
        }
    }
}
