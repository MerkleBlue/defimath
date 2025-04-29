// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../math/Math.sol";

contract MathWrapper {

    function exp(int256 x) external pure returns (uint256) {
        return DeFiMath.exp(x);
    }

    function ln(uint256 x) external pure returns (int256) {
        return DeFiMath.ln(x);
    }

    function log2(uint256 x) external pure returns (int256) {
        return DeFiMath.log2(x);
    }

    function log10(uint256 x) external pure returns (int256) {
        return DeFiMath.log10(x);
    }
    
    function sqrtTime(uint256 x) external pure returns (uint256) {
        return DeFiMath.sqrtTime(x);
    }

    function sqrt(uint256 x) external pure returns (uint256) {
        return DeFiMath.sqrt(x);
    }

    function stdNormCDF(int256 x) external pure returns (uint256) {
        return DeFiMath.stdNormCDF(x);
    }

    function expPositive(uint256 x) external pure returns (uint256) {
        return DeFiMath.expPositive(x);
    }

    function erfPositiveHalf(uint256 x) external pure returns (uint256) {
        return DeFiMath.erfPositiveHalf(x);
    }

    // measure gas

    function expMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = DeFiMath.exp(x);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function expPositiveMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = DeFiMath.expPositive(x);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function lnMG(uint256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.ln(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function ln16MG(uint256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.ln16(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function log2MG(uint256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.log2(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function log10MG(uint256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.log10(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function sqrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.sqrt(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function sqrtTimeMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.sqrtTime(x);
        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function stdNormCDFMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        y = DeFiMath.stdNormCDF(x);

        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function erfMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        y = DeFiMath.erfPositiveHalf(x);

        endGas = gasleft();
        
        return (y, startGas - endGas);
    }
}
