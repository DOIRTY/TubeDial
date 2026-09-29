const vm=require('vm'), fs=require('fs');
const SRC=fs.readFileSync(__dirname+'/../TubeDial/main.js','utf8');
function store(init){const m=new Map(Object.entries(init||{}));return{get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
function adblock(win){const o=Object.getOwnPropertyDescriptor(win,'ytInitialPlayerResponse');const pg=o&&o.get,ps=o&&o.set;let v;
 Object.defineProperty(win,'ytInitialPlayerResponse',{configurable:true,get(){if(pg)pg.call(win);return v},set(a){if(ps)ps.call(win,a);v=a;if(a)delete a.adPlacements}});}
function fakeEl(){const e={style:{},children:[],className:'',textContent:'',appendChild(c){this.children.push(c);return c},addEventListener(t,f){(this._l=this._l||{})[t]=f},remove(){e.removed=true},attachShadow(){return fakeEl()},querySelector:()=>null,hasAttribute:()=>false};return e;}
function make(settings, order, ls){
  const intervals=[], listeners={}, toasts=[], posted=[]; let reloads=0;
  const video={readyState:4,error:null};
  const player={id:'movie_player',pr:null,ranges:[],q:'hd1080',pref:'auto',levels:null,getPlayerResponse(){return this.pr},querySelector:s=>s==='video'?video:null,
    getPlaybackQuality(){return this.q},getPreferredQuality(){return this.pref},
    setPlaybackQualityRange(a){this.ranges.push(a);this.q=a==='auto'?this.q:a;this.pref=a},setPlaybackQuality(a){if(a!=='auto')this.q=a}};
  const body=fakeEl(); body.appendChild=function(c){toasts.push(c);return c};
  const win={location:{href:'https://www.youtube.com/',pathname:'/',origin:'https://www.youtube.com',reload(){reloads++}},
    localStorage:store(Object.assign({ytld_settings:JSON.stringify(settings||{})},ls||{})), sessionStorage:store(),
    document:{visibilityState:'visible',documentElement:fakeEl(),head:fakeEl(),body,createElement:()=>fakeEl(),addEventListener(){},
      getElementById:id=>(id==='movie_player'||id==='shorts-player')?player:null,querySelector:()=>null,querySelectorAll:()=>[]},
    MediaSource:{isTypeSupported:t=>!(global.NO_AV1&&/av01/.test(String(t))),prototype:{addSourceBuffer(){return{}}}},
    HTMLVideoElement:function(){},HTMLImageElement:function(){},Element:function(){},
    MutationObserver:class{observe(){}}, JSON, Response:class{}, Request:class{}, fetch:async()=>({}),
    setInterval:f=>{intervals.push(f);return intervals.length}, clearInterval(){}, setTimeout:(f)=>{ if(globalThis.RUN_TIMERS) f(); return 0;}, Object, Set, Map, Date, Math, parseInt, String, Array, RegExp, Number,
    addEventListener:(t,f)=>{listeners[t]=f}, postMessage:(m)=>{posted.push(m)},
    history:{pushState(a,b,u){setUrl(u)},replaceState(a,b,u){setUrl(u)}}};
  function setUrl(u){const x=new URL(u,'https://www.youtube.com'); win.location.href=x.href; win.location.pathname=x.pathname;}
  win.HTMLVideoElement.prototype={canPlayType:()=>'probably'};
  Object.defineProperty(win.HTMLImageElement.prototype,'src',{get(){return this._s},set(v){this._s=v},configurable:true});
  win.Element.prototype={setAttribute(){},removeAttribute(){}};
  win.window=win;win.top=win;win.self=win; vm.createContext(win);
  if(order!=='last') adblock(win);
  vm.runInContext(SRC,win);
  if(order==='last') adblock(win);
  const W=vm.runInContext('window',win);
  let mid=0;
  return {win,player,video,toasts,posted,reloads:()=>reloads,tick:()=>intervals.forEach(f=>f()),listeners,
    push(u){win.history.pushState({},'',u);this.tick();},
    nav(path,search=''){win.location.href='https://www.youtube.com'+path+search;win.location.pathname=path;this.tick();},
    ts:t=>win.MediaSource.isTypeSupported(t), mem:()=>JSON.parse(win.localStorage.getItem('yt_av1_map_v22')||'{}'),
    msg(kind,data){const id=++mid; listeners.message({source:W,data:{__ytld:'toPage',kind,id,data}}); const r=posted.filter(m=>m.id===id)[0]; return r&&JSON.parse(JSON.stringify(r.data));}};
}
const F=(c,w,h,fps)=>({mimeType:'video/'+(c.startsWith('avc')||c.startsWith('av01')?'mp4':'webm')+'; codecs="'+c+'"',width:w,height:h,fps});
const A={mimeType:'audio/webm; codecs="opus"'};
const full=(id,extra)=>({videoDetails:{videoId:id},adPlacements:[1],streamingData:{adaptiveFormats:[
  F('av01.0.12M.08',3840,2160,60),F('av01.0.08M.08',1920,1080,60),F('av01.0.05M.08',1280,720,30),F('av01.0.04M.08',854,480,30),F('av01.0.01M.08',256,144,30),
  F('vp09.00.51.08',3840,2160,60),F('vp09.00.40.08',1920,1080,60),F('vp09.00.30.08',854,480,30),
  F('avc1.640028',1920,1080,60),F('avc1.4d401e',854,480,30),F('avc1.4d400c',256,144,30),A]},...(extra||{})});
const film=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[F('vp09.00.40.08',1920,1080,24),F('vp09.00.30.08',854,480,24),F('avc1.4d401e',854,480,24),A]}});
const short=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[F('av01.0.08M.08',1080,1920,30),F('av01.0.05M.08',720,1280,30),F('av01.0.04M.08',480,854,30),F('av01.0.01M.08',144,256,30),F('vp09.00.40.08',1080,1920,30),A]}});
const mixed=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[
  F('av01.0.08M.08',1920,1080,60),F('av01.0.05M.08',1280,720,60),F('av01.0.04M.08',854,480,30),
  F('vp09.00.51.08',3840,2160,60),F('vp09.00.50.08',2560,1440,60),F('vp09.00.40.08',1920,1080,60),F('vp09.00.30.08',854,480,30),
  F('avc1.640028',1920,1080,60),F('avc1.4d401e',854,480,30),A]}});
