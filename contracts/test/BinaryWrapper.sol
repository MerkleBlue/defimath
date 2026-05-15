// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../derivatives/Binary.sol";

contract BinaryWrapper {

    function binaryCallPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathBinary.binaryCallPrice(spot, strike, timeToExp, volatility, rate);
    }

    function binaryCallPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBinary.binaryCallPrice(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function binaryPutPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return DeFiMathBinary.binaryPutPrice(spot, strike, timeToExp, volatility, rate);
    }

    function binaryPutPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (uint256 price, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = DeFiMathBinary.binaryPutPrice(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function binaryDelta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 deltaCall, int128 deltaPut) {
        return DeFiMathBinary.binaryDelta(spot, strike, timeToExp, volatility, rate);
    }

    function binaryDeltaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 deltaCall, int128 deltaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (deltaCall, deltaPut) = DeFiMathBinary.binaryDelta(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (deltaCall, deltaPut, startGas - endGas);
    }

    function binaryGamma(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 gammaCall, int128 gammaPut) {
        return DeFiMathBinary.binaryGamma(spot, strike, timeToExp, volatility, rate);
    }

    function binaryGammaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 gammaCall, int128 gammaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (gammaCall, gammaPut) = DeFiMathBinary.binaryGamma(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (gammaCall, gammaPut, startGas - endGas);
    }

    function binaryTheta(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 thetaCall, int128 thetaPut) {
        return DeFiMathBinary.binaryTheta(spot, strike, timeToExp, volatility, rate);
    }

    function binaryThetaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 thetaCall, int128 thetaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (thetaCall, thetaPut) = DeFiMathBinary.binaryTheta(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (thetaCall, thetaPut, startGas - endGas);
    }

    function binaryVega(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external pure returns (int128 vegaCall, int128 vegaPut) {
        return DeFiMathBinary.binaryVega(spot, strike, timeToExp, volatility, rate);
    }

    function binaryVegaMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExp,
        uint64 volatility,
        uint64 rate
    ) external view returns (int128 vegaCall, int128 vegaPut, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        (vegaCall, vegaPut) = DeFiMathBinary.binaryVega(spot, strike, timeToExp, volatility, rate);

        endGas = gasleft();

        return (vegaCall, vegaPut, startGas - endGas);
    }
}
