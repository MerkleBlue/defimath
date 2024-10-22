
import { assert, expect } from "chai";
import bs from "black-scholes";
import { BlackScholesJS } from "./BlackScholesJS.mjs";

describe("BlackScholesJS", function () {

  let blackScholesJS;

  // before each test
  beforeEach(() => {
    blackScholesJS = new BlackScholesJS();
  });


  describe("Future", function () {
    it("calculates future price with 1 year expiration", async function () {

      let futurePrice = blackScholesJS.getFuturePrice(100, 0.02, 365 * 24 * 60 * 60);
      expect(futurePrice.toFixed(2)).to.equal("102.02");

      futurePrice = blackScholesJS.getFuturePrice(100, 0.1, 365 * 24 * 60 * 60);
      expect(futurePrice.toFixed(2)).to.equal("110.52");

      futurePrice = blackScholesJS.getFuturePrice(100, 1, 365 * 24 * 60 * 60);
      expect(futurePrice.toFixed(2)).to.equal("271.83");
    });

    it("gets call price", async function () {
    });
  });
});
