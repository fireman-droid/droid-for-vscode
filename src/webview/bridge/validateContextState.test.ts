import { describe, expect, it } from 'vitest';

import { parseSessionContext } from './validateContextState';

describe('parseSessionContext', () => {
  it.each([
    {
      status: 'ready',
      value: {
        availability: 'available',
        used: 25,
        remaining: 75,
        limit: 100,
      },
    },
    {
      status: 'ready',
      value: {
        availability: 'unavailable',
        reason: 'no-last-call',
      },
    },
    {
      status: 'error',
      value: {
        availability: 'unavailable',
        reason: 'invalid-last-call',
      },
      message: 'Refresh failed.',
    },
    {
      status: 'ready',
      value: {
        availability: 'unavailable',
        reason: 'invalid-budget',
      },
    },
  ])('accepts an explicit Context state', (value) => {
    expect(parseSessionContext(value)).toBeDefined();
  });

  it.each([
    {
      status: 'ready',
      value: {
        availability: 'available',
        used: -1,
        remaining: 1,
        limit: 1,
      },
    },
    {
      status: 'ready',
      value: {
        availability: 'available',
        used: 0.25,
        remaining: 0.75,
        limit: 1,
      },
    },
    {
      status: 'ready',
      value: {
        availability: 'available',
        used: Number.POSITIVE_INFINITY,
        remaining: 0,
        limit: Number.POSITIVE_INFINITY,
      },
    },
    {
      status: 'ready',
      value: {
        availability: 'available',
        used: 25,
        remaining: 76,
        limit: 100,
      },
    },
    {
      status: 'ready',
      value: {
        availability: 'unavailable',
        reason: 'cumulative-only',
      },
    },
  ])('rejects malformed or incoherent Context data', (value) => {
    expect(parseSessionContext(value)).toBeUndefined();
  });
});
