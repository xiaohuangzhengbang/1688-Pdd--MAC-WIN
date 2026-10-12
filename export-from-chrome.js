(() => { const data = (() => {
  const offerId = location.pathname.match(/\/offer\/(\d+)\.html/)?.[1];
  if (location.hostname !== 'detail.1688.com' || !offerId) throw new Error('Not a 1688 offer page');
  const unique = values => [...new Set(values.filter(Boolean))];
  const imageUrls = root => [...root.querySelectorAll('img')].map(i => i.currentSrc || i.getAttribute('data-src') || i.src).filter(u => /^https:\/\//.test(u));
  const detail = document.querySelector('#description');
  const roots = detail ? [detail] : [];
  for (let index = 0; index < roots.length; index++) {
    for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  const mainImages = unique(imageUrls(document.querySelector('.od-gallery-list') || document.createElement('div')));
  const detailImages = unique(roots.flatMap(imageUrls));
  const videos = unique([...document.querySelectorAll('video')].flatMap(v => [v.currentSrc, v.src, ...[...v.querySelectorAll('source')].map(s => s.src)]).filter(u => /^https:\/\//.test(u)));
  if (!mainImages.length) throw new Error('Product gallery missing: check login, loading, or changed layout');
  return {offerId, url: location.href, capturedAt: new Date().toISOString(), title: document.title, text: document.body.innerText, mainImages, detailImages, videos, warnings: [...(!detailImages.length ? ['Detail images not loaded'] : []), ...(!videos.length ? ['No downloadable video found in current DOM; not proof that product has no video'] : [])]};
})(); const blob = new Blob([JSON.stringify(data,null,2)], {type: "application/json"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download=data.offerId+".json"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),10000); console.log({offerId:data.offerId,mainImages:data.mainImages.length,detailImages:data.detailImages.length,videos:data.videos.length,warnings:data.warnings}); })();
