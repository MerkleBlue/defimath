// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./lib/ABDKMathQuad.sol";

import "hardhat/console.sol";

contract AdapterABDKMath {

    function expMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        bytes16 result;
        uint256 startGas;
        uint256 endGas;

        bytes16 quadX = ABDKMathQuad.div(
            ABDKMathQuad.fromInt(x),
            ABDKMathQuad.fromInt(1e18)
        );

        startGas = gasleft();

        result = ABDKMathQuad.exp(quadX);

        endGas = gasleft();
        
        return (uint256(ABDKMathQuad.toInt(ABDKMathQuad.mul(result, ABDKMathQuad.fromInt(1e18)))), startGas - endGas);
    }

    function lnMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        bytes16 result;
        uint256 startGas;
        uint256 endGas;

        bytes16 quadX = ABDKMathQuad.div(
            ABDKMathQuad.fromInt(x),
            ABDKMathQuad.fromInt(1e18)
        );

        startGas = gasleft();

        result = ABDKMathQuad.ln(quadX);

        endGas = gasleft();
        
        return (int256(ABDKMathQuad.toInt(ABDKMathQuad.mul(result, ABDKMathQuad.fromInt(1e18)))), startGas - endGas);
    }

    function log2MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        bytes16 result;
        uint256 startGas;
        uint256 endGas;

        bytes16 quadX = ABDKMathQuad.div(
            ABDKMathQuad.fromInt(x),
            ABDKMathQuad.fromInt(1e18)
        );

        startGas = gasleft();

        result = ABDKMathQuad.log_2(quadX);

        endGas = gasleft();
        
        return (int256(ABDKMathQuad.toInt(ABDKMathQuad.mul(result, ABDKMathQuad.fromInt(1e18)))), startGas - endGas);
    }

    function sqrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        bytes16 result;
        uint256 startGas;
        uint256 endGas;

        bytes16 quadX = ABDKMathQuad.div(
            ABDKMathQuad.fromUInt(x),
            ABDKMathQuad.fromUInt(1e18)
        );

        startGas = gasleft();

        result = ABDKMathQuad.sqrt(quadX);

        endGas = gasleft();
        
        return (uint256(ABDKMathQuad.toInt(ABDKMathQuad.mul(result, ABDKMathQuad.fromInt(1e18)))), startGas - endGas);
    }
}
