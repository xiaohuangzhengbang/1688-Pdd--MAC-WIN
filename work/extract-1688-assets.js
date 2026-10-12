() => {
  const offerId = location.pathname.match(/\/offer\/(\d+)\.html/)?.[1];
  if (location.hostname !== 'detail.1688.com' || !offerId) throw new Error('Not a 1688 offer page');
  const unique = values => [...new Set(values.filter(Boolean))];
  const imageUrls = (root, selector = 'img') => [...root.querySelectorAll(selector)]
    .filter(i => !i.matches('.video-icon, .button-image') && !i.closest('.sdmap-dynamic-offer-list, .offer-list-wapper'))
    .map(i => i.getAttribute('data-lazyload-src') || i.getAttribute('data-src') || i.currentSrc || i.src)
    .filter(u => /^https:\/\//.test(u));
  const detail = document.querySelector('#description') || document.querySelector('#detailContentContainer');
  const roots = detail ? [detail] : [];
  for (let index = 0; index < roots.length; index++) {
    for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  const oldGallery = document.querySelector('.od-gallery-list');
  const mainImages = unique(oldGallery
    ? imageUrls(oldGallery)
    : imageUrls(document.querySelector('.detail-gallery-turn-outter-wrapper') || document.createElement('div'), 'img.detail-gallery-img'));
  const detailImages = unique(roots.flatMap(root => imageUrls(root)));
  const videos = unique([...document.querySelectorAll('video')].flatMap(v => [v.currentSrc, v.src, ...[...v.querySelectorAll('source')].map(s => s.src)]).filter(u => /^https:\/\//.test(u)));
  if (!mainImages.length) throw new Error('Product gallery missing: check login, loading, or changed layout');
  return {offerId, url: location.href, capturedAt: new Date().toISOString(), title: document.title, text: document.body.innerText, mainImages, detailImages, videos, warnings: [...(!detailImages.length ? ['Detail images not loaded'] : []), ...(!videos.length ? ['No downloadable video found in current DOM; not proof that product has no video'] : [])]};
}
