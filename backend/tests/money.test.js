const { parseMinorUnits, serializeMinorUnits } = require('../src/utils/money');

describe('currency minor units', () => {
  test('keeps NGN kobo and USD cents as exact integer strings', () => {
    expect(parseMinorUnits('9007199254740993', 'NGN')).toBe(9007199254740993n);
    expect(serializeMinorUnits(1250n, 'USD')).toEqual({
      currency: 'USD',
      minorUnit: 'cent',
      amountMinor: '1250'
    });
  });

  test('rejects floating-point and decimal amounts', () => {
    expect(() => parseMinorUnits(10.5, 'NGN')).toThrow(TypeError);
    expect(() => parseMinorUnits('10.5', 'USD')).toThrow(TypeError);
  });

  test('rejects unsupported currencies', () => {
    expect(() => parseMinorUnits('100', 'EUR')).toThrow('Unsupported currency');
  });
});
