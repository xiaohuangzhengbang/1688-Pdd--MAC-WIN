import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const box=(type,size)=>{const b=Buffer.alloc(size);b.writeUInt32BE(size);b.write(type,4);return b;};
const mp4=Buffer.concat([box('ftyp',24),box('moov',8),box('mdat',40)]);
async function api(){try{return await import('./prepare-materials.mjs');}catch(e){assert.fail('Preparation pipeline is not implemented: '+e.code);}}
async function fixture(t,site='pdd',failVideo=false){
  const root=await mkdtemp(join(tmpdir(),'materials-pipeline-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const id='959763271745',name=site==='pdd'?'pdd-'+id:id,base=join(root,name);
  await mkdir(join(base,'mainImages'),{recursive:true});await mkdir(join(base,'videos'));
  const host=site==='pdd'?'img.pddpic.com':'cbu01.alicdn.com';
  const source={offerId:id,...(site==='pdd'?{platform:'pdd',goodsId:id}:{}),url:site==='pdd'?`https://mobile.yangkeduo.com/goods.html?goods_id=${id}`:`https://detail.1688.com/offer/${id}.html`,title:'真实商品',text:'实际商品字段',mainImages:[`https://${host}/photo.png`],detailImages:[],videos:[failVideo?'http://not-approved.test/video.mp4':`https://${host}/movie.mp4`],warnings:[]};
  const assets=[['mainImages','01.png',png],...(!failVideo?[['videos','01.mp4',mp4]]:[])].map(([group,file,bytes])=>({group,file:group+'/'+file,url:source[group][0],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'downloaded'}));
  await writeFile(join(base,'source.json'),JSON.stringify(source));await writeFile(join(base,'assets-manifest.json'),JSON.stringify({offerId:id,sourceUrl:source.url,assets}));
  await writeFile(join(base,'mainImages/01.png'),png);if(!failVideo)await writeFile(join(base,'videos/01.mp4'),mp4);
  await writeFile(join(base,'商品描述.md'),'# 真实商品\n依据页面整理。');
  return {root,base,input:join(base,'source.json')};
}
test('one command prepares each supported site using verified cached media without a ZIP',async t=>{
  const {prepareMaterials}=await api();
  for(const site of ['1688','pdd']){
    const {root,base,input}=await fixture(t,site),result=await prepareMaterials(input,root);
    assert.equal(result.summary.cached,2);assert.equal(result.summary.downloaded,0);assert.equal(result.summary.failed.length,0);
    assert.equal(result.outputDir,base);assert.deepEqual(result.counts,{mainImages:1,detailImages:0,videos:1});
    assert.match(await readFile(result.previewPath,'utf8'),/依据页面整理/);assert.equal((await readdir(root)).some(x=>x.endsWith('.zip')),false);
    assert.ok(result.timingsMs.total>=0);
  }
});
test('a failed discovered MP4 still produces the current partial preview and preserves failure',async t=>{
  const {root,input}=await fixture(t,'pdd',true),{prepareMaterials}=await api();
  const result=await prepareMaterials(input,root);
  assert.equal(result.summary.failed.length,1);assert.equal(result.counts.mainImages,1);assert.equal(result.counts.videos,0);
  assert.match(await readFile(result.previewPath,'utf8'),/下载失败/);
});
test('preparation can serve the validated result directly with native video ranges',async t=>{
  const {root,input}=await fixture(t),{prepareMaterials}=await api();
  const result=await prepareMaterials(input,root,{serve:true});
  t.after(()=>new Promise(r=>result.server.close(r)));
  const page=await fetch(result.url);assert.equal(page.status,200);assert.match(await page.text(),/图库 1 张/);
  const video=await fetch(result.url+'videos/01.mp4',{headers:{Range:'bytes=0-15'}});assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,16);
  assert.equal((await fetch(result.url+'source.json')).status,404);
});

test('a mismatched source identity cannot replace the existing product source or description',async t=>{
  const {root,base}=await fixture(t),{prepareMaterials}=await api();
  const original=await readFile(join(base,'source.json'),'utf8'),input=join(root,'mismatched.json');
  await writeFile(input,JSON.stringify({...JSON.parse(original),goodsId:'1'}));
  await writeFile(join(root,'商品描述.md'),'错误描述');
  await assert.rejects(prepareMaterials(input,root),/Invalid product source URL/);
  assert.equal(await readFile(join(base,'source.json'),'utf8'),original);
  assert.equal(await readFile(join(base,'商品描述.md'),'utf8'),'# 真实商品\n依据页面整理。');
});
