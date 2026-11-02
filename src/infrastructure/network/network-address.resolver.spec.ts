import { resolveAdvertisedHost } from './network-address.resolver';

describe('resolveAdvertisedHost', () => {
  it('keeps an explicit advertised host', () => {
    expect(resolveAdvertisedHost('10.10.0.15')).toBe('10.10.0.15');
  });
});
