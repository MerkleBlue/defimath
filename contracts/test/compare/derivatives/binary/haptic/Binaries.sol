//SPDX-License-Identifier: ISC
pragma solidity ^0.8.18;

import "./BlackScholes.sol";

/**
 * @title Binaries
 * @author Haptic
 * @dev Contract to compute the black scholes price of binary options.
 */
library Binaries {
    using DecimalMath
    for uint;
    using SignedDecimalMath
    for int;

    function _cashOrNothingPrices(
        BlackScholes.BlackScholesInputs memory bsInput
    ) internal pure returns(uint call, uint put) {
        uint tAnnualised = BlackScholes._annualise(bsInput.timeToExpirySec);
        int ratePrecise = bsInput.rateDecimal.decimalToPreciseDecimal();
        (, int d2) = BlackScholes._d1d2(
            tAnnualised,
            bsInput.volatilityDecimal.decimalToPreciseDecimal(),
            bsInput.spotDecimal.decimalToPreciseDecimal(),
            bsInput.strikePriceDecimal.decimalToPreciseDecimal(),
            ratePrecise
        );

        // Cash-or-nothing call
        uint term1 = FixedPointMathLib.expPrecise(int(-ratePrecise.multiplyDecimalRoundPrecise(int(tAnnualised))));
        uint term2 = BlackScholes._stdNormalCDF(d2);
        call = (term1.multiplyDecimalRoundPrecise(term2)).preciseDecimalToDecimal();

        // // Cash-or-nothing put
        term2 = BlackScholes._stdNormalCDF(-d2);
        put = (term1.multiplyDecimalRoundPrecise(term2)).preciseDecimalToDecimal();
    }

    function _assetOrNothingPrices(
        BlackScholes.BlackScholesInputs memory bsInput
    ) internal pure returns(uint call, uint put) {
        uint tAnnualised = BlackScholes._annualise(bsInput.timeToExpirySec);
        int ratePrecise = bsInput.rateDecimal.decimalToPreciseDecimal();
        uint spotPrecise = bsInput.spotDecimal.decimalToPreciseDecimal();

        (int d1, ) = BlackScholes._d1d2(
            tAnnualised,
            bsInput.volatilityDecimal.decimalToPreciseDecimal(),
            bsInput.spotDecimal.decimalToPreciseDecimal(),
            bsInput.strikePriceDecimal.decimalToPreciseDecimal(),
            ratePrecise
        );

        // Asset-or-nothing call
        uint spotPricePV = spotPrecise.multiplyDecimalRoundPrecise(
            FixedPointMathLib.expPrecise(int(-ratePrecise.multiplyDecimalRoundPrecise(int(tAnnualised))))
        );

        uint term1 = BlackScholes._stdNormalCDF(d1);
        call = (spotPricePV.multiplyDecimalRoundPrecise(term1)).preciseDecimalToDecimal();

        // Asset-or-nothing put
        uint term2 = BlackScholes._stdNormalCDF(-d1);
        put = (spotPricePV.multiplyDecimalRoundPrecise(term2)).preciseDecimalToDecimal();
    }
}