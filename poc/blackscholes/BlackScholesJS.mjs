// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 1;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// strike price
export const STRIKE_MIN = 50;
export const STRIKE_MAX = 200;
export const STRIKE_STEP = 5;

// export const EXPIRATION_MIN = 10; // * SECONDS_IN_DAY;
// export const EXPIRATION_MAX = 1000; //  * SECONDS_IN_DAY;
// export const EXPIRATION_STEP = 1.25; //  * SECONDS_IN_DAY;


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
    const strikeScaled = (strike / future) * SPOT_FIXED;
    console.log("future", future, "strike", strike, "strikeScaled", strikeScaled);

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);

    // step 4: interpolate price
    const finalPrice = this.interpolatePriceLinear(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    return finalPrice * spotScale;
  };

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice2(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate future and spot-strike ratio
    const future = this.getFuturePrice(spot, rate, timeToExpirySec);
    const strikeScaled = (strike / future) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);

    // step 4: interpolate price
    const finalPrice = this.interpolatePriceQuadratic1(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    return finalPrice * spotScale;
  };

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice3(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate future and spot-strike ratio
    const future = this.getFuturePrice(spot, rate, timeToExpirySec);
    const strikeScaled = (strike / future) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);

    // step 4: interpolate price
    const finalPrice = this.interpolatePriceQuadratic2(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    return finalPrice * spotScale;
  };

  getPutOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate future and spot-strike ratio
    const discountedStrike = this.getDiscountedStrikePrice(strike, rate, timeToExpirySec);
    const strikeScaled = (discountedStrike / spot) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);

    // step 4: interpolate price
    const finalPrice = this.interpolatePriceLinear(strikeScaled, timeToExpirySecScaled);

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

  interpolatePriceLinear(strikeScaled, timeToExpirySecScaled) {
    const strikeIndex = this.getIndexFromStrike(strikeScaled);
    const timeToExpiryIndex = this.getIndexFromTime(timeToExpirySecScaled);
    const cell = this.lookupTable.get(strikeIndex * 1000 + timeToExpiryIndex);

    // console.log("strikeScaled", strikeScaled, "strikeIndex", strikeIndex);
    // console.log(cell);

    // step 5: interpolate the option price using linear interpolation
    const strikeFromIndex = this.getStrikeFromIndex(strikeIndex);
    const strikeWeight = (strikeScaled - strikeFromIndex) / STRIKE_STEP;

    const expirationStep = 2 ** (Math.floor(timeToExpiryIndex / 10) - 3);
    const timeToExpiryFromIndex = this.getTimeFromIndex(timeToExpiryIndex);
    const timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) / expirationStep;

    const wPriceA = cell.optionPriceAA * (1 - timeToExpiryWeight) + cell.optionPriceAB * timeToExpiryWeight;
    const wPriceB = cell.optionPriceBA * (1 - timeToExpiryWeight) + cell.optionPriceBB * timeToExpiryWeight;

    const finalPrice = wPriceA * (1 - strikeWeight) + wPriceB * strikeWeight;

    return finalPrice;
  }

  interpolatePriceQuadratic1(strikeScaled, timeToExpirySecScaled) {
    const strikeIndex = this.getIndexFromStrike(strikeScaled);
    const timeToExpiryIndex = this.getIndexFromTime(timeToExpirySecScaled);
    const cell = this.lookupTable.get(strikeIndex * 1000 + timeToExpiryIndex);

    // step 5: interpolate the option price using linear interpolation
    const strikeFromIndex = this.getStrikeFromIndex(strikeIndex);
    const strikeWeight = (strikeScaled - strikeFromIndex) / STRIKE_STEP;

    const deltaTime = (timeToExpirySecScaled - this.getTimeFromIndex(timeToExpiryIndex)) / (365 * 24 * 60 * 60);
    // console.log("spotStrikeWeight", spotStrikeWeight, "deltaTime", deltaTime);
    // console.log("spotStrikeRatioFromIndex", spotStrikeRatioFromIndex, "timeFromIndex", this.getTimeFromIndex(timeToExpiryIndex));

    const interpolatedPriceA = cell.a1 * (deltaTime ** 2) + cell.b1 * deltaTime;
    const interpolatedPriceB = cell.a2 * (deltaTime ** 2) + cell.b2 * deltaTime;

    console.log("cell", cell);
    // console.log("optionPriceAA", cell.optionPriceAA);
    console.log("interpolatedPriceA", interpolatedPriceA);
    console.log("interpolatedPriceB", interpolatedPriceB);

    const wPriceA = cell.optionPriceAA + interpolatedPriceA;
    const wPriceB = cell.optionPriceBA + interpolatedPriceB;
    console.log("wPriceA", wPriceA, "wPriceB", wPriceB, "strikeWeight", strikeWeight);

    const finalPrice = wPriceA * (1 - strikeWeight) + wPriceB * strikeWeight;

    return finalPrice;
  }

  interpolatePriceQuadratic2(strikeScaled, timeToExpirySecScaled) {
    const strikeIndex = this.getIndexFromStrike(strikeScaled);
    const timeToExpiryIndex = this.getIndexFromTime(timeToExpirySecScaled);
    const cell = this.lookupTable.get(strikeIndex * 1000 + timeToExpiryIndex);

    // step 5: interpolate the option price using linear interpolation
    const strikeFromIndex = this.getStrikeFromIndex(strikeIndex);
    const strikeWeight = (strikeScaled - strikeFromIndex) / STRIKE_STEP;

    const deltaTime = (timeToExpirySecScaled - this.getTimeFromIndex(timeToExpiryIndex)) / (365 * 24 * 60 * 60);
    // console.log("spotStrikeWeight", spotStrikeWeight, "deltaTime", deltaTime);
    // console.log("spotStrikeRatioFromIndex", spotStrikeRatioFromIndex, "timeFromIndex", this.getTimeFromIndex(timeToExpiryIndex));

    const interpolatedPriceA = cell.a1 * (deltaTime ** 2) + cell.b1 * deltaTime;
    const interpolatedPriceB = cell.a2 * (deltaTime ** 2) + cell.b2 * deltaTime;

    console.log("cell", cell);
    // console.log("optionPriceAA", cell.optionPriceAA);
    console.log("interpolatedPriceA", interpolatedPriceA);
    console.log("interpolatedPriceB", interpolatedPriceB);

    const wPriceA = cell.optionPriceAA + interpolatedPriceA;
    const wPriceB = cell.optionPriceBA + interpolatedPriceB;
    console.log("wPriceA", wPriceA, "wPriceB", wPriceB, "strikeWeight", strikeWeight);

    const finalPrice = wPriceA * (1 - strikeWeight) + wPriceB * strikeWeight;

    return finalPrice;
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

  getIndexFromStrike(strike) {
    const multiplier = strike / STRIKE_STEP;
    let roundedRatio = Math.floor(multiplier) * STRIKE_STEP;

    // NOTE: floating point precision issue, so we need to check if very close to the upper edge
    if (Math.floor(multiplier) !== Math.floor(multiplier + 0.000000001)) {
      roundedRatio = Math.floor(multiplier + 0.000000001) * STRIKE_STEP;
    }

    return Math.round(roundedRatio);
  }

  getStrikeFromIndex(index) {
    return index;
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