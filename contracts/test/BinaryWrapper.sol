// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../derivatives/Binary.sol";

contract BinaryWrapper {

    function getBinaryCallPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate,
        uint128 payout
    ) external pure returns (uint256 price) {
        return DeFiMathBinary.getBinaryCallPrice(spot, strike, timeToExpirySec, volatility, rate, payout);
    }

    function getBinaryCallPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate,
        uint128 payout
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBinary.getBinaryCallPrice(spot, strike, timeToExpirySec, volatility, rate, payout);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function getBinaryPutPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate,
        uint128 payout
    ) external pure returns (uint256 price) {
        return DeFiMathBinary.getBinaryPutPrice(spot, strike, timeToExpirySec, volatility, rate, payout);
    }

    function getBinaryPutPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate,
        uint128 payout
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBinary.getBinaryPutPrice(spot, strike, timeToExpirySec, volatility, rate, payout);

        endGas = gasleft();

        return (result, startGas - endGas);
    }
}
