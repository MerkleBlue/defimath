// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SD59x18, sd, exp, ln, log2, log10, sqrt } from "./lib/SD59x18.sol";

contract AdapterPRBMath {

    function expMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;
        SD59x18 sdX = sd(x);

        startGas = gasleft();
        result = exp(sdX);
        endGas = gasleft();
        
        return (uint256(result.unwrap()), startGas - endGas);
    }

    function lnMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;
        SD59x18 sdX = sd(x);

        startGas = gasleft();
        result = ln(sdX);
        endGas = gasleft();
        
        return (result.unwrap(), startGas - endGas);
    }

    function log2MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;
        SD59x18 sdX = sd(x);

        startGas = gasleft();
        result = log2(sdX);
        endGas = gasleft();
        
        return (result.unwrap(), startGas - endGas);
    }

    function log10MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;
        SD59x18 sdX = sd(x);

        startGas = gasleft();
        result = log10(sdX);
        endGas = gasleft();
        
        return (result.unwrap(), startGas - endGas);
    }

    function sqrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;
        SD59x18 sdX = sd(int256(x));

        startGas = gasleft();
        result = sqrt(sdX);
        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (uint256(result.unwrap()), gasUsed);
    }
}
