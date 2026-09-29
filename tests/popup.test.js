const {JSDOM}=require('jsdom'), fs=require('fs');
const D=__dirname+'/../TubeDial/';
let ok=0,bad=0;const T=(n,c,x)=>{c?ok++:bad++;console.log((c?'PASS ':'FAIL ')+n+(x!==undefined?'  ['+x+']':''))};
const L=[[144,'tiny'],[240,'small'],[360,'medium'],[480,'large'],[720,'hd720'],[1080,'hd1080'],[1440,'hd1440'],[2160,'hd2160']];
const FM=[].concat(L.filter(x=>x[0]<=1080).map(x=>({c:'av1',p:x[0],f:x[0]>=720?60:30,use:true})),L.map(x=>({c:'vp9',p:x[0],f:x[0]>=720?60:30,use:x[0]>1080})),[[144,30],[360,30],[480,30],[720,60],[1080,60]].map(x=>({c:'avc',p:x[0],f:x[1],use:false})));
function status(o){return Object.assign({vid:'abcdefghijk',kind:'video',shorts:false,live:false,state:'playing',playing:{fam:'av1',codec:'av01.0.08M.08',p:1080,fps:60,w:1920,h:1080},fmts:FM,
  avail:{av1:true,vp9:true,avc:true},res:L.map(x=>x[0]),fps:[30,60],levels:L.map(x=>({q:x[1],p:x[0],label:x[0]+'p'+(x[0]>=720?'60':'')})),q:'hd1080',auto:false,
  rows:L.map(x=>({p:x[0],fams:x[0]>1080?['vp9']:['av1','vp9','avc'],fps:x[0]>=720?[60]:[30],use:x[0]>1080?'vp9':'av1'})),target:'av1',preferred:'av1',per:null,caps:{start:0,fps:60}},o||{});}
