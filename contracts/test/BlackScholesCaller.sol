// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Uncomment this line to use console.log
import "hardhat/console.sol";
import "../blackscholes/BlackScholesNUM.sol";

contract BlackScholesCaller {

    function getCallOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint16 rate // todo: def need more precise rate
    ) external pure returns (uint256 price) {
        return BlackScholesNUM.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getPutOptionPrice(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint16 rate // todo: def need more precise rate
    ) external pure returns (uint256 price) {
        return BlackScholesNUM.getPutOptionPrice(spot, strike, timeToExpirySec, volatility, rate);
    }

    function getFuturePrice(uint128 spot, uint32 timeToExpirySec, uint16 rate) external pure returns (uint256) {
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

    function getD1(uint128 spot, uint128 strike, uint256 scaledVol, uint256 scaledRate) external pure returns (int256) {
        return BlackScholesNUM.getD1(spot, strike, scaledVol, scaledRate);
    }

      // using erf function
    function stdNormCDF(int256 x) external pure returns (uint256) {
        return BlackScholesNUM.stdNormCDF(x);
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

    function lnMG(uint256 x) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = BlackScholesNUM.lnUpper(x);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    function sqrtMG(uint256 x) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = BlackScholesNUM.sqrt(x);

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

    function getCallOptionPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint16 rate
    ) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = BlackScholesNUM.getCallOptionPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();
        
        return startGas - endGas;
    }

    function getPutOptionPriceMG(
        uint128 spot,
        uint128 strike,
        uint32 timeToExpirySec,
        uint64 volatility,
        uint16 rate
    ) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = BlackScholesNUM.getPutOptionPrice(spot, strike, timeToExpirySec, volatility, rate);

        endGas = gasleft();
        
        return startGas - endGas;
    }
}
