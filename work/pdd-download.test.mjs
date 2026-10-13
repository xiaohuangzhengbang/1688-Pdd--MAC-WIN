import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {downloadAssets} from './download-assets.mjs';
import {approveAssetUrl, downloadDomesticVideo} from './domestic-download.mjs';
const id = '959763271745';
const product = `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`;
const source = {platform:'pdd',offerId:id,goodsId:id,url:product,mainImages:['https://img.pddpic.com/photo.jpeg?imageMogr2/quality/90'],detailImages:[],videos:[],text:'Observed product text'};
const jpeg = Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(64,1)]);
async function fixture(t, changed = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pdd-downloader-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const input = join(root,'source.json');
  await writeFile(input,JSON.stringify({...source,...changed}));
  return {root,input};
}

// Removing PDD CDN approval loses media without needing to rewrite signed URLs.
test('PDD CDN URLs preserve image processing and signatures', ()=>{
  for (const host of ['pddpic.com','img.pddpic.com','img-3.pddpic.com','video5.pddpic.com']) {
    const url = `https://${host}/original.mp4?sign=a%2Bb&imageMogr2/quality/90`;
    assert.equal(approveAssetUrl(url),url);
  }
});

// Treating the product origin as media would expand the approved download hosts.
test('PDD product origin is admitted only as a referer', ()=>{
  assert.throws(()=>approveAssetUrl(product),/Unapproved/);
  assert.equal(approveAssetUrl(product,{allowProductReferer:true}),product);
  for(const url of ['https://img.pddpic.com.evil.test/a','https://evilpddpic.com/a','http://img.pddpic.com/a','https://u:p@img.pddpic.com/a','https://img.pddpic.com:8443/a','https://img.pddpic.com/a\n']) assert.throws(()=>approveAssetUrl(url),/Unapproved/);
});

// Dropping the output prefix mixes products with an identical numeric platform ID.
test('PDD download output is isolated and verified cache requires no network',async t=>{
  const {root,input}=await fixture(t);
  const first=await downloadAssets(input,root,{platform:'linux',env:{},fetch:async()=>new Response(jpeg)});
  assert.equal(first.summary.downloaded,1);
  assert.equal(first.summary.failed.length,0);
  assert.equal(first.summary.manifestPath,join(root,`pdd-${id}`,'assets-manifest.json'));
  assert.equal(first.manifest.goodsId,id);
  assert.equal(first.manifest.platform,'pdd');
  assert.deepEqual(await readFile(join(root,`pdd-${id}`,'mainImages/01.jpeg')),jpeg);
  const second=await downloadAssets(input,root,{platform:'linux',env:{},fetch:()=>assert.fail('Cache unexpectedly fetched')});
  assert.equal(second.summary.cached,1);
  assert.equal(second.summary.failed.length,0);
});

// A missing legacy offerId is valid, but conflicting product identity is not.
test('product IDs agree with their platform URL before downloads start',async t=>{
  for (const changed of [
    {url:`https://evil.test/offer/${id}.html`}, {goodsId:'1'}, {goodsId:undefined}, {offerId:'1'}, {platform:'1688'},
    {url:`https://mobile.yangkeduo.com/goods.html?goods_id=${id}&goods_id=1`},
  ]) {
    const {root,input}=await fixture(t,changed);
    await assert.rejects(downloadAssets(input,root,{platform:'linux',env:{},fetch:()=>assert.fail('Invalid source reached network')}),/Invalid product source URL/);
  }
  const {root,input}=await fixture(t,{offerId:undefined});
  const result=await downloadAssets(input,root,{platform:'linux',env:{},fetch:async()=>new Response(jpeg)});
  assert.equal(result.manifest.offerId,id);
  assert.equal(result.summary.downloaded,1);
  const invalid1688=await fixture(t,{url:'https://detail.1688.com/offer/123.html',offerId:'124',platform:'1688',goodsId:undefined});
  await assert.rejects(downloadAssets(invalid1688.input,invalid1688.root,{platform:'linux',env:{}}),/Invalid product source URL/);
});

// Skipping referer approval or changing routing/DNS/TLS would break actual domestic transfer construction.
test('PDD MP4 uses the same pinned domestic transport with a PDD referer',async()=>{
  const url='https://video5.pddpic.com/product.mp4?sign=a%2Bb';
  const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(32),Buffer.from('moovmdat')]);
  let requests=0;
  const result=await downloadDomesticVideo(url,{platform:'darwin',env:{ASSET_DIRECT_INTERFACE:'en0'},referer:product,runCommand:async(command,args)=>{
    const value=option=>args.includes(option)?args[args.indexOf(option)+1]:undefined;
    assert.equal(command,'curl');
    assert.equal(value('--noproxy'),'*');
    assert.equal(value('--interface'),'en0');
    assert.equal(args.includes('--insecure'),false);
    const dns=requests++===0;
    assert.equal(value('--referer'),dns?undefined:product);
    assert.equal(value('--url'),dns?'https://dns.alidns.com/resolve?name=video5.pddpic.com&type=A':url);
    assert.equal(value('--resolve'),dns?'dns.alidns.com:443:223.5.5.5':'video5.pddpic.com:443:1.1.1.1');
    await writeFile(value('--output'),dns?JSON.stringify({Status:0,Answer:[{type:1,data:'1.1.1.1'}]}):mp4);
    await writeFile(value('--dump-header'),'HTTP/1.1 200 OK\r\n\r\n');
    return {stdout:`200\n0\n${dns?'223.5.5.5':'1.1.1.1'}\n`};
  }});
  assert.deepEqual(result.bytes,mp4);
  assert.equal(result.transport.tlsVerified,true);
  assert.equal(result.transport.finalHost,'video5.pddpic.com');
});
