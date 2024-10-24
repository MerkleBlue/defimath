// fix the spot price in table to $100, and volatilty to 100%
export const SPOT_FIXED = 100;
export const VOL_FIXED = 1;
export const SECONDS_IN_DAY = 24 * 60 * 60;

// ratio between spot and strike (spot: 100$, strike: $80 - $120)
export const S_S_RATIO_MIN = 0.8;
export const S_S_RATIO_MAX = 1.2;
export const S_S_RATIO_STEP = 0.1;

export const EXPIRATION_MIN = 10; // * SECONDS_IN_DAY;
export const EXPIRATION_MAX = 100; //  * SECONDS_IN_DAY;
export const EXPIRATION_STEP = 10; //  * SECONDS_IN_DAY;

export class BlackScholesJS {

  constructor(lookupTable) {
    this.lookupTable = lookupTable;
  }

  getFuturePrice(spot, rate, timeToExpirySec) {
    // future = spot * e^(rT)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
    return futurePrice;
  }

  // vol and rate is in decimal format, e.g. 0.1 for 10%
  getCallPrice(spot, strike, timeToExpirySec, vol, rate) {
    // set the spot scale first
    const spotScale = spot / SPOT_FIXED;



    const futureScaled = this.getFuturePrice(SPOT_FIXED, rate, timeToExpirySec);
    console.log("futurePrice", futureScaled);

    const strikeScaled = strike / spotScale;
    console.log("strikeScaled", strikeScaled);

    const strikeDiscounted = strikeScaled * (SPOT_FIXED / futureScaled);
    console.log("strikeDiscounted", strikeDiscounted);

    const spotStrikeRatio = SPOT_FIXED / strikeDiscounted;
    console.log("spotStrikeRatio", spotStrikeRatio);

    // set the expiration based on vol scale
    const volRatio = vol / VOL_FIXED;
    const timeToExpirySecScaled = timeToExpirySec * (volRatio * volRatio);
    const timeToExpiryDaysScaled = timeToExpirySecScaled / SECONDS_IN_DAY;
    console.log("timeToExpirySec", timeToExpirySec, "in years", timeToExpirySec / (365 * 24 * 60 * 60));
    console.log("timeToExpirySecScaled", timeToExpirySecScaled, "in years", timeToExpirySecScaled / (365 * 24 * 60 * 60));
    console.log("timeToExpiryDaysScaled", timeToExpiryDaysScaled);

    // find closest record in lookup table
    const spotStrikeRatioIndex = Math.round((spotStrikeRatio - S_S_RATIO_MIN) / S_S_RATIO_STEP);
    console.log("spotStrikeRatioIndex", spotStrikeRatioIndex);

    const timeToExpiryIndex = Math.round((timeToExpiryDaysScaled - EXPIRATION_MIN) / EXPIRATION_STEP);
    console.log("timeToExpiryIndex", timeToExpiryIndex);

    return this.lookupTable[spotStrikeRatioIndex][timeToExpiryIndex] * spotScale;

  }


}