function run(stored, st, url){
  let html=fs.readFileSync(D+'popup.html','utf8').replace(/<script src="[^"]+"><\/script>/g,'');
  const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.com/'});
  const w=dom.window; const data=JSON.parse(JSON.stringify(stored||{})); const sent=[];
  w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});
  w.Element.prototype.scrollIntoView=function(){};
  w.chrome={runtime:{lastError:null,getManifest:()=>({version:'x'})},
    storage:{local:{get(k,cb){cb(JSON.parse(JSON.stringify(data)))},set(p,cb){Object.assign(data,JSON.parse(JSON.stringify(p)));cb&&cb()},remove(k,cb){[].concat(k).forEach(x=>delete data[x]);cb&&cb()}},onChanged:{addListener(){}}},
    tabs:{query(q,cb){cb([{id:7,url:url||'https://www.youtube.com/watch?v=abcdefghijk'}])},reload(){sent.push({kind:'RELOAD'})},
      sendMessage(id,m,cb){sent.push(m); let r=st; if(m.kind==='softReload'){r={ok:true};} else if(m.kind==='setQuality'){st=Object.assign({},st,{q:m.data.q==='auto'?st.q:m.data.q,auto:m.data.q==='auto'}); r=st;} setTimeout(()=>cb&&cb(r),0);}}};
  w.navigator.mediaCapabilities={decodingInfo:async()=>({supported:true,smooth:true,powerEfficient:true})};
  w.eval(fs.readFileSync(D+'popup.js','utf8'));
  return {w,data,sent,$:id=>w.document.getElementById(id),click(el){el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}))},setSt(s){st=s}};
}
const tick=(ms=60)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let r=run({profiles:{video:{codec1:'av1',codec2:'vp9',maxRes:480,maxFps:60}}}, status()); await tick(1300);
 T('migration: maxRes -> startRes', r.data.profiles.video.startRes===480 && !('maxRes' in r.data.profiles.video), JSON.stringify(r.data.profiles.video));
 T('control card shown', !r.$('ctlCard').hidden);
 const cells=c=>[...r.$('matrix').querySelectorAll('.chips[data-c="'+c+'"] button')].map(b=>b.textContent);
 T('AV1 row = real AV1 formats', cells('av1').join('|')==='144p|240p|360p|480p|720p60|1080p60', cells('av1').join('|'));
 T('VP9 row incl. 1440p60/2160p60', cells('vp9').slice(-2).join('|')==='1440p60|2160p60', cells('vp9').join('|'));
 T('facts line with real numbers', r.$('vidFacts').textContent==='This video has 144p – 4K · 30 & 60 fps', r.$('vidFacts').textContent);
 T('playing cell highlighted', r.$('matrix').querySelector('.on').dataset.v==='av1|1080|60');
 T('other-codec duplicates marked reload', r.$('matrix').querySelector('[data-v="vp9|1080|60"]').classList.contains('rl') && !r.$('matrix').querySelector('[data-v="vp9|2160|60"]').classList.contains('rl'));
 T('banner shows codec + quality', r.$('bTitle').textContent==='Playing in AV1 · 1080p60', r.$('bTitle').textContent);
 r.click(r.$('matrix').querySelector('[data-v="av1|240|30"]')); await tick(100);
 T('click AV1 240p -> instant setQuality', r.sent.some(m=>m.kind==='setQuality'&&m.data.q==='small'));
 T('240p highlighted', r.$('matrix').querySelector('.on').dataset.v==='av1|240|30');
 T('no reload needed', !r.$('apply').classList.contains('show'));
 T('start-all button offered', !r.$('startBtn').hidden && r.$('startBtn').textContent.includes('240p'), r.$('startBtn').textContent);
 r.click(r.$('startBtn')); await tick();
 T('start-all sets video startRes 240', r.data.profiles.video.startRes===240);
 T('button then shows done', r.$('startBtn').classList.contains('done'), r.$('startBtn').textContent);
 r.click(r.$('matrix').querySelector('[data-v="vp9|720|60"]')); await tick();
 T('VP9 720p60 -> per-video codec+res', JSON.stringify(r.data.perVideo.abcdefghijk)==='{"codec":"vp9","res":720}', JSON.stringify(r.data.perVideo.abcdefghijk));
 T('cell marked after reload', r.$('matrix').querySelector('[data-v="vp9|720|60"]').classList.contains('sel'));
 T('switched in place: softReload sent with settings, no reload bar', r.sent.some(m=>m.kind==='softReload'&&m.data.settings.perVideo.abcdefghijk.codec==='vp9') && !r.$('apply').classList.contains('show') && !r.sent.some(m=>m.kind==='RELOAD'));
 T('reset button visible', !r.$('pvReset').hidden);
 r.click(r.$('pvReset')); await tick();
 T('reset clears this video', !r.data.perVideo.abcdefghijk);
 const tiles=[...r.$('npTiles').children].map(t=>t.children[1].textContent+'/'+t.children[2].textContent).join(' | ');
 T('now-playing tiles: codec / resolution / framerate', tiles==='AV1/av01.0.08M.08 | 240p/427×240 | 60 fps/smooth motion' || /AV1\/.* \| \d+p\/\d+×\d+ \| \d+ fps/.test(tiles), tiles);
 r.click(r.$('fpsChips').querySelector('[data-v="30"]')); await tick();
 T('fps 30 for this video', r.data.perVideo.abcdefghijk.fps===30 && r.$('fpsChips').querySelector('[data-v="30"]').classList.contains('sel'));
 T('fps chips show top resolution', r.$('fpsChips').querySelector('[data-v="60"] small').textContent==='up to 4K', r.$('fpsChips').querySelector('[data-v="60"] small').textContent);
 r.click(r.$('fpsChips').querySelector('[data-v="60"]')); await tick();
 T('fps 60 (highest) clears it again', !r.data.perVideo.abcdefghijk);
 r.click(r.$('autoRow').querySelector('button')); await tick(100);
 T('Auto -> setQuality auto', r.sent.some(m=>m.kind==='setQuality'&&m.data.q==='auto') && r.$('autoRow').querySelector('.on'));
 // unavailable codec disabled
 r=run({}, status({avail:{av1:true,vp9:true,avc:false},fmts:FM.filter(f=>f.c!=='avc')})); await tick(1300);
 T('codec the video lacks: row says not available', r.$('matrix').querySelector('.chips[data-c="avc"]').textContent.includes('Not available'));
 // Shorts
 r=run({}, status({vid:'shortidxxxx',kind:'shorts',shorts:true,fps:[30],fmts:[{c:'av1',p:144,f:30,use:true},{c:'av1',p:240,f:30,use:true},{c:'av1',p:1080,f:30,use:true}],levels:[{q:'tiny',p:144,label:'144p'},{q:'small',p:240,label:'240p'},{q:'hd1080',p:1080,label:'1080p'}]}),'https://www.youtube.com/shorts/shortidxxxx'); await tick(1300);
 T('Shorts: hint about no menu', r.$('ctlHint').textContent.includes('Shorts have no quality menu'));
 r.click(r.$('matrix').querySelector('[data-v="av1|240|30"]')); await tick(100);
 T('Shorts: start-all Shorts button', r.$('startBtn').textContent==='Start all Shorts at 240p →', r.$('startBtn').textContent);
 r.click(r.$('startBtn')); await tick();
 T('Shorts: single-fps hint', r.$('fpsHint').textContent.includes('only comes in 30 fps'), r.$('fpsHint').textContent);
 T('Shorts: startRes set only for Shorts', r.data.profiles.shorts.startRes===240 && !r.data.profiles.video.startRes);
 
 // not on a video
 r=run({}, null, 'https://www.youtube.com/'); await tick(1300);
 T('no video: control card hidden', r.$('ctlCard').hidden);
 console.log(ok+' pass, '+bad+' fail'); process.exit(bad?1:0);
})();
