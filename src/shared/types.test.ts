// Task 1 — types.ts pageEmail field tests (TDD RED phase)
// Verifies LsChangedMessage and BootstrapMessage have optional pageEmail?: string field.

import { describe, it, expectTypeOf } from 'vitest';
import type { LsChangedMessage, BootstrapMessage, RawInstruction } from './types';

describe('LsChangedMessage', () => {
  it('should have type LS_CHANGED', () => {
    const msg: LsChangedMessage = {
      type: 'LS_CHANGED',
      payload: [],
    };
    expectTypeOf(msg.type).toEqualTypeOf<'LS_CHANGED'>();
  });

  it('should have payload of RawInstruction[]', () => {
    const msg: LsChangedMessage = {
      type: 'LS_CHANGED',
      payload: [] as RawInstruction[],
    };
    expectTypeOf(msg.payload).toEqualTypeOf<RawInstruction[]>();
  });

  it('should allow optional pageEmail field', () => {
    const msg: LsChangedMessage = {
      type: 'LS_CHANGED',
      payload: [],
      pageEmail: 'user@example.com',
    };
    expectTypeOf(msg.pageEmail).toEqualTypeOf<string | undefined>();
  });

  it('should allow missing pageEmail field', () => {
    const msg: LsChangedMessage = {
      type: 'LS_CHANGED',
      payload: [],
    };
    expectTypeOf(msg.pageEmail).toEqualTypeOf<string | undefined>();
  });
});

describe('BootstrapMessage', () => {
  it('should allow optional pageEmail field', () => {
    const msg: BootstrapMessage = {
      type: 'LS_BOOTSTRAP',
      payload: [],
      pageEmail: 'user@example.com',
    };
    expectTypeOf(msg.pageEmail).toEqualTypeOf<string | undefined>();
  });

  it('should allow missing pageEmail field', () => {
    const msg: BootstrapMessage = {
      type: 'LS_BOOTSTRAP',
      payload: [],
    };
    expectTypeOf(msg.pageEmail).toEqualTypeOf<string | undefined>();
  });
});
