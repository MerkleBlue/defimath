// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { SD59x18, sd, exp } from "./lib/SD59x18.sol";

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
}
