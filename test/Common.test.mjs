
import { assert, expect } from "chai";
import hre from "hardhat";

export const SEC_IN_DAY = 24 * 60 * 60;
export const SEC_IN_YEAR = 365 * 24 * 60 * 60;

export const MIN_ERROR = 1e-12;

export function assertAbsoluteBelow(actual, expected, maxAbsError = 1) {
  const absError = Math.abs(actual - expected);

  assert.isBelow(absError, maxAbsError, "Absolute error is above the threshold");
}

export function assertRelativeBelow(actual, expected, maxRelError = 100) {
  const absError = Math.abs(actual - expected);
  const relError = (expected !== 0) ? Math.abs(absError / expected) : 0;

  assert.isBelow(relError, maxRelError, "Relative error is above the threshold");
}

export function assertBothBelow(actual, expected, maxRelError = 100, maxAbsError = 1) {
  const absError = Math.abs(actual - expected);
  const relError = (expected !== 0 && actual !== 0) ? Math.abs(absError / expected) : 0;

  assert.isBelow(relError, maxRelError, "Relative error is above the threshold");
  assert.isBelow(absError, maxAbsError, "Absolute error is above the threshold");
}

export function tokens(value) {
  let trimmedValue = Math.round(value * 1e18) / 1e18;
  // console.log(trimmedValue);
  // console.log(toPreciseString(trimmedValue));
  return hre.ethers.parseUnits(toPreciseString(trimmedValue), 18).toString();
}

export function toPreciseString(value, maxDigits = 18) {
  return value.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: maxDigits });
}

export async function assertRevertError(contract, method, errorName) {
  await expect(method).to.be.revertedWithCustomError(
    contract,
    errorName
  );
};

export function generateTimePoints() {
  const MAX_MAJOR = 26; // just above 2 years
  const points = [0, 1, 2, 3, 4, 5, 6, 7];

  for (let major = 3; major < MAX_MAJOR; major++) {
    for(let minor = 0; minor < 8; minor++) {
      points.push(parseFloat(2 ** major + minor * 2 ** (major - 3)));
    }
  }
  points.push(parseFloat(2 ** MAX_MAJOR)); // last point

  // console.log("Last time point: ", points[points.length - 1]);

  return points;
}

export function generateTestTimePoints() {
  const timePoints = generateTimePoints();

  const testTimePoints = [];
  for (let i = 1; i < 128; i++) { // from 1 seconds
    testTimePoints.push(i);
  }

  for (let i = 0; i < timePoints.length - 1; i++) {
    const cellDeltaTime = timePoints[i + 1] - timePoints[i];
    if (cellDeltaTime >= 16) {
      const step = cellDeltaTime / 16;
      for (let j = 0; j < 16; j++) {
        if (timePoints[i] + j * step < 2 * SEC_IN_YEAR) { // up to 2 years
          testTimePoints.push(Math.round(timePoints[i] + j * step));
        }
      }
    }
  }

  // add last time point
  testTimePoints.push(2 * SEC_IN_YEAR);

  // console.log("timePoints.length", timePoints.length, "testTimePoints.length", testTimePoints.length);
  // console.log("Last time point:", testTimePoints[testTimePoints.length - 1], convertSeconds(testTimePoints[testTimePoints.length - 1]));
  return testTimePoints;
}

// generates strike points around 100 strike, log scale
export function generateTestStrikePoints(ratio, count) {
  const lowerPoints = [];
  const upperPoints = [];

  const multiplier = Math.pow(ratio, 1 / (count / 2 - 1));

  for (let i = 0; i < (count / 2) - 1; i++) {
    upperPoints.push(100 * Math.pow(multiplier, i));
  }
  upperPoints.push(100 * ratio); // last element


  for (const point of upperPoints) {
    lowerPoints.push((100 / point) * 100);
  }
  lowerPoints.reverse();
  lowerPoints.pop(); // last element

  return lowerPoints.concat(upperPoints);
}

export function generateTestRatePoints(min, max, step) {
  const testRatePoints = [];
  for (let rate = min; rate <= max; rate += step) { // up to 20%
    testRatePoints.push(rate);
  }

  return testRatePoints;
}

export function generateRandomTestPoints(startPoint, endPoint, count, doRound = false) {
  const testPoints = [];
  for (let i = 0; i < count; i++) {
    let point = 0;
    if (doRound) {
      point = Math.round(Math.random() * (endPoint - startPoint) + startPoint);
    } else {
      point = Math.random() * (endPoint - startPoint) + startPoint;
    }
    testPoints.push(point);
  }

  return testPoints;
}
