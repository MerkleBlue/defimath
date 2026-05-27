// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

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

    function pow(uint256 x, int256 a) external pure returns (uint256) {
        return DeFiMath.pow(x, a);
    }

    function sqrtTime(uint256 x) external pure returns (uint256) {
        return DeFiMath.sqrtTime(x);
    }

    function sqrt(uint256 x) external pure returns (uint256) {
        return DeFiMath.sqrt(x);
    }

    function cbrt(uint256 x) external pure returns (uint256) {
        return DeFiMath.cbrt(x);
    }

    function stdNormCDF(int256 x) external pure returns (uint256) {
        return DeFiMath.stdNormCDF(x);
    }

    function erf(int256 x) external pure returns (int256) {
        return DeFiMath.erf(x);
    }

    function expPositive(uint256 x) external pure returns (uint256) {
        return DeFiMath.expPositive(x);
    }

    function erfPositiveHalf(uint256 x) external pure returns (uint256) {
        return DeFiMath.erfPositiveHalf(x);
    }

    function expm1(int256 x) external pure returns (int256) {
        return DeFiMath.expm1(x);
    }

    function log1p(int256 x) external pure returns (int256) {
        return DeFiMath.log1p(x);
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

    function powMG(uint256 x, int256 a) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.pow(x, a);
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

    function cbrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = DeFiMath.cbrt(x);
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

    function erfMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        y = DeFiMath.erf(x);

        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function expm1MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = DeFiMath.expm1(x);
        return (y, startGas - gasleft());
    }

    function log1pMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = DeFiMath.log1p(x);
        return (y, startGas - gasleft());
    }
}
