import { describe, expect, it } from 'vitest';

import { isPublicAddress } from './remoteImageAttachment';

describe('remoteImageAttachment', () => {
  it('rejects local, private, link-local, and documentation addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      '100.64.0.1',
      '192.0.2.1',
      '198.51.100.1',
      '203.0.113.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('accepts public IPv4 and IPv6 addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
});
