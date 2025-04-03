// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../math/OpenMath.sol";

contract OpenMathWrapper {


     function expNegative(uint256 x) external pure returns (uint256) {
        return OpenMath.expNegative(x);
    }

    function expPositive(uint256 x) external pure returns (uint256) {
        return OpenMath.expPositive(x);
    }

    function ln(uint256 x) external pure returns (int256) {
        return OpenMath.ln(x);
    }

    // x: [1, 16] 
    function lnUpper(uint256 x) external pure returns (uint256) {
       return OpenMath.lnUpper(x);
    }

    function sqrt(uint256 x) external pure returns (uint256) {
        return OpenMath.sqrt(x);
    }

    // x: [1, 1e8]
    function sqrtUpper(uint256 x) external pure returns (uint256) {
        return OpenMath.sqrtUpper(x);
    }

    function stdNormCDF(int256 x) external pure returns (uint256) {
        return OpenMath.stdNormCDF(x);
    }

    function erfPositiveHalf(uint256 x) external pure returns (uint256) {
        return OpenMath.erfPositiveHalf(x);
    }

    function expPositiveMG(uint256 x) public view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;

        startGas = gasleft();

        result = OpenMath.expPositive(x);

        endGas = gasleft();

        return startGas - endGas;
    }

    // measure gas

    function lnMG(uint256 x) external view returns (uint256) {
        uint256 resultUint256;
        int256 resultInt256;
        uint256 startGas;
        uint256 endGas;
        if (x >= 1e18) {
            startGas = gasleft();
            resultUint256 = OpenMath.lnUpper(x);
            endGas = gasleft();
        } else {
            startGas = gasleft();
            resultInt256 = OpenMath.ln(x);
            endGas = gasleft();
        }
        
        return startGas - endGas;
    }

    function sqrtMG(uint256 x) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        if (x >= 1e18) {
            startGas = gasleft();
            result = OpenMath.sqrtUpper(x);
            endGas = gasleft();
        } else {
            startGas = gasleft();
            result = OpenMath.sqrt(x);
            endGas = gasleft();
        }

        
        return startGas - endGas;
    }

    function stdNormCDFMG(int256 x) external view returns (uint256) {
        uint256 result;
        uint256 startGas;
        uint256 endGas;
        startGas = gasleft();

        result = OpenMath.stdNormCDF(x);

        endGas = gasleft();
        
        return startGas - endGas;
    }
}
