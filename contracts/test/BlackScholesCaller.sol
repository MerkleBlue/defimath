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

     function expNegative(uint256 x) external pure returns (uint256) {
        return BlackScholesNUM.expNegative(x);
    }

    function expPositive(uint256 x) external pure returns (uint256) {
        return BlackScholesNUM.expPositive(x);
    }

    function ln(uint256 x) external pure returns (int256) {
        return BlackScholesNUM.ln(x);
    }

    // x: [1, 16] 
    function lnUpper(uint256 x) external pure returns (uint256) {
       return BlackScholesNUM.lnUpper(x);
    }

    function sqrt(uint256 x) external pure returns (uint256) {
        return BlackScholesNUM.sqrt(x);
    }

    // x: [1, 1e8]
    function sqrtUpper(uint256 x) external pure returns (uint256) {
        return BlackScholesNUM.sqrtUpper(x);
    }

    function sin(uint256 x) external pure returns (int256) {
        return BlackScholesNUM.sin(x);
    }

    function getD1(uint128 spot, uint128 strike, uint256 scaledVol, uint256 scaledRate) external pure returns (int256) {
        return BlackScholesNUM.getD1(spot, strike, scaledVol, scaledRate);
    }

    function stdNormCDF(int256 x) external pure returns (uint256) {
        return BlackScholesNUM.stdNormCDF(x);
    }

    function erfPositiveHalf(uint256 x) external pure returns (uint256) {
        return BlackScholesNUM.erfPositiveHalf(x);
    }

    function expPositiveMG(uint256 x) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = BlackScholesNUM.expPositive(x);

        endGas = gasleft();

        return startGas - endGas;
    }

    // measure gas

    function lnMG(uint256 x) external view returns (uint256) {
        uint256 resultUint256;
        int256 resultInt256;
        uint256 startGas;
        uint256 endGas;
        if (x >= 1e18) {
            startGas = gasleft();
            resultUint256 = BlackScholesNUM.lnUpper(x);
            endGas = gasleft();
        } else {
            startGas = gasleft();
            resultInt256 = BlackScholesNUM.ln(x);
            endGas = gasleft();
        }
        
        return startGas - endGas;
    }

    function sqrtMG(uint256 x) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        if (x >= 1e18) {
            startGas = gasleft();
            result = BlackScholesNUM.sqrtUpper(x);
            endGas = gasleft();
        } else {
            startGas = gasleft();
            result = BlackScholesNUM.sqrt(x);
            endGas = gasleft();
        }

        
        return startGas - endGas;
    }

    function sinMG(uint256 x) external view returns (uint256) {
        int256 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        result = BlackScholesNUM.sin(x);
        endGas = gasleft();

        return startGas - endGas;
    }

    function stdNormCDFMG(int256 x) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = BlackScholesNUM.stdNormCDF(x);

        endGas = gasleft();
        
        return startGas - endGas;
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
