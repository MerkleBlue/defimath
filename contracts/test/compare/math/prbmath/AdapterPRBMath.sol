// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SD59x18, sd, exp, ln, log2, log10, sqrt } from "./lib/SD59x18.sol";

contract AdapterPRBMath {

    function expMG(int256 x) external view returns (uint256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = exp(sd(x));

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (uint256(result.unwrap()), gasUsed);
    }

    function lnMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = ln(sd(x));

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (result.unwrap(), gasUsed);
    }

    function log2MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = log2(sd(x));

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (result.unwrap(), gasUsed);
    }

    function log10MG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = log10(sd(x));

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (result.unwrap(), gasUsed);
    }

    function sqrtMG(uint256 x) external view returns (uint256 y, uint256 gasUsed) {
        SD59x18 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = sqrt(sd(int256(x)));

        endGas = gasleft();
        
        gasUsed = startGas - endGas;
        return (uint256(result.unwrap()), gasUsed);
    }
}
