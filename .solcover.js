module.exports = {
  // contracts/mocks/ holds test-only wrapper contracts (gas harnesses,
  // external exposure of internal library functions). They are not part
  // of the published package, so they are excluded from coverage.
  skipFiles: ["mocks"],
};
