// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "../derivatives/Binary.sol";

contract BinaryWrapper {

    function getBinaryCallPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathBinary.getBinaryCallPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getBinaryCallPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBinary.getBinaryCallPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function getBinaryPutPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathBinary.getBinaryPutPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getBinaryPutPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBinary.getBinaryPutPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function getBinaryDelta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 deltaCall, int128 deltaPut) {
        return DeFiMathBinary.getBinaryDelta(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getBinaryDeltaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 deltaCall, int128 deltaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (deltaCall, deltaPut) = DeFiMathBinary.getBinaryDelta(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();

        return (deltaCall, deltaPut, startGas - endGas);
    }

    function getBinaryGamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 gammaCall, int128 gammaPut) {
        return DeFiMathBinary.getBinaryGamma(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getBinaryGammaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 gammaCall, int128 gammaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (gammaCall, gammaPut) = DeFiMathBinary.getBinaryGamma(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();

        return (gammaCall, gammaPut, startGas - endGas);
    }

    function getBinaryTheta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 thetaCall, int128 thetaPut) {
        return DeFiMathBinary.getBinaryTheta(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getBinaryThetaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 thetaCall, int128 thetaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (thetaCall, thetaPut) = DeFiMathBinary.getBinaryTheta(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();

        return (thetaCall, thetaPut, startGas - endGas);
    }
}
