const CURRENCY_UNITS = Object.freeze({
  NGN: { minorUnit: 'kobo', scale: 100 },
  USD: { minorUnit: 'cent', scale: 100 }
});

function assertCurrency(currency) {
  if (!Object.prototype.hasOwnProperty.call(CURRENCY_UNITS, currency)) {
    throw new TypeError(`Unsupported currency: ${currency}`);
  }
}

function parseMinorUnits(value, currency) {
  assertCurrency(currency);
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new TypeError('Money amounts must be non-negative integer minor units encoded as a string');
  }
  return BigInt(value);
}

function serializeMinorUnits(value, currency) {
  assertCurrency(currency);
  return { currency, minorUnit: CURRENCY_UNITS[currency].minorUnit, amountMinor: BigInt(value).toString() };
}

module.exports = { CURRENCY_UNITS, parseMinorUnits, serializeMinorUnits };
