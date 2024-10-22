import moment from "moment";

export const VOLATILITY_MIN = 10;
export const VOLATILITY_MAX = 100;
export const EXPIRATION_MIN = 1 * 24 * 60 * 60;
export const EXPIRATION_MAX = 100 * 24 * 60 * 60;

export class BlackScholesJS {

  constructor() {
  }

  getFuturePrice(spot, rate, timeToExpirySec) {
    // future = spot * e^(rT)
    const timeToExpiryYears = timeToExpirySec / (365 * 24 * 60 * 60);
    const futurePrice = spot * Math.exp(rate * timeToExpiryYears);
    return futurePrice;
  }

  getCallPrice(expiration, strike, vol, underlying) {
  }


}