// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 1;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// ratio between spot and strike (spot: 100$, strike: $60 - $140)
export const S_S_RATIO_MIN = 0.5;
export const S_S_RATIO_MAX = 2;
export const S_S_RATIO_STEP = 0.05;

export const EXPIRATION_MIN = 10; // * SECONDS_IN_DAY;
export const EXPIRATION_MAX = 100; //  * SECONDS_IN_DAY;
export const EXPIRATION_STEP = 5; //  * SECONDS_IN_DAY;

export class BlackScholesJS {

  constructor(lookupTable) {
    this.lookupTable = lookupTable;
  }

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
  }

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallPrice(spot, strike, timeToExpirySec, vol, rate) {
    // set the spot scale first
    const spotScale = spot / SPOT_FIXED;

    const futureScaled = this.getFuturePrice(SPOT_FIXED, rate, timeToExpirySec);
    // console.log("futurePrice", futureScaled);

    const strikeScaled = strike / spotScale;
    // console.log("strikeScaled", strikeScaled);

    const strikeDiscounted = strikeScaled * (SPOT_FIXED / futureScaled);
    // console.log("strikeDiscounted", strikeDiscounted);

    const spotStrikeRatio = SPOT_FIXED / strikeDiscounted;
    // console.log("spotStrikeRatio", spotStrikeRatio);

    // set the expiration based on vol scale
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);
    const timeToExpiryDaysScaled = timeToExpirySecScaled / SECONDS_IN_DAY;
    // console.log("timeToExpirySec", timeToExpirySec, "in years", timeToExpirySec / (365 * 24 * 60 * 60));
    // console.log("timeToExpirySecScaled", timeToExpirySecScaled, "in years", timeToExpirySecScaled / (365 * 24 * 60 * 60));
    // console.log("timeToExpiryDaysScaled", timeToExpiryDaysScaled);

    // find closest record in lookup table
    const spotStrikeRatioIndex = Math.floor((spotStrikeRatio - S_S_RATIO_MIN) / S_S_RATIO_STEP);
    // console.log("spotStrikeRatioIndex", spotStrikeRatioIndex);

    const timeToExpiryIndex = Math.floor((timeToExpiryDaysScaled - EXPIRATION_MIN) / EXPIRATION_STEP);
    // console.log("timeToExpiryIndex", timeToExpiryIndex);

    const range = this.lookupTable[spotStrikeRatioIndex][timeToExpiryIndex];

    // interpolate the option price
    const spotStrikeWeight = (spotStrikeRatio - (S_S_RATIO_MIN + spotStrikeRatioIndex * S_S_RATIO_STEP)) / S_S_RATIO_STEP;
    // console.log("spotStrikeWeight", spotStrikeWeight);
    const timeToExpiryWeight = (timeToExpiryDaysScaled - (EXPIRATION_MIN + timeToExpiryIndex * EXPIRATION_STEP)) / EXPIRATION_STEP;
    // console.log("timeToExpiryWeight", timeToExpiryWeight);

    // console.log("range", range);

    const wPriceA = range.optionPriceAA * (1 - timeToExpiryWeight) + range.optionPriceAB * timeToExpiryWeight;
    const wPriceB = range.optionPriceBA * (1 - timeToExpiryWeight) + range.optionPriceBB * timeToExpiryWeight;
    // console.log("wPriceA", wPriceA, "wPriceB", wPriceB);

    const finalPrice = wPriceA * (1 - spotStrikeWeight) + wPriceB * spotStrikeWeight;
    // console.log("finalPrice", finalPrice);

    return finalPrice * spotScale;

  }

  getTimeIndex(value) {
    if (value < 8) {
      return value;
    }

    const major = this.findMajor(value);
    const minor = this.findMinor(value, major);

    return major * 10 + minor;

  }

  getSpotStrikeIndex(ratio) {
    return Math.floor(ratio * 10);
  }

  findMajor(value) {
    let min = 2;
    let max = 32;
    let result = -1;

    // todo: optimize later, makes 5 loops always
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