// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./lib/Gaussian.sol";

contract AdapterSolStat {

    function cdfMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        y = Gaussian.cdf(x);

        endGas = gasleft();
        
        return (y, startGas - endGas);
    }

    function erfMG(int256 x) external view returns (int256 y, uint256 gasUsed) {
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        y = Gaussian.erfc(x);

        endGas = gasleft();
        
        return (1e18 - y, startGas - endGas);
    }

}
