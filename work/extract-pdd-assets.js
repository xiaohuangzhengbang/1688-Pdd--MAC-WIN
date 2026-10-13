() => {
  const productUrl = new URL(location.href);
  const goodsIds = productUrl.searchParams.getAll('goods_id');
  if (productUrl.protocol !== 'https:' || productUrl.hostname !== 'mobile.yangkeduo.com' ||
      productUrl.pathname !== '/goods.html' || productUrl.username || productUrl.password ||
      productUrl.port || productUrl.hash || goodsIds.length !== 1 || !/^\d+$/.test(goodsIds[0])) {
    throw new Error('Not an unambiguous HTTPS PDD product page');
  }
  const goodsId = goodsIds[0];
  const unique = values => [...new Set(values.filter(Boolean))];
  const assetUrl = value => {
    if (!value || !/^https:\/\//.test(value)) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
        (url.hostname === 'pddpic.com' || url.hostname.endsWith('.pddpic.com')) ? value : null;
    } catch { return null; }
  };
  const imageUrls = selector => unique([...document.querySelectorAll(selector)].map(image =>
    [image.getAttribute('data-src'), image.currentSrc, image.getAttribute('src')].map(assetUrl).find(Boolean)));
  const mainImages = imageUrls('img[aria-label="商品大图"]');
  const detailImages = imageUrls('img[aria-label="查看图片"]');
  const videos = unique([...document.querySelectorAll('video')].flatMap(video =>
    [video.currentSrc, video.getAttribute('src'), ...[...video.querySelectorAll('source')].map(source => source.getAttribute('src'))])
    .map(assetUrl));
  if (!mainImages.length) throw new Error('Product gallery missing: check login, loading, or changed layout');
  const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const readable = element => {
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = document.defaultView && current.isConnected
        ? document.defaultView.getComputedStyle(current) : current.style;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
    }
    return true;
  };
  const productText = selector => unique([...document.querySelectorAll(selector)]
    .filter(readable).map(element => cleanText(element.textContent)).filter(Boolean));
  // These selectors were observed on the product page. Do not broaden them to body
  // text: group-buy participants, reviews, and account information are unrelated.
  const title = productText('.Vrv3bF_E .tLYIg_Ju.enable-select')[0] || '';
  const shops = productText('.BAq4Lzv7');
  const quotes = productText('.uPP2olgd[role="button"], .yK39frdi[role="button"]');
  const attributes = unique([...document.querySelectorAll('.KvY4B91X .jvsKAdEs > [aria-label]')]
    .filter(readable).map(element => cleanText(element.getAttribute('aria-label')))
    .filter(label => /^(品牌|发货地|香料分类|功能|香型).+/.test(label)));
  const text = [
    ...(title ? ['商品名称：' + title] : []),
    ...shops.map(shop => '店铺：' + shop),
    ...(quotes.length ? ['页面报价（规格及当前活动以原商品页为准）：', ...quotes] : []),
    ...(attributes.length ? ['商品属性：', ...attributes] : [])
  ].join('\n');
  return {
    platform: 'pdd', goodsId, offerId: goodsId,
    url: 'https://mobile.yangkeduo.com/goods.html?goods_id=' + goodsId,
    capturedAt: new Date().toISOString(),
    title, text, mainImages, detailImages, videos,
    warnings: [
      ...(!title ? ['Product title not readable in current DOM'] : []),
      ...(!detailImages.length ? ['Detail images not loaded in current DOM; not proof that product has no detail images'] : []),
      ...(!videos.length ? ['No downloadable video found in current DOM; not proof that product has no video'] : [])
    ]
  };
}
