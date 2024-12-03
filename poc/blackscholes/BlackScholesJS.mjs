// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 1;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// strike price 5x from spot price
export const STRIKE_MIN = 200; // 20;
export const STRIKE_MAX = 300; // 500;
export const STRIKE_STEP = 2;

export class BlackScholesJS {

  constructor(lookupTable) {
    this.lookupTable = lookupTable;
  }

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallOptionPrice(spot, strike, timeToExpirySec, vol, rate) {
    // step 1: set the overall scale first
    const spotScale = spot / SPOT_FIXED;

    // step 2: calculate strike scaled
    const future = this.getFuturePrice(spot, rate, timeToExpirySec);
    const strikeScaled = (strike / future) * SPOT_FIXED;

    // step 3: set the expiration based on volatility
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = Math.round(timeToExpirySec * (volRatio * volRatio));

    // step 4: interpolate price
    const finalPrice = this.interpolatePriceQuadratic(strikeScaled, timeToExpirySecScaled);

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
    const finalPrice = this.interpolatePriceQuadratic(strikeScaled, timeToExpirySecScaled);

    // finally, scale the price back to the original spot
    const callPrice = finalPrice * spotScale;

    return callPrice + discountedStrike - spot;
  };

  // NOTE: rate: 20% and time: 1 year gives max error of 0.000045%
  // same for rate: 10% and time: 2 years
  // So basically, if rate * years < 0.2, we are good, if not, use other method maybe?
  getFuturePrice(spot, timeToExpirySec, rate) {

    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const x = rate * timeToExpiryYears;
    if (x <= 0.2) {
      // we use Pade approximation for exp(x)
      // e ^ (x) ≈ ((x + 3) ^ 2 + 3) / ((x - 3) ^ 2 + 3)
      const numerator = (x + 3) ** 2 + 3;
      const denominator = (x - 3) ** 2 + 3;
      const futurePrice = spot * (numerator / denominator);

      return futurePrice;
    }

    // todo: implement other method, this method gives error when x > 0.2
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

  interpolatePriceQuadratic(strikeScaled, timeToExpirySecScaled) {
    // todo: handle 0 time and 0 strike

    // step 1) get the specific cell
    const strikeIndex = this.getIndexFromStrike(strikeScaled);
    const timeToExpiryIndex = this.getIndexFromTime(timeToExpirySecScaled);
    const cell = this.lookupTable.get(strikeIndex * 1000 + timeToExpiryIndex);
    // console.log("strikeIndex:", strikeIndex);
    // console.log("timeToExpiryIndex:", timeToExpiryIndex);

    // step 2) calculate the time delta and weight
    const timeToExpiryFromIndex = this.getTimeFromIndex(timeToExpiryIndex);
    const expirationStep = 2 ** (Math.floor(timeToExpiryIndex / 10) - 3);
    const timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) / expirationStep;
    // console.log("timeToExpiryFromIndex:", timeToExpiryFromIndex);
    // console.log("expirationStep:", expirationStep);
    // console.log("timeToExpiryWeight: %d", timeToExpiryWeight);

    // step 3) calculate the strike delta
    const deltaStrike = strikeScaled - this.getStrikeFromIndex(strikeIndex);
    // console.log("strikeScaled", strikeScaled, "strikeFromIndex:", this.getStrikeFromIndex(strikeIndex));
    // console.log("deltaStrike:", deltaStrike);

    // step 4) interpolate the price using quadratic interpolation
    // console.log("cell", cell);
    const interpolatedPrice1 = cell.a1 * (timeToExpiryWeight ** 2) + cell.b1 * timeToExpiryWeight;
    const interpolatedPrice3 = cell.a3 * (deltaStrike ** 2) + cell.b3 * deltaStrike;
    const interpolatedPrice4 = cell.a4 * (deltaStrike ** 2) + cell.b4 * deltaStrike;
    // console.log("interpolatedPrice1", interpolatedPrice1);
    // console.log("interpolatedPrice3", interpolatedPrice3);
    // console.log("interpolatedPrice4", interpolatedPrice4);

    // step 5) calculate the final price
    const extrisicPriceAA = Math.max(0, 100 - strikeIndex);
    const intrinsicPriceAA = cell.optionPriceAA - extrisicPriceAA;

    const extrinsicPriceTA = Math.max(0, 100 - strikeScaled);

    const interpolatedPriceStrike = interpolatedPrice3 + timeToExpiryWeight * (interpolatedPrice4 - interpolatedPrice3);


    // const finalPrice = cell.optionPriceAA + interpolatedPrice1 + interpolatedPriceStrike;
    const finalPrice = extrinsicPriceTA + intrinsicPriceAA + interpolatedPrice1 + interpolatedPriceStrike;
    // console.log("extrisicPriceAA", extrisicPriceAA);
    // console.log("intrinsicPriceAA", intrinsicPriceAA);
    // console.log("interpolatedPriceStrike", interpolatedPriceStrike);

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

  getIndexFromStrike2(strike) {

    // strike 300 - 500 => abs error < $0.002714 step 4
    // strike 200 - 300 => abs error < $0.005806 step 4
    // strike 200 - 300 => abs error < $0.002836 step 2
    

    // if (strike >= 200)
    // const multiplier = strike / STRIKE_STEP;
    // let roundedRatio = Math.floor(multiplier) * STRIKE_STEP;

    // // NOTE: floating point precision issue, so we need to check if very close to the upper edge
    // if (Math.floor(multiplier) !== Math.floor(multiplier + 0.000000001)) {
    //   roundedRatio = Math.floor(multiplier + 0.000000001) * STRIKE_STEP;
    // }

    // return Math.round(roundedRatio);
  }

  getStrikeFromIndex2(index) {
    return index * 10;
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