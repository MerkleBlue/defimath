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

    // function log2MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
    //     SD59x18 result;
    //     uint256 startGas;
    //     uint256 endGas;

    //     startGas = gasleft();

    //     result = log2(sd(x));

    //     endGas = gasleft();
        
    //     return (result.unwrap(), startGas - endGas);
    // }

    // function log10MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
    //     SD59x18 result;
    //     uint256 startGas;
    //     uint256 endGas;

    //     startGas = gasleft();

    //     result = log10(sd(x));

    //     endGas = gasleft();
        
    //     return (result.unwrap(), startGas - endGas);
    // }

    // function sqrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
    //     SD59x18 result;
    //     uint256 startGas;
    //     uint256 endGas;

    //     startGas = gasleft();

    //     result = sqrt(sd(int256(x)));

    //     endGas = gasleft();
        
    //     gasUsed = startGas - endGas;
    //     return (uint256(result.unwrap()), gasUsed);
    // }
}
