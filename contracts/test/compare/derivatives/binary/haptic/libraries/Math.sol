// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.5.0;

// a library for performing various math operations

library Math {
    function min(uint x, uint y) internal pure returns (uint z) {
        z = x < y ? x : y;
    }

    // babylonian method (https://en.wikipedia.org/wiki/Methods_of_computing_square_roots#Babylonian_method)
    function sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
    
    /// @dev Return the maximum value between the two inputs
    function max(uint x, uint y) internal pure returns (uint) {
        return (x > y) ? x : y;
    }

    /// @dev Compute the absolute value of `val`.
    function abs(int val) internal pure returns (uint) {
        return uint(val < 0 ? -val : val);
    }

    /// @dev Takes ceiling of a to m precision
    /// @param m represents 1eX where X is the number of trailing 0's
    function ceil(uint a, uint m) internal pure returns (uint) {
        return ((a + m - 1) / m) * m;
    }
}