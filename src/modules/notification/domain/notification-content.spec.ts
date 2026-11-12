import { isSafeActionPath, isSafeMetadata } from './notification-content';

describe('notification content safety', () => {
  it.each(['/', '/contracts/1', '/a/b?x=1&y=2#h', '/payments/abc%20def'])(
    'accepts relative path %s',
    (path) => expect(isSafeActionPath(path)).toBe(true),
  );

  it.each([
    '',
    'contracts',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '/redirect?to=http://evil.com',
    '/a/../b',
    '/a\nb',
    `/${'a'.repeat(600)}`,
    42,
    null,
  ])('rejects %p', (path) => expect(isSafeActionPath(path)).toBe(false));

  it('limits metadata shape and size', () => {
    expect(isSafeMetadata({ a: 'x', b: 1, c: false })).toBe(true);
    expect(isSafeMetadata([])).toBe(false);
    expect(isSafeMetadata(null)).toBe(false);
    expect(isSafeMetadata({ a: null })).toBe(false);
    expect(isSafeMetadata({ a: 'x'.repeat(201) })).toBe(false);
    expect(isSafeMetadata({ a: Infinity })).toBe(false);
    expect(
      isSafeMetadata(
        Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])),
      ),
    ).toBe(false);
  });
});
