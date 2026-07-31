import { generateShortCode, isValidShortCode } from '../src/utils/base62';

describe('base62 short code generation', () => {
  it('generates a code of the requested length', () => {
    const code = generateShortCode(7);
    expect(code).toHaveLength(7);
  });

  it('generates only URL-safe base62 characters', () => {
    const code = generateShortCode(10);
    expect(code).toMatch(/^[0-9a-zA-Z]+$/);
  });

  it('generates distinct codes across many calls (collision sanity check)', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateShortCode(7)));
    expect(codes.size).toBe(1000);
  });

  it('validates well-formed short codes', () => {
    expect(isValidShortCode('aZ3kP1x')).toBe(true);
    expect(isValidShortCode('')).toBe(false);
    expect(isValidShortCode('has spaces')).toBe(false);
    expect(isValidShortCode('has/slash')).toBe(false);
  });
});
