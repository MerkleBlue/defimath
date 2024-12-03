// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 1;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// strike price +-5x from spot price
export const STRIKE_MIN = 20;
export const STRIKE_MAX = 500;

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
    // console.log("strikeIndex:", strikeIndex);
    // console.log("timeToExpiryIndex:", timeToExpiryIndex);
    const cell = this.lookupTable.get(strikeIndex * 1000 + timeToExpiryIndex);


    // step 2) calculate the time delta and weight
    const timeToExpiryFromIndex = this.getTimeFromIndex(timeToExpiryIndex);
    const expirationStep = 2 ** (Math.floor(timeToExpiryIndex / 10) - 3);
    const timeToExpiryWeight = (timeToExpirySecScaled - timeToExpiryFromIndex) / expirationStep;
    // console.log("timeToExpiryFromIndex:", timeToExpiryFromIndex);
    // console.log("expirationStep:", expirationStep);
    // console.log("timeToExpiryWeight: %d", timeToExpiryWeight);

    // step 3) calculate the strike delta
    const deltaStrike = strikeScaled - this.getStrikeFromIndex(strikeIndex);
    // console.log("strikeScaled", strikeScaled, "strikeFromIndex:", this.getStrikeFromIndex2(strikeIndex));
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
    const extrisicPriceAA = Math.max(0, 100 - this.getStrikeFromIndex(strikeIndex));
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
    // tested
    // strike 200 - 800 => max abs error < $0.002595 step 0.4, 60s - 4y
    // strike 800 - 1050 => max abs error < $0.005226 step 0.2, 60s - 4y
    // strike 1050 - 1200 => max abs error < $0.002816 step 0.5, 60s - 4y
    // strike 1200 - 2000 => max abs error < $0.002999 step 1, 60s - 4y
    // strike 2000 - 5000 => max abs error < $0.005805 step 4, 60s - 4y
    

    if (strike >= 200 && strike <= 500) {
      const rest = strike - 200;
      const step = 4;
      return Math.round(2000 + Math.floor(rest / step) * step * 10);
    }

    if (strike >= 120 && strike < 200) {
      const rest = strike - 120;
      const step = 1;
      return Math.round(1200 + Math.floor(rest / step) * step * 10);
    }

    if (strike >= 105 && strike < 120) {
      const rest = strike - 105;
      const step = 0.5;
      return Math.round(1050 + Math.floor(rest / step) * step * 10);
    }

    if (strike >= 80 && strike < 105) {
      const rest = strike - 80;
      const step = 0.2;
      return Math.round(800 + Math.floor(rest / step) * step * 10);
    }

    if (strike >= 20 && strike < 80) {
      const rest = strike - 20;
      const step = 0.4;
      return Math.round(200 + Math.floor(rest / step) * step * 10);
    }
  }

  getStrikeFromIndex(index) {
    // since 0.1 is the smallest step, we can just return the index / 10
    return index / 10;
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