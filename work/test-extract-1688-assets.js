(extractorSource) => {
  const tests = [];
  const offerLocation = new URL('https://detail.1688.com/offer/998757098086.html');
  const parse = body => new DOMParser().parseFromString(
    '<!doctype html><html><head><title>1688 extractor fixture</title></head><body>' + body + '</body></html>',
    'text/html'
  );
  const extract = (document, location = offerLocation) =>
    new Function('document', 'location', 'return (' + extractorSource + ')()')(document, location);
  const equalUrls = (actual, expected) => {
    if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((url, index) => url !== expected[index])) {
      throw new Error('Expected ' + JSON.stringify(expected) + '; received ' + JSON.stringify(actual));
    }
  };
  const rejects = run => {
    let rejected = false;
    try { run(); } catch (error) { rejected = true; }
    if (!rejected) throw new Error('Expected extraction to reject this document');
  };
  const test = (name, run) => {
    try {
      run();
      tests.push({ name, pass: true, error: null });
    } catch (error) {
      tests.push({ name, pass: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  // Catches removal of legacy gallery/detail support or loss of duplicate removal.
  test('keeps legacy gallery and ordinary description images', () => {
    const document = parse(`
      <div class="od-gallery-list">
        <img src="https://cbu01.alicdn.com/img/ibank/legacy-main-one.jpg">
        <img src="https://cbu01.alicdn.com/img/ibank/legacy-main-two.jpg">
        <img src="https://cbu01.alicdn.com/img/ibank/legacy-main-one.jpg">
      </div>
      <div id="description"><img src="https://cbu01.alicdn.com/img/ibank/legacy-detail.jpg"></div>
    `);
    const result = extract(document);
    equalUrls(result.mainImages, [
      'https://cbu01.alicdn.com/img/ibank/legacy-main-one.jpg',
      'https://cbu01.alicdn.com/img/ibank/legacy-main-two.jpg'
    ]);
    equalUrls(result.detailImages, ['https://cbu01.alicdn.com/img/ibank/legacy-detail.jpg']);
  });

  // Catches traversal stopping at the first ShadowRoot or discarding light DOM details.
  test('keeps ordinary and nested shadow description images', () => {
    const document = parse(`
      <div class="od-gallery-list"><img src="https://cbu01.alicdn.com/img/ibank/shadow-main.jpg"></div>
      <div id="description">
        <img src="https://cbu01.alicdn.com/img/ibank/shadow-light-detail.jpg">
        <div id="detail-shadow-host"></div>
      </div>
    `);
    const firstRoot = document.querySelector('#detail-shadow-host').attachShadow({ mode: 'open' });
    firstRoot.innerHTML = `
      <img src="https://cbu01.alicdn.com/img/ibank/shadow-first-detail.jpg">
      <div id="nested-shadow-host"></div>
    `;
    const nestedRoot = firstRoot.querySelector('#nested-shadow-host').attachShadow({ mode: 'open' });
    nestedRoot.innerHTML = '<img src="https://cbu01.alicdn.com/img/ibank/shadow-nested-detail.jpg">';
    const result = extract(document);
    equalUrls(result.detailImages, [
      'https://cbu01.alicdn.com/img/ibank/shadow-light-detail.jpg',
      'https://cbu01.alicdn.com/img/ibank/shadow-first-detail.jpg',
      'https://cbu01.alicdn.com/img/ibank/shadow-nested-detail.jpg'
    ]);
  });

  // Catches selectors that only recognize the old .od-gallery-list layout.
  test('captures current detail gallery images', () => {
    const document = parse(`
      <div class="detail-gallery-turn-outter-wrapper">
        <img class="detail-gallery-img" src="https://cbu01.alicdn.com/img/ibank/current-main-one.jpg">
        <div><img class="detail-gallery-img" src="https://cbu01.alicdn.com/img/ibank/current-main-two.jpg"></div>
      </div>
      <div id="description"><img src="https://cbu01.alicdn.com/img/ibank/current-gallery-detail.jpg"></div>
    `);
    const result = extract(document);
    equalUrls(result.mainImages, [
      'https://cbu01.alicdn.com/img/ibank/current-main-one.jpg',
      'https://cbu01.alicdn.com/img/ibank/current-main-two.jpg'
    ]);
  });

  // Catches collecting every image in the current gallery, including controls.
  test('excludes video icons and button images from current gallery', () => {
    const document = parse(`
      <div class="detail-gallery-turn-outter-wrapper">
        <img class="detail-gallery-img" src="https://cbu01.alicdn.com/img/ibank/product-video-cover.jpg">
        <img class="video-icon" src="https://cbu01.alicdn.com/img/ibank/video-icon.png">
        <div class="video-icon"><img src="https://cbu01.alicdn.com/img/ibank/video-play-icon.png"></div>
        <button><img class="button-image" src="https://cbu01.alicdn.com/img/ibank/gallery-next-button.png"></button>
      </div>
    `);
    const result = extract(document);
    equalUrls(result.mainImages, ['https://cbu01.alicdn.com/img/ibank/product-video-cover.jpg']);
  });

  // Catches missing the current detail container and including store recommendations.
  test('captures current details and excludes both store recommendation wrappers', () => {
    const document = parse(`
      <div class="od-gallery-list"><img src="https://cbu01.alicdn.com/img/ibank/current-detail-main.jpg"></div>
      <div id="detailContentContainer">
        <img src="https://cbu01.alicdn.com/img/ibank/current-detail-one.jpg">
        <div><img src="https://cbu01.alicdn.com/img/ibank/current-detail-two.jpg"></div>
        <div class="sdmap-dynamic-offer-list">
          <img src="https://cbu01.alicdn.com/img/ibank/recommended-offer-one.jpg">
        </div>
        <div class="offer-list-wapper">
          <div><img src="https://cbu01.alicdn.com/img/ibank/recommended-offer-two.jpg"></div>
        </div>
      </div>
    `);
    const result = extract(document);
    equalUrls(result.detailImages, [
      'https://cbu01.alicdn.com/img/ibank/current-detail-one.jpg',
      'https://cbu01.alicdn.com/img/ibank/current-detail-two.jpg'
    ]);
  });

  // Catches selecting placeholder currentSrc/src ahead of a real lazy-loaded gallery image.
  test('prefers gallery data-lazyload-src over placeholder currentSrc and src', () => {
    const document = parse(`
      <div class="od-gallery-list">
        <img src="https://cbu01.alicdn.com/lazyload.png"
          data-lazyload-src="https://cbu01.alicdn.com/img/ibank/lazy-gallery-real.jpg">
      </div>
    `);
    // DOMParser documents do not load remote resources; preserve the observed browser state.
    Object.defineProperty(document.querySelector('img'), 'currentSrc', {
      value: 'https://cbu01.alicdn.com/lazyload.png', configurable: true
    });
    const result = extract(document);
    equalUrls(result.mainImages, ['https://cbu01.alicdn.com/img/ibank/lazy-gallery-real.jpg']);
  });

  // Catches a lazy-source fix applied only to the gallery and not to details.
  test('prefers detail data-lazyload-src over placeholder currentSrc and src', () => {
    const document = parse(`
      <div class="od-gallery-list"><img src="https://cbu01.alicdn.com/img/ibank/lazy-detail-main.jpg"></div>
      <div id="description">
        <img src="https://cbu01.alicdn.com/lazyload.png"
          data-lazyload-src="https://cbu01.alicdn.com/img/ibank/lazy-detail-real.jpg">
      </div>
    `);
    Object.defineProperty(document.querySelector('#description img'), 'currentSrc', {
      value: 'https://cbu01.alicdn.com/lazyload.png', configurable: true
    });
    const result = extract(document);
    equalUrls(result.detailImages, ['https://cbu01.alicdn.com/img/ibank/lazy-detail-real.jpg']);
  });

  // Catches accepting a non-product host even when the DOM resembles a product page.
  test('rejects a non-product hostname', () => {
    const document = parse('<div class="od-gallery-list"><img src="https://cbu01.alicdn.com/img/ibank/wrong-host-main.jpg"></div>');
    rejects(() => extract(document, new URL('https://shop.1688.com/offer/998757098086.html')));
  });

  // Catches treating unrelated page images as an acceptable product gallery.
  test('rejects a product page without a product gallery', () => {
    const document = parse(`
      <img src="https://cbu01.alicdn.com/img/ibank/unrelated-page-banner.jpg">
      <div id="detailContentContainer"><img src="https://cbu01.alicdn.com/img/ibank/gallery-missing-detail.jpg"></div>
    `);
    rejects(() => extract(document));
  });

  // Catches silently reporting no video without the existing caution in warnings.
  test('keeps a warning when no downloadable video exists', () => {
    const document = parse(`
      <div class="od-gallery-list"><img src="https://cbu01.alicdn.com/img/ibank/no-video-main.jpg"></div>
      <div id="description"><img src="https://cbu01.alicdn.com/img/ibank/no-video-detail.jpg"></div>
    `);
    const result = extract(document);
    equalUrls(result.videos, []);
    if (!Array.isArray(result.warnings) || !result.warnings.some(warning => /video/i.test(warning))) {
      throw new Error('Expected an empty-video warning; received ' + JSON.stringify(result.warnings));
    }
  });

  return { tests };
}
