// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 1;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// ratio between spot and strike (spot: 100$, strike: $50 - $200)
export const S_S_RATIO_MIN = 0.5;
export const S_S_RATIO_MAX = 2;
export const S_S_RATIO_STEP = 0.05;

export const EXPIRATION_MIN = 10; // * SECONDS_IN_DAY;
export const EXPIRATION_MAX = 1000; //  * SECONDS_IN_DAY;
export const EXPIRATION_STEP = 1.25; //  * SECONDS_IN_DAY;


export class BlackScholesJS {

  constructor(lookupTable) {
    this.lookupTable = lookupTable;
  }

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate future and spot-strike ratio
    const future = this.getFuturePrice(spot, rate, timeToExpirySec);
    const spotStrikeRatio = future / strike;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);

    // step 4: interpolate price
    const finalPrice = this.interpolatePrice(spotStrikeRatio, timeToExpirySecScaled, timeToExpirySec);

    // finally, scale the price back to the original spot
    return finalPrice * spotScale;
  };

  getPutOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate future and spot-strike ratio
    const discountedStrike = this.getDiscountedStrikePrice(strike, rate, timeToExpirySec);
    const spotStrikeRatio = spot / discountedStrike;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);

    // step 4: interpolate price
    const finalPrice = this.interpolatePrice(spotStrikeRatio, timeToExpirySecScaled, timeToExpirySec);

    // finally, scale the price back to the original spot
    const callPrice = finalPrice * spotScale;

    return callPrice + discountedStrike - spot;
  };

  // NOTE: rate: 20% and time: 1 year gives max error of 0.000045%
  // same for rate: 10% and time: 2 years
  // So basically, if rate * years < 0.2, we are good, if not, use other method maybe?
  getFuturePrice(spot, timeToExpirySec, rate) {
    // we use Pade approximation for exp(x)
    // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const x = rate * timeToExpiryYears;
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const futurePrice = spot * (numerator / denominator);

    return futurePrice;
  };

  getDiscountedStrikePrice(strike, timeToExpirySec, rate) {
    // we use Pade approximation for exp(x)
    // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const x = rate * timeToExpiryYears;
    const numerator = (x + 3) ** 2 + 3;
    const denominator = (x - 3) ** 2 + 3;
    const discountedStrikePrice = strike * (denominator / numerator);

    return discountedStrikePrice;
  };

  interpolatePrice(spotStrikeRatio, timeToExpirySecScaled, timeToExpirySec) {
    const spotStrikeRatioIndex = this.getIndexFromSpotStrikeRatio(spotStrikeRatio);
    const timeToExpiryIndex = this.getIndexFromTime(timeToExpirySecScaled);
    const cell = this.lookupTable.get(spotStrikeRatioIndex * 1000 + timeToExpiryIndex);

    // step 5: interpolate the option price using linear interpolation
    const spotStrikeRatioFromIndex = this.getSpotStrikeRatioFromIndex(spotStrikeRatioIndex);
    const spotStrikeWeight = (spotStrikeRatio - spotStrikeRatioFromIndex) / S_S_RATIO_STEP;

    const expirationStep = 2 ** (Math.floor(timeToExpiryIndex / 10) - 3);
    const timeToExpiryFromIndex = this.getTimeFromIndex(timeToExpiryIndex);
    const timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) / expirationStep;

    const wPriceA = cell.optionPriceAA * (1 - timeToExpiryWeight) + cell.optionPriceAB * timeToExpiryWeight;
    const wPriceB = cell.optionPriceBA * (1 - timeToExpiryWeight) + cell.optionPriceBB * timeToExpiryWeight;

    const finalPrice = wPriceA * (1 - spotStrikeWeight) + wPriceB * spotStrikeWeight;
    //4 points coordinates: range - 4 option prices

    // finally, scale the price back to the original spot
    return finalPrice * spotScale;
  }

  getIndexFromTime(timeToExpirySec) {
    if (timeToExpirySec < 8) {
      return timeToExpirySec;
    }

    const major = this.findMajor(timeToExpirySec);
    const minor = this.findMinor(timeToExpirySec, major);

    return major * 10 + minor;
  }

  getTimeFromIndex(index) {
    const major = Math.floor(index / 10);
    const minor = index % 10;

    if (major < 3) {
      return minor;
    }

    return 2 ** major + 2 ** (major - 3) * minor;
  }

  getIndexFromSpotStrikeRatio(ratio) {
    const multiplier = ratio / S_S_RATIO_STEP;
    let roundedRatio = Math.floor(multiplier) * S_S_RATIO_STEP;
    // console.log("ratio", ratio, roundedRatio, Math.floor(ratio / S_S_RATIO_STEP), ratio / S_S_RATIO_STEP);

    // NOTE: floating point precision issue, so we need to check if very close to the upper edge
    if (Math.floor(multiplier) !== Math.floor(multiplier + 0.000001)) {
      roundedRatio = Math.floor(multiplier + 0.000000001) * S_S_RATIO_STEP;
    }

    return Math.round(roundedRatio * 100);
  }

  getSpotStrikeRatioFromIndex(index) {
    return index / 100;
  }

  findMajor(value) {
    let min = 2;
    let max = 32;
    let result = -1;

    while (min <= max) {
      const mid = Math.floor((min + max) / 2);
      const power = 2 ** mid;

      if (power <= value) {
          result = mid;    // mid is a valid candidate
          min = mid + 1;   // search for a larger power
      } else {
          max = mid - 1;   // search for a smaller power
      }
    }

    return result;
  }

  findMinor(value, power) {
    // console.log(value - 2 ** power);
    return Math.floor((value - 2 ** power) / (2 ** (power - 3)));
  }
}