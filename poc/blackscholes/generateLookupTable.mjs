import moment from "moment";
import bs from "black-scholes";

export const VOLATILITY_MIN = 10;
export const VOLATILITY_MAX = 100;
export const EXPIRATION_MIN = 10 * 24 * 60 * 60;
export const EXPIRATION_MAX = 100 * 24 * 60 * 60;

const lookupTable = generateLookupTable();

function generateLookupTable() {
  // we start with fixed values: spot 100, volatility 100%, rate 0%
  // what is not fixed: strike 50-200, expiration 10-100 days

  // first dimension is spot strike ratio
  const ssRatios = [0.8, 0.9, 1, 1.1, 1.2];
  const expirationDays = [20, 40, 60, 80, 100];

  const lookupTable = [];

  for (let i = 0; i < ssRatios.length; i++) {
    const expirations = [];
    for (let j = 0; j < expirationDays.length; j++) {
      // for each element calculate Black Scholes
      const spot = 100;
      const strike = 100 * ssRatios[i];
      const expirationYears = expirationDays[j] / 365;
      const vol = 1;  // 100%
      const optionPrice = bs.blackScholes(spot, strike, expirationYears, vol, 0, "call");
      console.log(`strike: ${strike.toFixed(0)}, expiration: ${expirationDays[j]}, call price: ${optionPrice}`);
      expirations.push(optionPrice);
    }
    lookupTable.push(expirations);
  }

  console.log(lookupTable);

  return lookupTable;
}