import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('./product-identity.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const parse = value => {
  assert.equal(typeof api.productSourceFromUrl, 'function', 'Shared product identity is required');
  return api.productSourceFromUrl(value);
};

// Removing canonicalization or platform isolation would mix outputs for equal IDs.
test('product identity retains long string IDs and isolates PDD output names', () => {
  assert.deepEqual(parse('https://detail.1688.com/offer/1076046787065.html?offerId=1076046787065&spm=a'), {
    id: '1076046787065', site: '1688', canonicalUrl: 'https://detail.1688.com/offer/1076046787065.html', outputName: '1076046787065',
  });
  assert.deepEqual(parse('https://mobile.yangkeduo.com/goods.html?goods_id=12345678901234567890123456789012&from=search'), {
    id: '12345678901234567890123456789012', site: 'pdd', canonicalUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=12345678901234567890123456789012', outputName: 'pdd-12345678901234567890123456789012',
  });
});

// Relaxing origin, credentials, path, fragment, duplicate ID or port admission must fail here.
test('identity rejects ambiguous or unsupported source URLs', () => {
  for (const value of [
    'http://detail.1688.com/offer/123.html', 'https://detail.1688.com.evil.test/offer/123.html',
    'https://user@detail.1688.com/offer/123.html', 'https://detail.1688.com:443/offer/123.html',
    'https://detail.1688.com/offer/123.html#', 'https://detail.1688.com/offer/123.html\n',
    'https://detail.1688.com/not/offer/123.html', 'https://detail.1688.com/offer/abc.html',
    'https://mobile.yangkeduo.com/goods.html?goods_id=1&goods_id=1',
    'https://mobile.yangkeduo.com/goods.html?goods_id=1#detail', 'https://mobile.yangkeduo.com:443/goods.html?goods_id=1',
    'https://mobile.yangkeduo.com/goods.html?goods_id=', 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789012345678901234567890123',
    'https://mobile.yangkeduo.com/other.html?goods_id=1', 'https://m.yangkeduo.com/goods.html?goods_id=1', null,
  ]) assert.throws(() => parse(value), /Invalid product source URL/, String(value));
});
