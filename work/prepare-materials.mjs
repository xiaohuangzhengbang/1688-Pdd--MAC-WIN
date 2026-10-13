import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {productSourceFromUrl} from './product-identity.mjs';
import {downloadAssets} from './download-assets.mjs';
import {createPreview} from './create-preview.mjs';
import {startServer} from './serve-preview.mjs';

export async function prepareMaterials(inputPath,outputDirectory,{serve=false,downloadOptions={}}={}) {
  const started=performance.now(),sourcePath=resolve(inputPath),source=JSON.parse(await readFile(sourcePath,'utf8'));
  const identity=productSourceFromUrl(source.url),outputRoot=resolve(outputDirectory||'outputs'),outputDir=join(outputRoot,identity.outputName);
  if((source.platform!==undefined&&source.platform!==identity.site)||
    (source.offerId!==undefined&&source.offerId!==identity.id)||
    (identity.site==='pdd'&&source.goodsId!==identity.id))throw Error('Invalid product source URL');
  await mkdir(outputDir,{recursive:true});
  const targetSource=join(outputDir,'source.json');
  if(sourcePath!==targetSource) {
    await writeFile(targetSource,JSON.stringify(source,null,2)+'\n');
    try {await copyFile(join(dirname(sourcePath),'商品描述.md'),join(outputDir,'商品描述.md'));}
    catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  const beforeDownload=performance.now();
  const {summary}=await downloadAssets(targetSource,outputRoot,downloadOptions);
  const beforePreview=performance.now();
  // startServer already generates and validates the preview once.
  const preview=serve?await startServer(outputDir):await createPreview(outputDir);
  const ended=performance.now();
  const timingsMs={download:Math.round(beforePreview-beforeDownload),preview:Math.round(ended-beforePreview),total:Math.round(ended-started)};
  return {...preview,outputDir,summary,timingsMs};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),serve=args.includes('--serve'),positional=args.filter(arg=>arg!=='--serve');
    if(positional.length<1||positional.length>2||positional.some(arg=>arg.startsWith('--')))throw Error('Usage: node work/prepare-materials.mjs source.json [output-root] [--serve]');
    const result=await prepareMaterials(positional[0],positional[1],{serve});
    console.log(JSON.stringify({ready:serve,offerId:result.offerId,outputDir:result.outputDir,previewPath:result.previewPath,...(result.url?{url:result.url}:{}),counts:result.counts,warnings:result.warnings,downloaded:result.summary.downloaded,cached:result.summary.cached,failed:result.summary.failed,timingsMs:result.timingsMs}));
    if(result.summary.failed.length)process.exitCode=1;
    if(result.server) {
      let closing=false;const close=()=>{if(closing)return;closing=true;result.server.close(()=>process.exit(process.exitCode||0));result.server.closeIdleConnections();};
      process.on('SIGINT',close);process.on('SIGTERM',close);
    }
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
