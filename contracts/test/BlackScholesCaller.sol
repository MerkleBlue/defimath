// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../derivatives/BlackScholesNUM.sol";

contract BlackScholesCaller {

    function getCallOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return BlackScholesNUM.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getPutOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint64 rate
    ) external pure returns (uint256 price) {
        return BlackScholesNUM.getPutOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint64 rate) external pure returns (uint256) {
        return BlackScholesNUM.getFuturePrice(spot, timeToExpirySec, rate);
    }

    function getFuturePriceMG(
        uint128 spot,
        uint32 timeToExpirySec,
        uint64 rate
    ) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = BlackScholesNUM.getFuturePrice(spot, timeToExpirySec, rate);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    function getCallOptionPriceMG(
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

        result = BlackScholesNUM.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }

    function getPutOptionPriceMG(
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

        result = BlackScholesNUM.getPutOptionPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();
        
        return (result, startGas - endGas);
    }
}
