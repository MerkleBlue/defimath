
import { assert, expect } from "chai";
import bs from "black-scholes";
import { BlackScholesJS } from "./BlackScholesJS.mjs";
import { generateLookupTable } from "./generateLookupTable.mjs";

const DAY = 24 * 60 * 60;

describe("BlackScholesJS", function () {

  let blackScholesJS;

  // before each test
  beforeEach(() => {
    const lookupTable = generateLookupTable();
    blackScholesJS = new BlackScholesJS(lookupTable);
  });


  describe("Future", function () {
    it("calculates future price with 1 year expiration", async function () {

      let futurePrice = blackScholesJS.getFuturePrice(100, 0.02, 365 * DAY);
      expect(futurePrice.toFixed(2)).to.equal("102.02");

      futurePrice = blackScholesJS.getFuturePrice(100, 0.1, 365 * DAY);
      expect(futurePrice.toFixed(2)).to.equal("110.52");

      futurePrice = blackScholesJS.getFuturePrice(100, 1, 365 * DAY);
      expect(futurePrice.toFixed(2)).to.equal("271.83");
    });

    it("gets call price", async function () {
      const expectedOptionPrice = bs.blackScholes(1000, 930, 60 / 365, 0.60, 0.2, "call");
      const actualOptionPrice = blackScholesJS.getCallPrice(1000, 930, 60 * DAY, 0.60, 0.2);

      console.log("expected:", expectedOptionPrice, "actual:", actualOptionPrice);
    });
  });
});
