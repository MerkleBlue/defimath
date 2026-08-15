// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "../math/Math.sol";

contract MathWrapper {

    function exp(int256 x) external pure returns (uint256) {
        return Math.exp(x);
    }

    function ln(uint256 x) external pure returns (int256) {
        return Math.ln(x);
    }

    function log2(uint256 x) external pure returns (int256) {
        return Math.log2(x);
    }

    function log10(uint256 x) external pure returns (int256) {
        return Math.log10(x);
    }

    function pow(uint256 x, int256 a) external pure returns (uint256) {
        return Math.pow(x, a);
    }

    function sqrtTime(uint256 x) external pure returns (uint256) {
        return Math.sqrtTime(x);
    }

    function sqrt(uint256 x) external pure returns (uint256) {
        return Math.sqrt(x);
    }

    function cbrt(uint256 x) external pure returns (uint256) {
        return Math.cbrt(x);
    }

    function mulDiv(uint256 a, uint256 b, uint256 d) external pure returns (uint256) {
        return Math.mulDiv(a, b, d);
    }

    function mul(uint256 a, uint256 b) external pure returns (uint256) {
        return Math.mul(a, b);
    }

    function abs(int256 x) external pure returns (uint256) {
        return Math.abs(x);
    }

    function min(uint256 x, uint256 y) external pure returns (uint256) {
        return Math.min(x, y);
    }

    function max(uint256 x, uint256 y) external pure returns (uint256) {
        return Math.max(x, y);
    }

    function clamp(uint256 x, uint256 lo, uint256 hi) external pure returns (uint256) {
        return Math.clamp(x, lo, hi);
    }

    function avg(uint256 x, uint256 y) external pure returns (uint256) {
        return Math.avg(x, y);
    }

    function stdNormCDF(int256 x) external pure returns (uint256) {
        return Math.stdNormCDF(x);
    }

    function stdNormPDF(int256 x) external pure returns (uint256) {
        return Math.stdNormPDF(x);
    }

    function erf(int256 x) external pure returns (int256) {
        return Math.erf(x);
    }

    function expPositive(uint256 x) external pure returns (uint256) {
        return Math.expPositive(x);
    }

    function expm1(int256 x) external pure returns (int256) {
        return Math.expm1(x);
    }

    function log1p(int256 x) external pure returns (int256) {
        return Math.log1p(x);
    }

    // measure gas

    function expMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = Math.exp(x);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function expPositiveMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = Math.expPositive(x);

        endGas = gasleft();

        return (result, startGas - endGas);
    }

    function lnMG(uint256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = Math.ln(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }


    function log2MG(uint256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = Math.log2(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function log10MG(uint256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = Math.log10(x);
        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function powMG(uint256 x, int256 a) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = Math.pow(x, a);
        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function sqrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = Math.sqrt(x);
        endGas = gasleft();

        return (y, startGas - endGas);
    }


    function cbrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = Math.cbrt(x);
        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function mulDivMG(uint256 a, uint256 b, uint256 d) external view returns (uint256 z, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        z = Math.mulDiv(a, b, d);
        endGas = gasleft();

        return (z, startGas - endGas);
    }

    function mulMG(uint256 a, uint256 b) external view returns (uint256 z, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        z = Math.mul(a, b);
        endGas = gasleft();

        return (z, startGas - endGas);
    }

    function absMG(int256 x) external view returns (uint256 z, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        z = Math.abs(x);
        endGas = gasleft();

        return (z, startGas - endGas);
    }

    function minMG(uint256 x, uint256 y) external view returns (uint256 z, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        z = Math.min(x, y);
        endGas = gasleft();

        return (z, startGas - endGas);
    }

    function maxMG(uint256 x, uint256 y) external view returns (uint256 z, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        z = Math.max(x, y);
        endGas = gasleft();

        return (z, startGas - endGas);
    }

    function clampMG(uint256 x, uint256 lo, uint256 hi) external view returns (uint256 z, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        z = Math.clamp(x, lo, hi);
        endGas = gasleft();

        return (z, startGas - endGas);
    }

    function avgMG(uint256 x, uint256 y) external view returns (uint256 z, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        z = Math.avg(x, y);
        endGas = gasleft();

        return (z, startGas - endGas);
    }

    // -----------------------------------------------------------------------
    // Batch gas measurement.
    //
    // For tiny inlined functions like min/max/avg, a single-call wrapper
    // mis-measures because the Solidity optimizer hoists the pure computation
    // out of the gasleft() window. The chained-call pattern below forces each
    // iteration to depend on the previous result, so the optimizer cannot
    // reorder calls out of the measurement region.
    //
    // To isolate the function's marginal cost from loop overhead, callers
    // measure each functionBatchMG against noopBatchMG (same loop shape, no
    // function call) and subtract: per_call_cost = (batch_gas - noop_gas) / N.
    // -----------------------------------------------------------------------

    function noopBatchMG(uint256[] calldata xs) external view returns (uint256 acc, uint256 totalGas) {
        uint256 startGas = gasleft();
        acc = xs[0];
        unchecked {
            for (uint256 i = 1; i < xs.length; i++) {
                acc = acc ^ xs[i];
            }
        }
        uint256 endGas = gasleft();
        return (acc, startGas - endGas);
    }

    function minBatchMG(uint256[] calldata xs) external view returns (uint256 acc, uint256 totalGas) {
        uint256 startGas = gasleft();
        acc = xs[0];
        unchecked {
            for (uint256 i = 1; i < xs.length; i++) {
                acc = Math.min(acc, xs[i]);
            }
        }
        uint256 endGas = gasleft();
        return (acc, startGas - endGas);
    }

    function maxBatchMG(uint256[] calldata xs) external view returns (uint256 acc, uint256 totalGas) {
        uint256 startGas = gasleft();
        acc = xs[0];
        unchecked {
            for (uint256 i = 1; i < xs.length; i++) {
                acc = Math.max(acc, xs[i]);
            }
        }
        uint256 endGas = gasleft();
        return (acc, startGas - endGas);
    }

    function avgBatchMG(uint256[] calldata xs) external view returns (uint256 acc, uint256 totalGas) {
        uint256 startGas = gasleft();
        acc = xs[0];
        unchecked {
            for (uint256 i = 1; i < xs.length; i++) {
                acc = Math.avg(acc, xs[i]);
            }
        }
        uint256 endGas = gasleft();
        return (acc, startGas - endGas);
    }

    function sqrtTimeMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = Math.sqrtTime(x);
        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function stdNormCDFMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        y = Math.stdNormCDF(x);

        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function stdNormPDFMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        y = Math.stdNormPDF(x);

        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function erfMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        y = Math.erf(x);

        endGas = gasleft();

        return (y, startGas - endGas);
    }

    function expm1MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = Math.expm1(x);
        return (y, startGas - gasleft());
    }

    function log1pMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas = gasleft();
        y = Math.log1p(x);
        return (y, startGas - gasleft());
    }
}
