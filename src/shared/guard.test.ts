import { describe, it, expect } from 'vitest';
import { isValidPayload } from './guard';

describe('isValidPayload (PUSH-05, D-07)', () => {
  it('returns false for null JSON', () => {
    expect(isValidPayload('null')).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(isValidPayload('[]')).toBe(false);
  });

  it('returns false for non-array object', () => {
    expect(isValidPayload('{"key":"val"}')).toBe(false);
  });

  it('returns false for a bare string JSON value', () => {
    expect(isValidPayload('"string"')).toBe(false);
  });

  it('returns false for invalid JSON', () => {
    expect(isValidPayload('not-json')).toBe(false);
  });

  it('returns true for a non-empty array', () => {
    expect(isValidPayload('[{"title":"T","text":"A"}]')).toBe(true);
  });
});
