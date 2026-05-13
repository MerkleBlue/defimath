// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../math/Math.sol";

/// @title DeFiMathStats: Array-based statistical primitives for DeFi
/// @author DeFiMath (https://defimath.com)
/// @notice Time-series statistics built on top of DeFiMath's sqrt.
/// @dev All values are in 18-decimal fixed-point format unless otherwise noted.
library DeFiMathStats {

    // limits
    /// @notice Maximum allowed value per array element: matches the MAX_PRINCIPAL convention
    uint256 internal constant MAX_VALUE = 1e33 + 1;

    /// @notice Maximum allowed array length (gas-bomb guard)
    uint256 internal constant MAX_ARRAY_LENGTH = 1024 + 1;

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
}
