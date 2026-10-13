export function productSourceFromUrl(value) {
  const invalid = () => { throw new Error('Invalid product source URL'); };
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f#]/.test(value)) invalid();
  let url;
  try { url = new URL(value); } catch { invalid(); }
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (!authority || authority.includes(':') || url.protocol !== 'https:' || url.username || url.password || url.port) invalid();
  if (url.hostname === 'detail.1688.com') {
    const id = url.pathname.match(/^\/offer\/(\d{1,32})\.html$/)?.[1];
    if (!id) invalid();
    return {id, site: '1688', canonicalUrl: `https://detail.1688.com/offer/${id}.html`, outputName: id};
  }
  if (url.hostname === 'mobile.yangkeduo.com' && url.pathname === '/goods.html') {
    const id = url.searchParams.get('goods_id');
    if (url.searchParams.getAll('goods_id').length !== 1 || !/^\d{1,32}$/.test(id || '')) invalid();
    return {id, site: 'pdd', canonicalUrl: `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`, outputName: `pdd-${id}`};
  }
  invalid();
}
