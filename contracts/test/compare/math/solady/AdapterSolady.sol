// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./lib/FixedPointMathLib.sol";

contract AdapterSolady {

    function expMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = FixedPointMathLib.expWad(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function lnMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        y = FixedPointMathLib.lnWad(x);
        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    // function log2MG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
    //     uint256 startGas;
    //     uint256 endGas;

    //     startGas = gasleft();
    //     y = FixedPointMathLib.log2(x * 1e18 / 2 ** 64);
    //     endGas = gasleft();
        
    //     return (y, startGas - endGas);
    // }

    // function log10MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
    //     SD59x18 result;
    //     uint256 startGas;
    //     uint256 endGas;
    //     SD59x18 sdX = sd(x);

    //     startGas = gasleft();
    //     result = log10(sdX);
    //     endGas = gasleft();
        
    //     return (result.unwrap(), startGas - endGas);
    // }

    function sqrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();
        // NOTE: converting x to 1e36 precision, and counting gas, 
        // simulates fixed-point math in x around 1e18, but function is not
        // actually fixed-point math
        y = FixedPointMathLib.sqrt(x * 1e18);
        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (y, gasUsed);
    }

}
