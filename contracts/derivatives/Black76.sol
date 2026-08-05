// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../math/Math.sol";

/// @title Black76: Black-76 Pricing and Greeks Library for Solidity
/// @author DeFiMath (https://defimath.com)
/// @notice Computes Black-76 option prices and Greeks (Delta, Gamma, Theta, Vega) on a forward/futures underlying
/// @dev All values are in 18-decimal fixed-point format unless otherwise stated. Black-76 prices options on a
///      forward price F (not spot): d₁ carries no rate term and the whole payoff is discounted by e^(−r·τ),
///      since the forward already embeds the cost of carry. Equivalently, Black-76 = e^(−r·τ) · Black-Scholes(spot = F, rate = 0).
library Black76 {

    // constants
    /// @notice Number of seconds in a year (365 days)
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    /// @notice Precomputed value of sqrt(2π) ≈ 2.5066e18
    uint256 internal constant SQRT_2PI = 2506628274631000502;

    // limits
    /// @notice Minimum allowed forward price: 0.000001 USD
    uint256 internal constant MIN_FORWARD = 1e12 - 1;

    /// @notice Maximum allowed forward price: 1 quadrillion USD
    uint256 internal constant MAX_FORWARD = 1e33 + 1;

    /// @notice Maximum strike/forward ratio (5x and 1/5x range)
    uint256 internal constant MAX_STSP_RATIO = 5;

    /// @notice Maximum allowed time to expiration: 32 years in seconds
    uint256 internal constant MAX_EXPIRATION = 32 * SECONDS_IN_YEAR + 1;

    /// @notice Maximum allowed risk-free interest rate (400%)
    uint256 internal constant MAX_RATE = 4e18 + 1;

    // errors
    /// @notice Reverts when forward price is below the allowed minimum
    error ForwardLowerBoundError();

    /// @notice Reverts when forward price exceeds the allowed maximum
    error ForwardUpperBoundError();

    /// @notice Reverts when strike is too low relative to forward
    error StrikeLowerBoundError();

    /// @notice Reverts when strike is too high relative to forward
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


    /// @notice Computes the price of a European call option on a forward using the Black-76 model.
    /// @dev Formula: price = e^(−r·τ) · [F·Φ(d₁) − K·Φ(d₂)]. Reverts outside the supported domain: forward in
    ///      (1e-6, 1e15) USD, strike within 5x of forward either way, time to expiration < 32 years, and rate < 400%.
    ///      When expired (timeToExp == 0), returns the intrinsic value max(forward − strike, 0).
    ///      Max relative error: < 5e-12 for any price >= 1e18.
    ///      Max absolute error: < 1.3e-10 for any price < 1e18.
    /// @param forward Current forward (futures) price in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return price Call option price in 18-decimal fixed-point format.
    function call(
        uint128 forward,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 price) {
        unchecked {
            // check inputs
            if (forward <= MIN_FORWARD) revert ForwardLowerBoundError();
            if (MAX_FORWARD <= forward) revert ForwardUpperBoundError();
            if (forward * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < forward) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired call
            if (timeToExp == 0) {
                return forward > strike ? forward - strike : 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            // Black-76 d₁ carries no rate term: d₁ = [ln(F/K) + σ²τ/2] / (σ√τ)
            int256 d1 = (Math.ln(uint256(forward) * 1e18 / uint256(strike)) + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 fwdNd1 = uint256(forward) * Math.stdNormCDF(d1);            // F · N(d1), scaled 1e36
            uint256 strikeNd2 = uint256(strike) * Math.stdNormCDF(d2);         // K · N(d2), scaled 1e36
            uint256 bracket = fwdNd1 > strikeNd2 ? fwdNd1 - strikeNd2 : 0;     // F·N(d1) − K·N(d2), scaled 1e36

            // discount the whole payoff by e^(−r·τ): bracket / e^(r·τ)  →  1e36 / 1e18 = 1e18
            price = bracket / Math.expPositive(scaledRate);
        }
    }

    /// @notice Computes the price of a European put option on a forward using the Black-76 model.
    /// @dev Formula: price = e^(−r·τ) · [K·Φ(−d₂) − F·Φ(−d₁)]. Reverts outside the supported domain: forward in
    ///      (1e-6, 1e15) USD, strike within 5x of forward either way, time to expiration < 32 years, and rate < 400%.
    ///      When expired (timeToExp == 0), returns the intrinsic value max(strike − forward, 0).
    ///      Max relative error: < 5e-12 for any price >= 1e18.
    ///      Max absolute error: < 1.3e-10 for any price < 1e18.
    /// @param forward Current forward (futures) price in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return price Put option price in 18-decimal fixed-point format.
    function put(
        uint128 forward,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 price) {
        unchecked {
            // check inputs
            if (forward <= MIN_FORWARD) revert ForwardLowerBoundError();
            if (MAX_FORWARD <= forward) revert ForwardUpperBoundError();
            if (forward * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < forward) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired put
            if (timeToExp == 0) {
                return strike > forward ? strike - forward : 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (Math.ln(uint256(forward) * 1e18 / uint256(strike)) + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 strikeNd2 = uint256(strike) * Math.stdNormCDF(-d2);        // K · N(−d2), scaled 1e36
            uint256 fwdNd1 = uint256(forward) * Math.stdNormCDF(-d1);          // F · N(−d1), scaled 1e36
            uint256 bracket = strikeNd2 > fwdNd1 ? strikeNd2 - fwdNd1 : 0;     // K·N(−d2) − F·N(−d1), scaled 1e36

            price = bracket / Math.expPositive(scaledRate);
        }
    }

    /// @notice Computes Delta for both call and put options on a forward using the Black-76 model (sensitivity to forward price change).
    /// @dev Formula: δcall = e^(−r·τ)·Φ(d₁); δput = e^(−r·τ)·(Φ(d₁) − 1). Reverts outside the supported domain:
    ///      forward in (1e-6, 1e15) USD, strike within 5x of forward either way, time to expiration < 32 years, and rate < 400%.
    ///      When expired (timeToExp == 0), delta collapses to its degenerate expiry value (0 or ±1 by moneyness).
    ///      Delta is bounded to [−1, 1], so only an absolute error applies.
    ///      Max absolute error: < 1.2e-13 for any |delta| < 1e18.
    /// @param forward Current forward (futures) price in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return deltaCall Call option delta in 18-decimal fixed-point format.
    /// @return deltaPut Put option delta in 18-decimal fixed-point format.
    function delta(
        uint128 forward,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (int128 deltaCall, int128 deltaPut) {
        unchecked {
            // check inputs
            if (forward <= MIN_FORWARD) revert ForwardLowerBoundError();
            if (MAX_FORWARD <= forward) revert ForwardUpperBoundError();
            if (forward * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < forward) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option
            if (timeToExp == 0) {
                if (forward > strike) {
                    return (1e18, 0);
                }
                return (0, -1e18);
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (Math.ln(uint256(forward) * 1e18 / uint256(strike)) + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);

            uint256 discount = 1e36 / Math.expPositive(scaledRate);            // e^(−r·τ), scaled 1e18

            deltaCall = int128(int256(Math.stdNormCDF(d1) * discount / 1e18)); // e^(−r·τ) · N(d1)
            deltaPut = deltaCall - int128(int256(discount));                   // e^(−r·τ) · (N(d1) − 1)
        }
    }

    /// @notice Computes Gamma of the option on a forward using the Black-76 model (sensitivity to delta change).
    /// @dev Formula: Γ = e^(−r·τ)·φ(d₁) / (F·σ·√τ). Reverts outside the supported domain: forward in
    ///      (1e-6, 1e15) USD, strike within 5x of forward either way, time to expiration < 32 years, and rate < 400%.
    ///      Max relative error: < 5e-12 for any gamma >= 1e18.
    ///      Max absolute error: < 3.2e-15 for any gamma < 1e18.
    /// @param forward Current forward (futures) price in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return gammaOut Option Gamma in 18-decimal fixed-point format.
    function gamma(
        uint128 forward,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 gammaOut) {
        unchecked {
            // check inputs
            if (forward <= MIN_FORWARD) revert ForwardLowerBoundError();
            if (MAX_FORWARD <= forward) revert ForwardUpperBoundError();
            if (forward * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < forward) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option
            if (timeToExp == 0) {
                return 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (Math.ln(uint256(forward) * 1e18 / uint256(strike)) + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);
            uint256 phi = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)

            // e^(−r·τ) · φ(d1) / (F · σ√τ)
            uint256 gammaUndisc = phi * 1e18 / (uint256(forward) * scaledVol / 1e18);
            gammaOut = gammaUndisc * 1e18 / Math.expPositive(scaledRate);
        }
    }

    /// @notice Computes Theta of the option on a forward using the Black-76 model (time decay per day).
    /// @dev Formula (per year): Θ = r·price − e^(−r·τ)·F·φ(d₁)·σ / (2√τ). Returned values are per-day (÷365).
    ///      Reverts outside the supported domain: forward in (1e-6, 1e15) USD, strike within 5x of forward either way,
    ///      time to expiration < 32 years, and rate < 400%. When expired (timeToExp == 0), returns (0, 0). Theta is expressed per day.
    ///      Max relative error: < 5e-12 for any |theta| >= 1e18.
    ///      Max absolute error: < 1.9e-12 for any |theta| < 1e18.
    /// @param forward Current forward (futures) price in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return thetaCall Call option theta per day in 18-decimal fixed-point format.
    /// @return thetaPut Put option theta per day in 18-decimal fixed-point format.
    function theta(
        uint128 forward,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (int128 thetaCall, int128 thetaPut) {
        unchecked {
            // check inputs
            if (forward <= MIN_FORWARD) revert ForwardLowerBoundError();
            if (MAX_FORWARD <= forward) revert ForwardUpperBoundError();
            if (forward * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < forward) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option
            if (timeToExp == 0) {
                return (0, 0);
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 scaledVol = volatility * Math.sqrtTime(timeYear) / 1e18 + 1;    // time-adjusted volatility (+ 1 to avoid division by zero)

            return _thetaCore(forward, strike, scaledVol, uint256(rate) * timeYear / 1e18, timeYear, rate);
        }
    }

    /// @dev Core Black-76 theta math, separated to keep stack shallow
    function _thetaCore(
        uint128 forward,
        uint128 strike,
        uint256 scaledVol,
        uint256 scaledRate,
        uint256 timeYear,
        uint64 rate
    ) private pure returns (int128 thetaCall, int128 thetaPut) {
        unchecked {
            int256 d1 = (Math.ln(uint256(forward) * 1e18 / uint256(strike)) + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 expRate = Math.expPositive(scaledRate);
            uint256 discountedForward = uint256(forward) * 1e18 / expRate;     // F · e^(−r·τ)
            uint256 discountedStrike = uint256(strike) * 1e18 / expRate;       // K · e^(−r·τ)
            uint256 phi = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;         // φ(d1)

            // timeDecay = e^(−r·τ)·F · φ(d1) · σ / (2√τ)  =  discountedForward · φ · σ√τ / (2τ)
            int256 timeDecay = int256(discountedForward * phi * scaledVol / (2e18 * timeYear));

            uint256 nd1 = Math.stdNormCDF(d1);
            uint256 nd2 = Math.stdNormCDF(d2);

            // carry = r · price:  call price = DF·N(d1) − DK·N(d2);  put price = DK·N(−d2) − DF·N(−d1)
            int256 carryCall = int256(uint256(rate) * (discountedForward * nd1 / 1e18) / 1e18)
                             - int256(uint256(rate) * (discountedStrike * nd2 / 1e18) / 1e18);
            int256 carryPut  = int256(uint256(rate) * (discountedStrike * (1e18 - nd2) / 1e18) / 1e18)
                             - int256(uint256(rate) * (discountedForward * (1e18 - nd1) / 1e18) / 1e18);

            thetaCall = int128((carryCall - timeDecay) / 365);
            thetaPut  = int128((carryPut  - timeDecay) / 365);
        }
    }

    /// @notice Computes Vega of the option on a forward using the Black-76 model (sensitivity to volatility change).
    /// @dev Formula: ν = e^(−r·τ)·F·φ(d₁)·√τ, returned per 1% vol move (÷100). Reverts outside the supported domain:
    ///      forward in (1e-6, 1e15) USD, strike within 5x of forward either way, time to expiration < 32 years, and rate < 400%.
    ///      Max relative error: < 5e-12 for any vega >= 1e18.
    ///      Max absolute error: < 4e-13 for any vega < 1e18.
    /// @param forward Current forward (futures) price in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds.
    /// @param volatility Annualized implied volatility in 18-decimal fixed-point format.
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @return vegaOut Option Vega in 18-decimal fixed-point format.
    function vega(
        uint128 forward,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) internal pure returns (uint256 vegaOut) {
        unchecked {
            // check inputs
            if (forward <= MIN_FORWARD) revert ForwardLowerBoundError();
            if (MAX_FORWARD <= forward) revert ForwardUpperBoundError();
            if (forward * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();           // NOTE: checking strike upper bound first, to avoid overflow
            if (uint256(strike) * MAX_STSP_RATIO < forward) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();

            // handle expired option
            if (timeToExp == 0) {
                return 0;
            }

            uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;       // annualized time to expiration
            uint256 sqrtTimeYear = Math.sqrtTime(timeYear);
            uint256 scaledVol = volatility * sqrtTimeYear / 1e18 + 1;               // time-adjusted volatility (+ 1 to avoid division by zero)
            uint256 scaledRate = uint256(rate) * timeYear / 1e18;                       // time-adjusted rate

            int256 d1 = (Math.ln(uint256(forward) * 1e18 / uint256(strike)) + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);

            uint256 phi = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;          // N'(d1)
            // e^(−r·τ) · F · √τ · φ(d1) / 100
            uint256 vegaUndisc = uint256(forward) * sqrtTimeYear * phi / 100e36;
            vegaOut = vegaUndisc * 1e18 / Math.expPositive(scaledRate);
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
        uint256 forward;
        uint256 sqrtTimeYear;
        uint256 scaledRate;
        uint256 discountedForward;   // F · e^(−r·τ)
        uint256 discountedStrike;    // K · e^(−r·τ)
        int256 lnFK;
        uint256 vegaBase;            // discountedForward · sqrtTimeYear / 1e18 — leading factor of vega
        uint256 optionPrice;
        bool isCall;
    }

    /// @notice Computes implied volatility from a market option price on a forward using Newton-Raphson.
    /// @dev Solves for σ such that Black76(σ) = optionPrice via Newton-Raphson (fixed 55% seed, up to 30
    ///      iterations, price tolerance ~1e6 wei), clamping the result to [0.01%, 1800%] volatility.
    ///      Reverts outside the supported domain: forward in (1e-6, 1e15) USD, strike within 5x of forward
    ///      either way, time to expiration in (0, 32 years), and rate < 400%. Also reverts if optionPrice
    ///      is outside the no-arbitrage range, or if the solver fails to converge within 30 iterations.
    ///      Max relative error: < 1e-6 for any volatility >= 1e18.
    ///      Max absolute error: < 2e-6 for any volatility < 1e18.
    /// @param forward Current forward (futures) price in 18-decimal fixed-point format.
    /// @param strike Strike price of the option in 18-decimal fixed-point format.
    /// @param timeToExp Time to expiration in seconds (must be > 0).
    /// @param rate Annualized risk-free interest rate in 18-decimal fixed-point format.
    /// @param optionPrice Observed market price of the option in 18-decimal fixed-point format.
    /// @param isCall True for call option, false for put.
    /// @return volatility Implied volatility in 18-decimal fixed-point format.
    function impliedVolatility(
        uint128 forward,
        uint128 strike,
        uint32 timeToExp,
        uint64 rate,
        uint128 optionPrice,
        bool isCall
    ) internal pure returns (uint256 volatility) {
        unchecked {
            // input checks
            if (forward <= MIN_FORWARD) revert ForwardLowerBoundError();
            if (MAX_FORWARD <= forward) revert ForwardUpperBoundError();
            if (forward * MAX_STSP_RATIO < strike) revert StrikeUpperBoundError();
            if (uint256(strike) * MAX_STSP_RATIO < forward) revert StrikeLowerBoundError();
            if (MAX_EXPIRATION <= timeToExp) revert TimeToExpiryUpperBoundError();
            if (MAX_RATE <= rate) revert RateUpperBoundError();
            if (timeToExp == 0) revert TimeToExpiryLowerBoundError();

            IVState memory s;
            s.forward = forward;
            s.optionPrice = optionPrice;
            s.isCall = isCall;
            {
                uint256 timeYear = uint256(timeToExp) * 1e18 / SECONDS_IN_YEAR;
                s.sqrtTimeYear = Math.sqrtTime(timeYear);
                s.scaledRate = uint256(rate) * timeYear / 1e18;
            }
            uint256 expRate = Math.expPositive(s.scaledRate);
            s.discountedForward = uint256(forward) * 1e18 / expRate;
            s.discountedStrike = uint256(strike) * 1e18 / expRate;
            s.lnFK = Math.ln(uint256(forward) * 1e18 / uint256(strike));
            s.vegaBase = s.discountedForward * s.sqrtTimeYear / 1e18;

            if (isCall) {
                // No-arbitrage bound check
                uint256 lower = s.discountedForward > s.discountedStrike ? s.discountedForward - s.discountedStrike : 0;
                uint256 upper = s.discountedForward;
                if (optionPrice <= lower || optionPrice >= upper) revert PriceOutOfBoundsError();

                return _ivCallIterate(s);
            } else {
                // No-arbitrage bound check
                uint256 lower = s.discountedStrike > s.discountedForward ? s.discountedStrike - s.discountedForward : 0;
                uint256 upper = s.discountedStrike;
                if (optionPrice <= lower || optionPrice >= upper) revert PriceOutOfBoundsError();

                return _ivPutIterate(s);
            }
        }
    }

    /// @dev Newton-Raphson iteration loop
    function _ivCallIterate(IVState memory s) private pure returns (uint256 sigma) {
        unchecked {
            sigma = 55e16;   // fixed 55% seed — converges in 5–10 iterations across the typical range

            for (uint256 i = 0; i < IV_MAX_ITER; i++) {
                (uint256 price, uint256 vegaOut) = _callPriceAndVega(s, sigma);

                int256 diff = int256(price) - int256(s.optionPrice);
                uint256 absDiff = diff >= 0 ? uint256(diff) : uint256(-diff);
                if (absDiff <= IV_TOLERANCE) return sigma;

                if (vegaOut < 1e6) revert NoConvergenceError();   // vega too small to invert

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
            sigma = 55e16;   // fixed 55% seed — converges in 5–10 iterations across the typical range

            for (uint256 i = 0; i < IV_MAX_ITER; i++) {
                (uint256 price, uint256 vegaOut) = _putPriceAndVega(s, sigma);

                int256 diff = int256(price) - int256(s.optionPrice);
                uint256 absDiff = diff >= 0 ? uint256(diff) : uint256(-diff);
                if (absDiff <= IV_TOLERANCE) return sigma;

                if (vegaOut < 1e6) revert NoConvergenceError();   // vega too small to invert

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
            int256 d1 = (s.lnFK + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            // vega per unit vol = e^(−r·τ) · F · sqrt(T) · φ(d1) = vegaBase · φ(d1)
            uint256 phiD1 = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;
            vegaOut = s.vegaBase * phiD1 / 1e18;

            // price = DF·N(d1) − DK·N(d2)
            uint256 fwdNd1 = s.discountedForward * Math.stdNormCDF(d1);
            uint256 strikeNd2 = s.discountedStrike * Math.stdNormCDF(d2);
            price = fwdNd1 > strikeNd2 ? (fwdNd1 - strikeNd2) / 1e18 : 0;
        }
    }

    /// @dev Computes put option price and per-unit-vol vega at given σ. Reuses precomputed state.
    function _putPriceAndVega(IVState memory s, uint256 sigma) private pure returns (uint256 price, uint256 vegaOut) {
        unchecked {
            uint256 scaledVol = sigma * s.sqrtTimeYear / 1e18 + 1;
            int256 d1 = (s.lnFK + int256(scaledVol * scaledVol / 2e18)) * 1e18 / int256(scaledVol);
            int256 d2 = d1 - int256(scaledVol);

            uint256 phiD1 = Math.exp(-d1 * d1 / 2e18) * 1e18 / SQRT_2PI;
            vegaOut = s.vegaBase * phiD1 / 1e18;

            // price = DK·N(−d2) − DF·N(−d1)
            uint256 strikeNd2 = s.discountedStrike * Math.stdNormCDF(-d2);
            uint256 fwdNd1 = s.discountedForward * Math.stdNormCDF(-d1);
            price = strikeNd2 > fwdNd1 ? (strikeNd2 - fwdNd1) / 1e18 : 0;
        }
    }
}
