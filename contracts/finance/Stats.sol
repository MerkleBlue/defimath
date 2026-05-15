// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../math/Math.sol";

/// @title DeFiMathStats: Array-based statistical primitives for DeFi
/// @author DeFiMath (https://defimath.com)
/// @notice Time-series statistics built on top of DeFiMath's sqrt.
/// @dev All values are in 18-decimal fixed-point format unless otherwise noted.
library DeFiMathStats {

    // constants
    /// @notice Number of seconds in a year (365 days)
    uint256 internal constant SECONDS_IN_YEAR = 31536000;

    // limits
    /// @notice Maximum allowed value per array element: matches the MAX_PRINCIPAL convention
    uint256 internal constant MAX_VALUE = 1e33 + 1;

    /// @notice Maximum allowed array length (gas-bomb guard)
    uint256 internal constant MAX_ARRAY_LENGTH = 1024 + 1;

    /// @notice Maximum allowed annualized rate (400%)
    uint256 internal constant MAX_RATE = 4e18 + 1;

    // errors
    /// @notice Reverts when values and weights arrays have different lengths
    error ArrayLengthMismatchError();

    /// @notice Reverts when array length is below the allowed minimum
    error ArrayLengthLowerBoundError();

    /// @notice Reverts when array length exceeds the allowed maximum
    error ArrayLengthUpperBoundError();

    /// @notice Reverts when any value or weight exceeds the allowed maximum
    error ValueUpperBoundError();

    /// @notice Reverts when the sum of weights is zero (would cause division by zero)
    error WeightSumZeroError();

    /// @notice Reverts when a price input is zero (cannot compute log of zero)
    error PriceLowerBoundError();

    /// @notice Reverts when sampling interval is zero
    error IntervalLowerBoundError();

    /// @notice Reverts when annualized rate exceeds the allowed maximum
    error RateUpperBoundError();

    /// @notice Reverts when sample standard deviation is zero (Sharpe undefined)
    error VolatilityZeroError();

    /// @notice Reverts when confidence level is outside (0, 1) exclusive
    error ConfidenceOutOfRangeError();

    /// @notice Geometric mean of two values: sqrt(a · b)
    /// @param a First value (scaled by 1e18)
    /// @param b Second value (scaled by 1e18)
    /// @return result Geometric mean (scaled by 1e18)
    function geometricMean(uint256 a, uint256 b) internal pure returns (uint256 result) {
        unchecked {
            // check inputs
            if (MAX_VALUE <= a) revert ValueUpperBoundError();
            if (MAX_VALUE <= b) revert ValueUpperBoundError();

            result = DeFiMath.sqrt(a * b / 1e18);
        }
    }

    /// @notice Weighted average: Σ(v_i · w_i) / Σ(w_i)
    /// @param values Array of values (each scaled by 1e18)
    /// @param weights Array of non-negative weights (each scaled by 1e18, aligned with values)
    /// @return result Weighted average (scaled by 1e18)
    function weightedAverage(uint256[] calldata values, uint256[] calldata weights) internal pure returns (uint256 result) {
        unchecked {
            uint256 n = values.length;

            // check inputs
            if (n == 0) revert ArrayLengthLowerBoundError();
            if (MAX_ARRAY_LENGTH <= n) revert ArrayLengthUpperBoundError();
            if (n != weights.length) revert ArrayLengthMismatchError();

            // sumProducts accumulates v_i*w_i (each 1e36-scaled), sumWeights stays 1e18-scaled.
            // Division 1e36 / 1e18 = 1e18, so result is naturally 1e18-scaled.
            uint256 sumProducts;
            uint256 sumWeights;
            for (uint256 i = 0; i < n; i++) {
                if (MAX_VALUE <= values[i]) revert ValueUpperBoundError();
                if (MAX_VALUE <= weights[i]) revert ValueUpperBoundError();
                sumProducts += values[i] * weights[i];
                sumWeights += weights[i];
            }
            if (sumWeights == 0) revert WeightSumZeroError();
            result = sumProducts / sumWeights;
        }
    }

    /// @notice Arithmetic mean: Σ(v_i) / n
    /// @param values Array of values (each scaled by 1e18)
    /// @return result Mean (scaled by 1e18)
    function mean(uint256[] calldata values) internal pure returns (uint256 result) {
        unchecked {
            uint256 n = values.length;

            // check inputs
            if (n == 0) revert ArrayLengthLowerBoundError();
            if (MAX_ARRAY_LENGTH <= n) revert ArrayLengthUpperBoundError();

            uint256 sum;
            for (uint256 i = 0; i < n; i++) {
                if (MAX_VALUE <= values[i]) revert ValueUpperBoundError();
                sum += values[i];
            }
            result = sum / n;
        }
    }

    /// @notice Sample standard deviation: sqrt(Σ(v_i - μ)² / (n - 1))
    /// @dev Requires n ≥ 2 (single-element sample has no variance).
    ///      Uses the unbiased (Bessel-corrected) estimator.
    /// @param values Array of values (each scaled by 1e18)
    /// @return result Sample standard deviation (scaled by 1e18)
    function stdDev(uint256[] calldata values) internal pure returns (uint256 result) {
        unchecked {
            uint256 n = values.length;

            // check inputs
            if (n < 2) revert ArrayLengthLowerBoundError();
            if (MAX_ARRAY_LENGTH <= n) revert ArrayLengthUpperBoundError();

            // first pass: compute mean
            uint256 sum;
            for (uint256 i = 0; i < n; i++) {
                if (MAX_VALUE <= values[i]) revert ValueUpperBoundError();
                sum += values[i];
            }
            uint256 m = sum / n;

            // second pass: sum of squared deviations (in 1e36 base)
            uint256 sumOfSquares;
            for (uint256 i = 0; i < n; i++) {
                uint256 dev = values[i] >= m ? values[i] - m : m - values[i];
                sumOfSquares += dev * dev;
            }

            // variance_1e36 / 1e18 = variance in 1e18 base; sqrt brings it to stdDev in 1e18 base
            result = DeFiMath.sqrt(sumOfSquares / ((n - 1) * 1e18));
        }
    }

    /// @notice Annualized historical volatility from a price series
    /// @dev Computes the sample standard deviation of log returns and annualizes
    ///      by sqrt(SECONDS_IN_YEAR / intervalSec). Uses the algebraic identity
    ///      σ² = (Σr² − n·μ²) / (n − 1) to avoid signed-array std-dev machinery.
    ///      Requires at least 3 prices (i.e., 2+ returns for unbiased sample variance).
    /// @param prices Array of equally-spaced price observations (each scaled by 1e18, must be > 0)
    /// @param intervalSec Seconds between consecutive price observations
    /// @return annualizedVol Annualized volatility (scaled by 1e18, e.g. 0.45e18 = 45% vol)
    function historicalVolatility(uint256[] calldata prices, uint32 intervalSec) internal pure returns (uint256 annualizedVol) {
        unchecked {
            if (intervalSec == 0) revert IntervalLowerBoundError();

            (, uint256 periodStdDev) = _logReturnStats(prices);

            // annualize: σ_year = σ_period · sqrt(SECONDS_IN_YEAR / intervalSec)
            // factor1e18 in 1e18 base supports fractional annualization (intervalSec > 1 year)
            uint256 factor1e18 = SECONDS_IN_YEAR * 1e18 / uint256(intervalSec);
            uint256 sqrtFactor = DeFiMath.sqrt(factor1e18);
            annualizedVol = periodStdDev * sqrtFactor / 1e18;
        }
    }

    /// @notice Annualized Sharpe ratio of a price series given a risk-free rate
    /// @dev Sharpe = (annualizedReturn − riskFreeRate) / annualizedVolatility.
    ///      Period return and stddev are computed from log returns of consecutive prices,
    ///      then annualized using SECONDS_IN_YEAR / intervalSec. Reverts when stddev = 0
    ///      (Sharpe is undefined for a constant-price series).
    /// @param prices Array of equally-spaced price observations (each scaled by 1e18, must be > 0)
    /// @param intervalSec Seconds between consecutive price observations
    /// @param riskFreeRateAnnual Annualized continuous risk-free rate (scaled by 1e18, e.g. 0.05e18 = 5%)
    /// @return sharpe Signed annualized Sharpe ratio (scaled by 1e18)
    function sharpeRatio(uint256[] calldata prices, uint32 intervalSec, uint64 riskFreeRateAnnual) internal pure returns (int256 sharpe) {
        unchecked {
            if (intervalSec == 0) revert IntervalLowerBoundError();
            if (MAX_RATE <= riskFreeRateAnnual) revert RateUpperBoundError();

            (int256 periodMean, uint256 periodStdDev) = _logReturnStats(prices);
            if (periodStdDev == 0) revert VolatilityZeroError();

            // factor1e18 = periods-per-year (in 1e18 base) for fractional support
            uint256 factor1e18 = SECONDS_IN_YEAR * 1e18 / uint256(intervalSec);
            uint256 sqrtFactor = DeFiMath.sqrt(factor1e18);

            // annualize mean (signed): mean_annual = mean_period × factor
            int256 meanAnnual = periodMean * int256(factor1e18) / 1e18;
            // annualize stddev (positive): stdDev_annual = stdDev_period × sqrt(factor)
            uint256 stdDevAnnual = periodStdDev * sqrtFactor / 1e18;

            // Sharpe = (mean_annual − rf_annual) / stdDev_annual, both 1e18-base → ×1e18 to preserve scale
            int256 excess = meanAnnual - int256(uint256(riskFreeRateAnnual));
            sharpe = excess * 1e18 / int256(stdDevAnnual);
        }
    }

    /// @notice Maximum drawdown of an equity curve: largest peak-to-trough decline as a fraction
    /// @dev Single-pass algorithm tracking running peak. Returns a non-negative ratio.
    /// @param equity Array of equity / NAV / cumulative-value observations (each scaled by 1e18, must be > 0)
    /// @return mdd Maximum drawdown as a positive fraction (scaled by 1e18, e.g. 0.30e18 = 30% drawdown)
    function maxDrawdown(uint256[] calldata equity) internal pure returns (uint256 mdd) {
        unchecked {
            uint256 n = equity.length;

            // check inputs
            if (n < 2) revert ArrayLengthLowerBoundError();
            if (MAX_ARRAY_LENGTH <= n) revert ArrayLengthUpperBoundError();
            if (equity[0] == 0) revert PriceLowerBoundError();
            if (MAX_VALUE <= equity[0]) revert ValueUpperBoundError();

            uint256 peak = equity[0];
            for (uint256 i = 1; i < n; i++) {
                if (equity[i] == 0) revert PriceLowerBoundError();
                if (MAX_VALUE <= equity[i]) revert ValueUpperBoundError();

                if (equity[i] > peak) {
                    peak = equity[i];
                } else {
                    // drawdown = (peak − current) / peak, scaled to 1e18
                    uint256 dd = (peak - equity[i]) * 1e18 / peak;
                    if (dd > mdd) mdd = dd;
                }
            }
        }
    }

    /// @notice Historical Value at Risk: the return threshold below which losses fall with probability 1-α
    /// @dev Uses linear interpolation matching NumPy's `method='linear'` (also `simple-statistics.quantile`):
    ///      idx = (1-α)·(n-1) where n is the number of log returns. With k = floor(idx) and f = idx − k:
    ///      VaR = sorted[k] + f · (sorted[k+1] − sorted[k]). Output is signed (typically negative).
    /// @param prices Array of equally-spaced price observations (each scaled by 1e18, must be > 0)
    /// @param confidence Confidence level (scaled by 1e18, strictly between 0 and 1, e.g. 0.95e18 = 95%)
    /// @return varOut Signed VaR threshold return (scaled by 1e18)
    function valueAtRisk(uint256[] calldata prices, uint64 confidence) internal pure returns (int256 varOut) {
        unchecked {
            if (confidence == 0 || confidence >= 1e18) revert ConfidenceOutOfRangeError();

            uint256 n = prices.length - 1;
            // NumPy linear: idx = (1-α) · (n-1)
            uint256 idxTimes1e18 = (1e18 - uint256(confidence)) * (n - 1);
            uint256 k = idxTimes1e18 / 1e18;
            uint256 fraction1e18 = idxTimes1e18 - k * 1e18;

            // boundary: idx ∈ [0, n-1], so k ∈ [0, n-1]; only k == n-1 needs no-interp clamp
            if (k >= n - 1) {
                k = n - 1;
                fraction1e18 = 0;
            }

            // pass K = k+1 so buffer holds both sorted[k] (secondLargest) and sorted[k+1] (largest)
            uint256 K = (k == n - 1) ? n - 1 : k + 1;
            (int256 largest, int256 secondLargest, ) = _kSmallestLogReturns(prices, K);

            // interpolate; when K == k (boundary), largest == secondLargest, so (upper-lower) = 0
            int256 lower = (K == k + 1) ? secondLargest : largest;
            int256 upper = largest;
            varOut = lower + (upper - lower) * int256(fraction1e18) / 1e18;
        }
    }

    /// @notice Conditional Value at Risk (Expected Shortfall): mean return in the left tail beyond VaR
    /// @dev Average of all returns at and below the VaR threshold. More tail-sensitive than VaR.
    /// @param prices Array of equally-spaced price observations (each scaled by 1e18, must be > 0)
    /// @param confidence Confidence level (scaled by 1e18, strictly between 0 and 1, e.g. 0.95e18 = 95%)
    /// @return cvarOut Signed CVaR (scaled by 1e18, typically more negative than VaR)
    function conditionalValueAtRisk(uint256[] calldata prices, uint64 confidence) internal pure returns (int256 cvarOut) {
        unchecked {
            if (confidence == 0 || confidence >= 1e18) revert ConfidenceOutOfRangeError();

            uint256 n = prices.length - 1;
            // Same index convention as valueAtRisk: k = floor((1-α)·(n-1))
            uint256 k = (1e18 - uint256(confidence)) * (n - 1) / 1e18;
            if (k >= n) k = n - 1;

            (, , int256 sumK) = _kSmallestLogReturns(prices, k);
            // CVaR = average of the k+1 smallest log returns (the left tail)
            cvarOut = sumK / int256(k + 1);
        }
    }

    /// @dev Internal helper: returns the k-th smallest log return, the (k-1)-th smallest (for VaR
    ///      linear interpolation), and the sum of the k+1 smallest (for CVaR).
    ///      Uses a partial-sort buffer of size k+1 — O(n·k) instead of O(n²) full sort.
    ///      For typical risk metrics (k = 1-5% of n), this is dramatically faster than full sorting.
    function _kSmallestLogReturns(uint256[] calldata prices, uint256 k) private pure returns (int256 largest, int256 secondLargest, int256 sumK) {
        unchecked {
            uint256 nPrices = prices.length;

            // check inputs
            if (nPrices < 2) revert ArrayLengthLowerBoundError();
            if (MAX_ARRAY_LENGTH <= nPrices) revert ArrayLengthUpperBoundError();
            if (prices[0] == 0) revert PriceLowerBoundError();
            if (MAX_VALUE <= prices[0]) revert ValueUpperBoundError();

            // partial-sort buffer of k+1 smallest log returns, kept ascending
            int256[] memory buf = new int256[](k + 1);

            // seed the buffer with the first k+1 log returns
            for (uint256 i = 0; i <= k; i++) {
                if (prices[i + 1] == 0) revert PriceLowerBoundError();
                if (MAX_VALUE <= prices[i + 1]) revert ValueUpperBoundError();
                buf[i] = DeFiMath.ln(uint256(prices[i + 1]) * 1e18 / uint256(prices[i]));
            }

            // insertion-sort the seed (one-time cost O(k²))
            for (uint256 i = 1; i <= k; i++) {
                int256 key = buf[i];
                uint256 j = i;
                while (j > 0 && buf[j - 1] > key) {
                    buf[j] = buf[j - 1];
                    j--;
                }
                buf[j] = key;
            }

            // scan remaining returns; insert any that beat the current buf[k]
            uint256 nReturns = nPrices - 1;
            for (uint256 i = k + 1; i < nReturns; i++) {
                if (prices[i + 1] == 0) revert PriceLowerBoundError();
                if (MAX_VALUE <= prices[i + 1]) revert ValueUpperBoundError();
                int256 candidate = DeFiMath.ln(uint256(prices[i + 1]) * 1e18 / uint256(prices[i]));
                if (candidate < buf[k]) {
                    // insert into sorted buf, displacing buf[k]
                    uint256 j = k;
                    while (j > 0 && buf[j - 1] > candidate) {
                        buf[j] = buf[j - 1];
                        j--;
                    }
                    buf[j] = candidate;
                }
            }

            largest = buf[k];
            secondLargest = (k > 0) ? buf[k - 1] : largest;
            for (uint256 i = 0; i <= k; i++) {
                sumK += buf[i];
            }
        }
    }

    /// @dev Internal helper: computes sample mean and stddev of log returns from a price series.
    ///      Used by both historicalVolatility and sharpeRatio. Returns are 1e18-scaled (signed mean,
    ///      positive stddev). Requires at least 3 prices for unbiased sample variance.
    function _logReturnStats(uint256[] calldata prices) private pure returns (int256 periodMean, uint256 periodStdDev) {
        unchecked {
            uint256 nPrices = prices.length;

            // check inputs
            if (nPrices < 3) revert ArrayLengthLowerBoundError();
            if (MAX_ARRAY_LENGTH <= nPrices) revert ArrayLengthUpperBoundError();
            if (prices[0] == 0) revert PriceLowerBoundError();
            if (MAX_VALUE <= prices[0]) revert ValueUpperBoundError();

            // accumulate log returns and squared returns in a single pass
            int256 sumReturns;             // 1e18-scaled, signed
            uint256 sumSquaredReturns;     // (1e18-scaled return)² → each term 1e36-scaled

            for (uint256 i = 1; i < nPrices; i++) {
                if (prices[i] == 0) revert PriceLowerBoundError();
                if (MAX_VALUE <= prices[i]) revert ValueUpperBoundError();

                // log return r_i = ln(p_i / p_{i-1}), signed (negative on price drop)
                int256 r = DeFiMath.ln(uint256(prices[i]) * 1e18 / uint256(prices[i - 1]));
                sumReturns += r;
                sumSquaredReturns += uint256(r * r); // r² is always non-negative
            }

            uint256 nReturns = nPrices - 1;
            periodMean = sumReturns / int256(nReturns);

            // sample variance via algebraic identity: (Σr² − n·μ²) / (n − 1)
            uint256 meanSquared = uint256(periodMean * periodMean);
            uint256 nMeanSquared = nReturns * meanSquared;
            // Σr² ≥ n·μ² by Cauchy-Schwarz; guard for any integer-arithmetic edge case
            uint256 varianceTimes1e36 = sumSquaredReturns > nMeanSquared
                ? (sumSquaredReturns - nMeanSquared) / (nReturns - 1)
                : 0;

            // period stddev = sqrt(variance_1e18) where variance_1e18 = varianceTimes1e36 / 1e18
            periodStdDev = DeFiMath.sqrt(varianceTimes1e36 / 1e18);
        }
    }
}
