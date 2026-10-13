(extractorSource) => {
  const tests = [];
  const productLocation = new URL('https://mobile.yangkeduo.com/goods.html?goods_id=959763271745&_oak_rcto=tracking&uin=private-account');
  const parse = body => new DOMParser().parseFromString(
    '<!doctype html><html><head><title>拼多多</title></head><body>' + body + '</body></html>', 'text/html');
  const extract = (document, location = productLocation) =>
    new Function('document', 'location', 'return (' + extractorSource + ')()')(document, location);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const equalUrls = (actual, expected) => assert(
    Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected),
    'Expected ' + JSON.stringify(expected) + '; received ' + JSON.stringify(actual));
  const rejects = run => {
    let rejected = false;
    try { run(); } catch { rejected = true; }
    assert(rejected, 'Expected this document to be rejected');
  };
  const test = (name, run) => {
    try { run(); tests.push({ name, pass: true, error: null }); }
    catch (error) { tests.push({ name, pass: false, error: error instanceof Error ? error.message : String(error) }); }
  };
  const gallery = '<img aria-label="商品大图" src="https://img.pddpic.com/product/main.jpeg">';

  // Changing the platform identity or retaining account/tracking URL data must fail.
  test('identifies PDD and returns an account-free canonical product URL', () => {
    const result = extract(parse(gallery));
    assert(result.platform === 'pdd', 'Expected PDD platform');
    assert(result.goodsId === '959763271745' && result.offerId === result.goodsId, 'Expected stable string product identity');
    assert(result.url === 'https://mobile.yangkeduo.com/goods.html?goods_id=959763271745', 'Expected canonical URL without account or tracking data');
    assert(Number.isFinite(Date.parse(result.capturedAt)), 'Expected valid capture timestamp');
  });

  // Losing carousel clone de-duplication or broadening to all page images must fail.
  test('collects labelled gallery images and removes carousel clones', () => {
    const result = extract(parse(gallery + gallery + `
      <img aria-label="商品大图" src="https://img-3.pddpic.com/product/main-two.jpeg">
      <img aria-label="头像" src="https://img.pddpic.com/avatar/customer.jpeg">
      <img aria-label="评价图片" src="https://img.pddpic.com/review/customer.jpeg">
      <img src="https://img.pddpic.com/recommendation/other-product.jpeg">`));
    equalUrls(result.mainImages, ['https://img.pddpic.com/product/main.jpeg', 'https://img-3.pddpic.com/product/main-two.jpeg']);
  });

  // Selecting currentSrc first would save a placeholder instead of the real lazy source.
  test('prefers a real gallery data-src and preserves image transform queries', () => {
    const document = parse('<img aria-label="商品大图" src="https://img.pddpic.com/placeholder.gif" data-src="https://img.pddpic.com/product/full.jpeg?imageMogr2/format/webp&amp;sign=kept">');
    Object.defineProperty(document.querySelector('img'), 'currentSrc', { value: 'https://img.pddpic.com/placeholder.gif', configurable: true });
    equalUrls(extract(document).mainImages, ['https://img.pddpic.com/product/full.jpeg?imageMogr2/format/webp&sign=kept']);
  });

  // Reusing all page images as details or missing detail lazy sources must fail.
  test('collects labelled detail images with lazy sources and excludes reviews', () => {
    const result = extract(parse(gallery + `
      <img aria-label="查看图片" src="https://img.pddpic.com/placeholder.gif" data-src="https://img.pddpic.com/product/detail-one.jpeg">
      <img aria-label="查看图片" src="https://img.pddpic.com/product/detail-one.jpeg">
      <img aria-label="查看图片" src="https://img-3.pddpic.com/product/detail-two.jpeg">
      <img aria-label="查看评价图片" src="https://img.pddpic.com/review/customer.jpeg">`));
    equalUrls(result.detailImages, ['https://img.pddpic.com/product/detail-one.jpeg', 'https://img-3.pddpic.com/product/detail-two.jpeg']);
  });

  // Dropping currentSrc, source elements, signatures, or duplicate filtering must fail.
  test('retains real direct video URLs without playback or signature changes', () => {
    const document = parse(gallery + '<video src="https://video5.pddpic.com/product/movie.mp4?sign=kept"><source src="https://video5.pddpic.com/product/alternate.mp4?token=kept"></video>');
    Object.defineProperty(document.querySelector('video'), 'currentSrc', { value: 'https://video5.pddpic.com/product/movie.mp4?sign=kept', configurable: true });
    equalUrls(extract(document).videos, ['https://video5.pddpic.com/product/movie.mp4?sign=kept', 'https://video5.pddpic.com/product/alternate.mp4?token=kept']);
  });

  // Accepting off-site, non-HTTPS, credential-bearing, or non-CDN assets must fail.
  test('ignores unsafe asset URLs rather than guessing originals', () => {
    const result = extract(parse(gallery + `
      <img aria-label="商品大图" src="http://img.pddpic.com/insecure.jpeg">
      <img aria-label="商品大图" src="https://img.pddpic.com.evil.test/other.jpeg">
      <img aria-label="查看图片" src="https://user:secret@img.pddpic.com/private.jpeg">
      <video src="blob:https://mobile.yangkeduo.com/example"></video>
      <video src="https://outside.test/movie.mp4"></video>`));
    equalUrls(result.mainImages, ['https://img.pddpic.com/product/main.jpeg']);
    equalUrls(result.detailImages, []);
    equalUrls(result.videos, []);
  });

  // Weakening URL identity may collect a login page, unrelated host, or ambiguous item.
  test('rejects incorrect or ambiguous product locations', () => {
    const document = parse(gallery);
    for (const url of [
      'http://mobile.yangkeduo.com/goods.html?goods_id=959763271745',
      'https://mobile.yangkeduo.com.evil.test/goods.html?goods_id=959763271745',
      'https://mobile.yangkeduo.com/search_result.html?goods_id=959763271745',
      'https://mobile.yangkeduo.com/goods.html?goods_id=',
      'https://mobile.yangkeduo.com/goods.html?goods_id=abc',
      'https://mobile.yangkeduo.com/goods.html?goods_id=959763271745&goods_id=959763271745',
      'https://user:secret@mobile.yangkeduo.com/goods.html?goods_id=959763271745',
      'https://mobile.yangkeduo.com:8443/goods.html?goods_id=959763271745',
      'https://mobile.yangkeduo.com/goods.html?goods_id=959763271745#other'
    ]) rejects(() => extract(document, new URL(url)));
  });

  // Falling back to whole-page images must fail when the actual gallery is missing.
  test('rejects a missing product gallery', () => {
    rejects(() => extract(parse('<img src="https://img.pddpic.com/recommendation/other.jpeg">')));
  });

  // Missing media is a DOM observation, never proof that the product lacks media.
  test('reports unloaded details and unavailable DOM video accurately', () => {
    const result = extract(parse(gallery));
    assert(result.warnings.some(warning => /detail/i.test(warning)), 'Expected detail-loading warning');
    assert(result.warnings.some(warning => /video.*not proof/i.test(warning)), 'Expected unavailable-video qualification');
    equalUrls(result.detailImages, []);
    equalUrls(result.videos, []);
  });

  // Whole-page innerText would expose group buyers, account data, or review names.
  test('extracts only observed product title, shop, quote buttons, and labelled attributes', () => {
    const result = extract(parse(gallery + `
      <span class="Vrv3bF_E"><span class="tLYIg_Ju enable-select"><span>车用挂式香薰</span></span></span>
      <div class="BAq4Lzv7">测试家清专营店</div>
      <span class="uPP2olgd" role="button">补贴价¥\n10.7</span>
      <div class="yK39frdi c2R009od" role="button">¥\n30\n单独购买</div>
      <div class="yK39frdi" role="button">¥\n10.7\n发起拼单</div>
      <div class="pApAfrwF"><p class="jR9hc8yj">商品详情</p><div class="KvY4B91X">
        <div class="jvsKAdEs"><div class="iUUH2sOQ" aria-label="品牌测试品牌">品牌测试品牌</div></div>
        <div class="jvsKAdEs"><div class="iUUH2sOQ" aria-label="发货地安徽省">发货地安徽省</div></div>
        <div class="jvsKAdEs"><div class="iUUH2sOQ" aria-label="香料分类线香">香料分类线香</div></div>
        <div class="jvsKAdEs"><div class="iUUH2sOQ" aria-label="功能净化空气">功能净化空气</div></div>
        <div class="jvsKAdEs"><div class="iUUH2sOQ wyJLD2eu" aria-label="香型茶香型">香型茶香型</div></div>
        <div class="jvsKAdEs"><div aria-label="昵称PRIVATE_REVIEW_NAME">PRIVATE_REVIEW_NAME</div></div>
      </div></div>
      <div>PRIVATE_GROUP_BUYER PRIVATE_ACCOUNT uin=SECRET_TRACKING</div>
      <div role="button">PRIVATE_OTHER_BUTTON</div>`));
    assert(result.title === '车用挂式香薰', 'Expected actual local product title');
    for (const value of ['车用挂式香薰', '测试家清专营店', '补贴价¥ 10.7', '¥ 30 单独购买', '¥ 10.7 发起拼单',
      '品牌测试品牌', '发货地安徽省', '香料分类线香', '功能净化空气', '香型茶香型']) {
      assert(result.text.includes(value), 'Missing observed product field: ' + value);
    }
    assert(!/PRIVATE_|SECRET_TRACKING|uin=/.test(result.text), 'Unrelated personal or tracking data leaked into product text');
    assert(!/所有规格|全部规格|最低价|起售价/.test(result.text), 'A page quote must not be generalized across SKUs');
  });

  // Hidden product fragments are not observable facts and must not override visible text.
  test('ignores hidden titles, hidden quote buttons, and hidden attributes', () => {
    const result = extract(parse(gallery + `
      <span class="Vrv3bF_E" hidden><span class="tLYIg_Ju enable-select"><span>HIDDEN_TITLE</span></span></span>
      <span class="Vrv3bF_E"><span class="tLYIg_Ju enable-select"><span>可见商品</span></span></span>
      <span class="uPP2olgd" role="button" aria-hidden="true">HIDDEN_PRICE</span>
      <div class="pApAfrwF"><div class="KvY4B91X"><div class="jvsKAdEs" hidden>
        <div class="iUUH2sOQ" aria-label="品牌HIDDEN_BRAND">品牌HIDDEN_BRAND</div>
      </div></div></div>`));
    assert(result.title === '可见商品', 'Expected visible title');
    assert(!/HIDDEN_/.test(result.text), 'Hidden product text leaked');
  });

  return { tests };
}