const show=r=>r.streamingData.adaptiveFormats.filter(f=>f.width).map(f=>f.mimeType.match(/"(\w+)/)[1].replace('vp09','vp9').replace(/avc1/,'h264')+' '+Math.min(f.width,f.height)+'p'+f.fps).join(', ');
function load(s,resp,order){const t=make(s,order);vm.runInContext('ytInitialPlayerResponse='+JSON.stringify(resp),t.win);return [t,vm.runInContext('ytInitialPlayerResponse',t.win)];}
const PR=(o)=>({profiles:o});
let ok=0,bad=0;const T=(n,c,x)=>{c?ok++:bad++;console.log((c?'PASS ':'FAIL ')+n+(x!==undefined?'  ['+x+']':''))};
const go=(s,id,resp,q,codec,path)=>{const t=make(s); t.tick(); if(path==='shorts') t.nav('/shorts/'+id); else t.nav('/watch','?v='+id); t.player.pr=resp(id); t.player.q=q; t.win.MediaSource.prototype.addSourceBuffer(codec||'video/mp4; codecs="av01.0.05M.08"'); t.tick(); return t;};
const done=()=>{console.log(ok+' pass, '+bad+' fail'); process.exitCode=bad?1:0;};
module.exports={make,F,A,full,film,short,mixed,show,load,PR,T,go,done,vm};
