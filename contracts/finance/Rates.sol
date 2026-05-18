// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

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

    /// @notice Maximum number of cashflows in an IRR calculation (gas-bomb guard)
    uint256 internal constant MAX_CASHFLOWS = 1024 + 1;

    /// @notice Maximum Newton-Raphson iterations for IRR convergence
    uint256 internal constant IRR_MAX_ITER = 50;

    /// @notice IRR convergence tolerance: |Σ Cᵢ · e^(-r·tᵢ)| < 1e10 (≈ 1e-8 in 1e18 base)
    uint256 internal constant IRR_TOLERANCE = 1e10;

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

    /// @notice Reverts when cashflows and times arrays have different lengths
    error ArrayLengthMismatchError();

    /// @notice Reverts when cashflows array is too short or too long
    error ArrayLengthOutOfBoundsError();

    /// @notice Reverts when Newton-Raphson IRR solver fails to converge
    error NoConvergenceError();

    /// @notice Reverts when YTM input price is not below face value (no positive yield)
    error InvalidBondPriceError();

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

    /// @notice Yield to Maturity for a zero-coupon bond (closed form, no iteration)
    /// @dev YTM = ln(faceValue / price) / timeYear. Continuous compounding.
    ///      For coupon bonds, express the cashflows and use `internalRateOfReturn()` instead.
    /// @param price Current bond price (scaled by 1e18, must be < faceValue)
    /// @param faceValue Face value paid at maturity (scaled by 1e18)
    /// @param timeToMaturity Seconds until maturity (must be > 0)
    /// @return ytm Annualized continuous YTM (scaled by 1e18)
    function yieldToMaturity(uint128 price, uint128 faceValue, uint32 timeToMaturity) internal pure returns (int256 ytm) {
        unchecked {
            // check inputs
            if (price <= MIN_PRINCIPAL) revert PriceLowerBoundError();
            if (MAX_PRINCIPAL <= price) revert PriceUpperBoundError();
            if (faceValue <= MIN_PRINCIPAL) revert PrincipalLowerBoundError();
            if (MAX_PRINCIPAL <= faceValue) revert PrincipalUpperBoundError();
            if (price >= faceValue) revert InvalidBondPriceError();
            if (timeToMaturity == 0) revert TimeIntervalUpperBoundError();
            if (MAX_TIME_INTERVAL <= timeToMaturity) revert TimeIntervalUpperBoundError();

            // ln(F/P) returns signed; for F > P, this is positive
            int256 lnRatio = DeFiMath.ln(uint256(faceValue) * 1e18 / uint256(price));
            // timeYear in 1e18 base
            uint256 timeYear = uint256(timeToMaturity) * 1e18 / SECONDS_IN_YEAR;
            // ytm = lnRatio / timeYear, both 1e18-base → multiply by 1e18 to preserve scale
            ytm = lnRatio * 1e18 / int256(timeYear);
        }
    }

    /// @notice Internal Rate of Return for arbitrary cashflows at arbitrary times (continuous compounding)
    /// @dev Solves Σ Cᵢ · e^(-irr·tᵢ) = 0 for irr via Newton-Raphson. Initial guess matters for convergence;
    ///      typical: pass 0.05e18 (5% APR) for standard fixed-income use cases.
    ///      Times are in seconds from origin. Cashflows are signed (outflows negative, inflows positive).
    ///      Reverts with `NoConvergenceError` if iteration doesn't converge in `IRR_MAX_ITER` steps.
    /// @param cashflows Signed cashflows (scaled by 1e18, any signs allowed)
    /// @param times Seconds from origin for each cashflow (same length as cashflows)
    /// @param guess Initial rate guess (signed, scaled by 1e18, e.g. 0.05e18 = 5%)
    /// @return irr Internal rate of return as continuous annual rate (signed, scaled by 1e18)
    function internalRateOfReturn(int256[] calldata cashflows, uint32[] calldata times, int256 guess) internal pure returns (int256 irr) {
        unchecked {
            uint256 n = cashflows.length;
            if (n < 2 || MAX_CASHFLOWS <= n) revert ArrayLengthOutOfBoundsError();
            if (n != times.length) revert ArrayLengthMismatchError();
            if (guess >= int256(MAX_RATE) || guess <= -int256(MAX_RATE)) revert RateUpperBoundError();

            irr = guess;

            for (uint256 iter = 0; iter < IRR_MAX_ITER; iter++) {
                int256 f;          // Σ Cᵢ · e^(-irr·tᵢ)
                int256 fPrime;     // -Σ Cᵢ · tᵢ · e^(-irr·tᵢ)

                for (uint256 i = 0; i < n; i++) {
                    // timeYear in 1e18 base
                    uint256 timeYear = uint256(times[i]) * 1e18 / SECONDS_IN_YEAR;
                    // exponent = -irr · timeYear in 1e18 base (signed)
                    int256 exponent = -irr * int256(timeYear) / 1e18;
                    // exp(-irr·t); DeFiMath.exp handles signed input and reverts on overflow
                    int256 expValue = int256(DeFiMath.exp(exponent));
                    // f += Cᵢ · exp(-irr·tᵢ); keep 1e18-scaled
                    f += cashflows[i] * expValue / 1e18;
                    // fPrime -= Cᵢ · tᵢ · exp(-irr·tᵢ); using timeYear in 1e18 base
                    fPrime -= cashflows[i] * int256(timeYear) / 1e18 * expValue / 1e18;
                }

                int256 absF = f >= 0 ? f : -f;
                if (uint256(absF) < IRR_TOLERANCE) return irr;
                if (fPrime == 0) revert NoConvergenceError();

                // Newton step: irr ← irr − f/f'
                int256 step = f * 1e18 / fPrime;
                irr -= step;

                // clamp irr to valid range to keep exp from overflowing
                if (irr >= int256(MAX_RATE)) irr = int256(MAX_RATE) - 1;
                if (irr <= -int256(MAX_RATE)) irr = -int256(MAX_RATE) + 1;
            }
            revert NoConvergenceError();
        }
    }
}
