// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract BlackScholesNUM {

    uint256 internal constant SECONDS_IN_YEAR = 31536000;
    uint internal constant SQRT_2XPI = 2506628274631000502415765285;  // sqrt(2 * PI)
    uint internal constant SCALE = 1e18;
    uint internal constant SCALE_DOWN = 1e9;

    uint internal constant PRECISE_UNIT = 1e27;
    int internal constant STD_NORMAL_CDF_MINIMUM = -4 * int(PRECISE_UNIT);   // -4
    int internal constant STD_NORMAL_CDF_MAXIMUM = 10 * int(PRECISE_UNIT);   // +10
    int internal constant LOG2_E_SIGNED = 1_442695040888963407;       // log2(e)
    int internal constant HALF_SCALE_SIGNED = 5e17;                   // 0.5 * 10 ** 18
    int internal constant SCALE_SIGNED = 1e18;
    int internal constant SCALE_DOWN_SIGNED = 1e9;

    int256 internal constant E_TO_005 = 1_051271096376024040; // e ^ 0.05 // todo: check this value

    bool log = false;

    constructor() {
    }


    function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) external pure returns (uint256) {
        unchecked {
            return _getFuturePrice(spot, timeToExpirySec, rate);
        }
    }

    function _getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) private pure returns (uint256) {
        unchecked {
            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)

            // NOTE: this is slower than below
            // uint256 timeToExpiryYears = uint256(timeToExpirySec) * 1e18 / SECONDS_IN_YEAR;
            // uint256 x = rate * timeToExpiryYears / 1e13;

            // NOTE: this is faster than the above 
            uint256 x = uint256(timeToExpirySec) * 1e5 * rate / SECONDS_IN_YEAR;

            // todo: check x is not more than 0.2

            uint256 numerator = (x + 3e9) ** 2 + 3e18;
            uint256 denominator = (3e9 - x) ** 2 + 3e18;

            return numerator * spot / denominator;
        }
    }

    function _getDiscountedStrikePrice(uint128 strike, uint32 timeToExpirySec, uint16 rate) private pure returns (uint256) {
        unchecked {
            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)

            // NOTE: this is faster than the above 
            uint256 x = uint256(timeToExpirySec) * 1e5 * rate / SECONDS_IN_YEAR;

            // todo: check x is not more than 0.2

            uint256 numerator = (x + 3e9) ** 2 + 3e18;
            uint256 denominator = (3e9 - x) ** 2 + 3e18;

            return denominator * strike / numerator;
        }
    }

    // gas 592 when x > 0.05
    function exp(int256 x) public view returns (uint256) {
        unchecked {
            // handle special case where x = 0
            if (x == 0) {
                return 1e18;
            }

            bool isPositive = x >= 0;
            if (!isPositive) {
                x = -x;
            }

            int256 exp1 = 1e18;

            if (x > 5e16) {
                uint256 exponent = uint(x) / 5e16;
                x -= int256(exponent * 5e16);
                exp1 = getExp1Precalculated(exponent); // int256(E_TO_005 ** exponent / (10 ** (18 * (exponent - 1))));
            } 
            // if (log) { if (exp1 > 0) { console.log("exp1 SOL: %d", uint256(exp1)); } else { console.log("exp1 SOL: -%d", uint256(-exp1)); }}
            

            // we use Pade approximation for exp(x)
            // e ^ x ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
            int256 numerator = ((x + 3e18) ** 2) + 3e36;
            int256 denominator = ((3e18 - x) ** 2) + 3e36;
            // int256 exp2 = (numerator * 1e18) / denominator;

            // if (log) { if (exp2 > 0) { console.log("exp2 SOL: %d", uint256(exp2)); } else { console.log("exp2 SOL: -%d", uint256(-exp2)); }}


            uint256 result = uint(exp1 * numerator / denominator); // using e ^ (a + b) = e ^ a * e ^ b

            return isPositive ? result : 1 / result;
        }
    }

    function getExp1Precalculated(uint256 exponent) private pure returns (int256) {
        // use >=, fastest
        // if (exponent > 0) {





        if (exponent >= 3) {
            if (exponent >= 4) {
                return 1_221402758160170000; // 4
            } else {
                return 1_161834242728283000; // 3
            }
        } else {
            if (exponent >= 2) {
                return 1_105170918075648000; // 2
            } else {
                return E_TO_005;    // 1 
            }
        }
        // }

    }

    // todo: delete
    function expMeasureGas(int256 x) public view returns (uint256) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        exp(x);

                // if (0 <= x) {
                //     exp(x);
                //     // uint256[4] memory exp1s;
                //     // exp1s = [uint256(1_051271096376024000), 1_105170918075648000, 1_161834242728283000, 1_221402758160170000];
                // }

        endGas = gasleft();
        return startGas - endGas;
    }

    function _abs(int x) internal pure returns (uint result) {
        unchecked {
            result = uint(x < 0 ? -x : x);
        }
    }
}
