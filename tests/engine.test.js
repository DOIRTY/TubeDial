const {make,F,A,full,film,short,mixed,show,load,PR,T,go,done}=require('./harness');
// starting quality
{const t=go(PR({video:{codec1:'av1'}}),'S1aaaaaaaaa',full,'medium'); T('YouTube decides: quality untouched', t.player.q==='medium');}
{const t=go(PR({video:{codec1:'av1',startRes:480}}),'S2aaaaaaaaa',full,'hd1080'); T('start 480: new video switched to 480p', t.player.q==='large', t.player.q);
 t.player.q='hd2160'; t.tick(); t.tick(); T('user then picks 4K: stays', t.player.q==='hd2160');}
{const [t,r]=load(PR({video:{codec1:'av1',startRes:480}}),full('S3aaaaaaaaa')); T('start 480: nothing removed (4K still offered)', /2160/.test(show(r)) && /1080/.test(show(r)), show(r));}
{const t=go(PR({video:{codec1:'av1',startRes:4320}}),'S4aaaaaaaaa',film,'medium','video/webm; codecs="vp09.00.40.08"'); T('Best on a 1080p video: starts at 1080p', t.player.q==='hd1080', t.player.q);}
{const t=go(PR({video:{codec1:'av1',maxRes:480}}),'S5aaaaaaaaa',full,'hd1080'); T('old limit 480 migrates to start 480', t.player.q==='large', t.player.q);
 const [t2,r]=load(PR({video:{codec1:'av1',maxRes:480}}),full('S6aaaaaaaaa')); T('old limit no longer trims', /2160/.test(show(r)), show(r));}
{const t=go(PR({shorts:{codec1:'av1',startRes:144}}),'S7aaaaaaaaa',short,'hd1080',null,'shorts'); T('Shorts start 144: plays 144p', t.player.q==='tiny', t.player.q);}
// codec per quality
{const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9'}}),mixed('C1aaaaaaaaa')); const s=show(r);
 T('AV1 up to 1080p, VP9 up to 4K -> your AV1 (only AV1)', s==='av01 1080p60, av01 720p60, av01 480p30', s);}
{const t=make(PR({video:{codec1:'av1',codec2:'vp9'}})); t.tick(); t.nav('/watch','?v=C3aaaaaaaaa'); t.player.pr=mixed('C3aaaaaaaaa');
 T('veto: VP9 4K blocked (AV1 chosen, no mixing)', !t.ts('video/webm; codecs="vp09.00.51.08"; width=3840; height=2160; framerate=60'));
 T('veto: VP9 1080p blocked', !t.ts('video/webm; codecs="vp09.00.40.08"; width=1920; height=1080; framerate=60'));
 T('veto: AV1 1080p allowed', t.ts('video/mp4; codecs="av01.0.08M.08"; width=1920; height=1080; framerate=60'));
 T('veto: bare H.264 blocked (never used)', !t.ts('video/mp4; codecs="avc1.640028"'));}
{const t=make(PR({video:{codec1:'av1',codec2:'vp9'}})); t.tick(); t.nav('/watch','?v=U1aaaaaaaaa');
 T('unknown: VP9 4K blocked too (no mixing)', !t.ts('video/webm; codecs="vp09.00.51.08"; width=3840; height=2160; framerate=60'));
 T('unknown: VP9 1080p blocked (aggressive AV1)', !t.ts('video/webm; codecs="vp09.00.40.08"; width=1920; height=1080; framerate=30'));}
{const [t,r]=load(PR({video:{codec1:'av1',maxFps:30}}),full('F1aaaaaaaaa')); T('fps 30 hides 60fps versions', !/p60/.test(show(r)), show(r));}
{const real=Date.now; const t=go(PR({video:{codec1:'av1',codec2:'vp9'}}),'M1aaaaaaaaa',mixed,'hd2160','video/webm; codecs="vp09.00.51.08"');
 t.video.videoWidth=3840; t.video.videoHeight=2160; Date.now=()=>real()+5000; t.tick(); Date.now=real;
 T('playing 4K VP9 while AV1 is the choice -> tip offered', t.toasts.length===1, t.toasts.length);}
// ---- v3.5: Now tab live controls ----
{const t=go(PR({video:{codec1:'av1',codec2:'vp9'}}),'N1aaaaaaaaa',mixed,'hd1080');
 t.player.getAvailableQualityData=()=>[{quality:'hd2160',qualityLabel:'2160p60'},{quality:'hd1440',qualityLabel:'1440p60'},{quality:'hd1080',qualityLabel:'1080p60 Premium',isPlayable:false},{quality:'hd1080',qualityLabel:'1080p60'},{quality:'hd720',qualityLabel:'720p60'},{quality:'large',qualityLabel:'480p'},{quality:'auto',qualityLabel:'Auto'}];
 t.player.pref='hd1080';
 const st=t.msg('status');
 T('status: levels from the player, low→high, no auto/premium dupes', st.levels.map(l=>l.label).join(',')==='480p,720p60,1080p60,1440p60,2160p60', st.levels.map(l=>l.label).join(','));
 T('status: current quality + not auto', st.q==='hd1080' && st.auto===false);
 const u=st.rows.map(r=>r.p+':'+r.use).join(','); T('status: codec used per quality', u==='480:av1,720:av1,1080:av1,1440:null,2160:null', u);
 T('status: codecs that exist per quality', JSON.stringify(st.rows.find(r=>r.p===1080).fams.sort())==='["av1","avc","vp9"]');
 const st2=t.msg('setQuality',{q:'small'}); T('setQuality 240p: switched instantly', t.player.q==='small' && st2.q==='small');
 t.tick(); t.tick(); T('starting quality never overrides it afterwards', t.player.q==='small');
 t.msg('setQuality',{q:'auto'}); T('setQuality auto -> player preference auto', t.player.pref==='auto');
 t.msg('setQuality',{q:'<bad>'}); T('bogus quality ignored', t.player.pref==='auto');}
{const t=go(PR({shorts:{codec1:'av1'}}),'N2aaaaaaaaa',short,'hd1080',null,'shorts');
 t.player.getAvailableQualityLevels=()=>['hd1080','hd720','large','tiny','auto'];
 const st=t.msg('status'); T('Shorts: vertical 1080x1920 counted as 1080p', st.rows.map(r=>r.p).join(',')==='144,480,720,1080', st.rows.map(r=>r.p).join(','));
 T('Shorts: levels via fallback API', st.levels.map(l=>l.q).join(',')==='tiny,large,hd720,hd1080');
 t.msg('setQuality',{q:'small'}); T('Shorts: set 240p works', t.player.q==='small');}
{const t=go(PR({video:{codec1:'av1'}}),'N3aaaaaaaaa',id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[{mimeType:'video/mp4; codecs="av01.0.08M.08"',width:1920,height:800,fps:24},{mimeType:'video/mp4; codecs="av01.0.05M.08"',width:1280,height:534,fps:24}]}}),'hd1080');
 const st=t.msg('status'); T('wide film 1920x800 counted as 1080p', st.rows.map(r=>r.p).join(',')==='720,1080', st.rows.map(r=>r.p).join(','));}
// ---- v3.6 ----
const YTQ=(t)=>{const v=t.win.localStorage.getItem('yt-player-quality'); if(!v) return null; const d=JSON.parse(JSON.parse(v).data); return d.quality;};
const playShort=(t,id,stats)=>{t.player.pr=short(id); t.player.getVideoData=()=>({video_id:id}); t.video.readyState=4; t.video.currentTime=1.2;
  t.player.getStatsForNerds=()=>({codecs:'av01.0.05M.08 (398) / opus (251)',resolution:stats||'720x1280@30 / 720x1280@30'});};
{const t=make(PR({shorts:{codec1:'av1',startRes:240}})); t.tick(); t.nav('/shorts/P1aaaaaaaaa'); playShort(t,'P1aaaaaaaaa'); t.player.q='hd720'; t.tick();
 const st=t.msg('status'); T('Shorts: detected as playing without a new buffer', st.state==='playing' && st.playing.fam==='av1' && st.playing.p===720, JSON.stringify(st.playing));
 T('Shorts: real size, fps and codec string from the player', st.playing.w===720 && st.playing.h===1280 && st.playing.fps===30 && st.playing.codec==='av01.0.05M.08', st.playing.codec);
 T('Shorts: starting quality applied without refresh', t.player.q==='small', t.player.q);}
{const t=make(PR({shorts:{codec1:'av1'}})); t.tick(); t.nav('/shorts/P2aaaaaaaaa'); playShort(t,'P2aaaaaaaaa'); t.player.getVideoData=()=>({video_id:'OTHERaaaaaa'});
 T('player still on another video -> not "playing"', t.msg('status').state!=='playing');}
{const t=make(PR({shorts:{codec1:'av1',startRes:240},video:{codec1:'av1'}}),null,{'yt-player-quality':'{"data":"{\\"quality\\":1080,\\"previousQuality\\":720}","expiration":1,"creation":1}'});
 t.win.location.href='https://www.youtube.com/shorts/E1aaaaaaaaa'; t.win.location.pathname='/shorts/E1aaaaaaaaa';}
{// direct load on a Short: YouTube's saved quality set before the player exists
 const vm=require('vm'); const {make:mk}=require('./harness');
 const orig='{"data":"{\\"quality\\":1080,\\"previousQuality\\":720}","expiration":1,"creation":1}';
 const t=make(PR({shorts:{codec1:'av1',startRes:240},video:{codec1:'av1'}}),null,{'yt-player-quality':orig});
 t.push('/shorts/E2aaaaaaaaa'); T('navigating to a Short: saved quality = 240 before loading', YTQ(t)===240, YTQ(t));
 T('...and the player range set right away (before playback)', t.player.ranges.indexOf('small')>=0, t.player.ranges.join());
 t.push('/shorts/E3aaaaaaaaa'); T('next Short: range set again immediately', t.player.ranges.filter(x=>x==='small').length>=2);
 t.push('/watch?v=E4aaaaaaaaa'); T('video with "YouTube decides": your own YouTube value put back exactly', t.win.localStorage.getItem('yt-player-quality')===orig, t.win.localStorage.getItem('yt-player-quality'));}
{const t=make(PR({video:{codec1:'av1',startRes:480}})); t.push('/watch?v=E5aaaaaaaaa'); t.win.localStorage.setItem('yt-player-quality',JSON.stringify({data:JSON.stringify({quality:1440,previousQuality:480}),expiration:1,creation:1}));
 t.push('/watch?v=E6aaaaaaaaa'); t.win.localStorage.setItem('ytld_settings',JSON.stringify(PR({video:{codec1:'av1',startRes:0}})));
 T('each new video writes the starting quality again', YTQ(t)===480);}
{const t=make({profiles:{video:{codec1:'av1'}},perVideo:{E7aaaaaaaaa:{codec:'vp9',res:720}}}); t.push('/watch?v=E7aaaaaaaaa');
 T('per-video pick (VP9 720p): loads straight at 720p', YTQ(t)===720 && t.player.ranges.indexOf('hd720')>=0);
 t.player.pr=full('E7aaaaaaaaa'); t.player.q='hd1080'; t.win.MediaSource.prototype.addSourceBuffer('video/webm; codecs="vp09.00.40.08"'); t.tick();
 T('per-video pick: quality fixed at 720p if it drifted', t.player.q==='hd720', t.player.q);}
// veto must not hide the NEXT (preloaded) Short's formats
{const t=make(PR({shorts:{codec1:'av1',codec2:'vp9'}})); t.tick(); t.nav('/shorts/V1aaaaaaaaa'); t.win.MediaSource.prototype.addSourceBuffer('video/mp4; codecs="av01.0.05M.08"'); t.player.pr=short('V1aaaaaaaaa');
 T('next Short 1080p60 not hidden because this Short is 30fps', t.ts('video/mp4; codecs="av01.0.08M.08"; width=1080; height=1920; framerate=60'));
 T('next Short 1440p VP9 not hidden (size this Short lacks)', t.ts('video/webm; codecs="vp09.00.50.08"; width=1440; height=2560; framerate=30'));}
{const t=make(PR({shorts:{codec1:'av1',codec2:'vp9',maxFps:30}})); t.tick(); t.nav('/shorts/V2aaaaaaaaa'); t.win.MediaSource.prototype.addSourceBuffer('video/mp4; codecs="av01.0.05M.08"'); t.player.pr=short('V2aaaaaaaaa');
 T('explicit 30fps limit still hides 60fps', !t.ts('video/mp4; codecs="av01.0.08M.08"; width=1080; height=1920; framerate=60'));}
{const t=make(PR({video:{codec1:'av1',codec2:'vp9'}})); t.tick();
 const vpOnly=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[F('vp09.00.40.08',1920,1080,60),F('vp09.00.30.08',854,480,30)]}});
 t.nav('/watch','?v=V3aaaaaaaaa'); t.player.pr=vpOnly('V3aaaaaaaaa'); t.ts('video/webm; codecs="vp09.00.40.08"; width=1920; height=1080; framerate=60');
 t.nav('/watch','?v=V4aaaaaaaaa'); t.player.pr=mixed('V4aaaaaaaaa');
 T('format the preloaded other video needs (VP9 1080p60) is not hidden', t.ts('video/webm; codecs="vp09.00.40.08"; width=1920; height=1080; framerate=60'));
 T('but H.264 480p (neither video uses it) still blocked', !t.ts('video/mp4; codecs="avc1.4d401e"; width=854; height=480; framerate=30'));}
{const t=go(PR({video:{codec1:'av1',codec2:'vp9'}}),'X1aaaaaaaaa',mixed,'hd1080'); const st=t.msg('status');
 const f=st.fmts.map(x=>x.c+x.p+'@'+x.f+(x.use?'*':'')).join(' ');
 T('status lists every real format + which the menu uses', f==='av11080@60* av1720@60* av1480@30* vp92160@60 vp91440@60 vp91080@60 vp9480@30 avc1080@60 avc480@30', f);}
// ---- v3.8: the user's case: no AV1, H.264 144/360/720/1080, VP9 only 360p ----
const uv=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[F('avc1.4d400c',256,144,30),F('avc1.4d401e',640,360,30),F('avc1.4d401f',1280,720,30),F('avc1.640028',1920,1080,30),F('vp09.00.21.08',640,360,30),A]}});
{const [t,r]=load(PR({video:{codec1:'av1',codec2:'avc'}}),uv('U2aaaaaaaaa')); T('default: all H.264 (VP9 360p duplicate dropped)', show(r)==='h264 144p30, h264 360p30, h264 720p30, h264 1080p30', show(r));}
{const s0={profiles:{video:{codec1:'av1',codec2:'avc'}},perVideo:{U3aaaaaaaaa:{codec:'vp9',res:360}}};
 const [t,r]=load(s0,uv('U3aaaaaaaaa')); T('picked VP9 for this video: ONLY VP9 is served', show(r)==='vp9 360p30', show(r));
 const t2=make(s0); t2.tick(); t2.nav('/watch','?v=U3aaaaaaaaa'); t2.player.pr=uv('U3aaaaaaaaa');
 T('in-page: H.264 144p refused (so it can\'t start in H.264)', !t2.ts('video/mp4; codecs="avc1.4d400c"; width=256; height=144; framerate=30'));
 T('in-page: VP9 360p allowed', t2.ts('video/webm; codecs="vp09.00.21.08"; width=640; height=360; framerate=30'));}
{const t=go(PR({video:{codec1:'av1',codec2:'avc'}}),'U4aaaaaaaaa',uv,'tiny','video/mp4; codecs="avc1.4d400c"');
 const loads=[]; t.player.loadVideoById=o=>loads.push(o); t.player.getCurrentTime=()=>42.7; t.player.ranges.length=0;
 const r=t.msg('softReload',{settings:{profiles:{video:{codec1:'av1',codec2:'avc'}},perVideo:{U4aaaaaaaaa:{codec:'vp9',res:360}}}});
 T('switch codec in place: player re-opens the same video at the same spot', r.ok && loads.length===1 && loads[0].videoId==='U4aaaaaaaaa' && Math.abs(loads[0].startSeconds-42.4)<0.01, JSON.stringify(loads));
 T('...with the picked quality set before it loads', t.player.ranges[0]==='medium', t.player.ranges.join());
 T('...and the new settings used right away', !t.ts('video/mp4; codecs="avc1.4d400c"; width=256; height=144; framerate=30'));
 T('no page reload', t.reloads()===0);}
{const t=go(PR({video:{codec1:'av1'}}),'U5aaaaaaaaa',uv,'tiny'); const r=t.msg('softReload',{});
 T('player without loadVideoById -> ok:false (popup falls back)', r.ok===false);}
// ---- v3.9 ----
{const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9'}}),uv('W1aaaaaaaaa')); T('AV1→VP9 order, VP9 only has 360p -> VP9 360p (codec first), nothing mixed', /^vp9 360/.test(show(r)) && !/h264/.test(show(r)), show(r));}
{const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9'}}),full('W2aaaaaaaaa')); T('AV1 reaches the top -> AV1 only', /^(av01 [^,]+(, )?)+$/.test(show(r)), show(r));}
{const s0={profiles:{video:{codec1:'av1',codec2:'vp9'}}};
 const [t,r]=load(s0,uv('W3aaaaaaaaa')); t.tick(); t.nav('/watch','?v=W3aaaaaaaaa'); t.player.pr=r;
 T('popup still sees ALL formats after trimming', t.msg('status').fmts.length===5, t.msg('status').fmts.length);
 t.player.loadVideoById=()=>{}; t.player.getCurrentTime=()=>10;
 t.msg('softReload',{settings:{profiles:s0.profiles,perVideo:{W3aaaaaaaaa:{codec:'vp9',res:360}}}});
 T('switch to VP9: the player gets the full list back, trimmed to VP9 360p', show(r)==='vp9 360p30', show(r));}
{const s0={profiles:{video:{codec1:'av1',codec2:'vp9'}}};
 const t=go(s0,'W4aaaaaaaaa',uv,'tiny','video/mp4; codecs="avc1.4d400c"'); t.player.loadVideoById=()=>{}; t.player.getCurrentTime=()=>5;
 t.msg('softReload',{settings:{profiles:s0.profiles,perVideo:{W4aaaaaaaaa:{codec:'vp9',res:360}}}});
 t.player.getVideoData=()=>({video_id:'W4aaaaaaaaa'}); t.video.readyState=4; t.video.currentTime=6;
 t.player.getStatsForNerds=()=>({codecs:'avc1.4d400c (160)',resolution:'256x144@30'});
 const real=Date.now; Date.now=()=>real()+4000; t.tick(); 
 T('player ignored the switch (still H.264) -> ONE normal reload', t.reloads()===1, t.reloads());
 t.msg('softReload',{settings:{profiles:s0.profiles,perVideo:{W4aaaaaaaaa:{codec:'vp9',res:360}}}}); Date.now=()=>real()+9000; t.tick(); Date.now=real;
 T('never twice within a minute', t.reloads()===1, t.reloads());}
{const s0={profiles:{video:{codec1:'av1',codec2:'vp9'}}};
 const t=go(s0,'W5aaaaaaaaa',uv,'tiny','video/mp4; codecs="avc1.4d400c"'); t.player.loadVideoById=()=>{}; t.player.getCurrentTime=()=>5;
 t.msg('softReload',{settings:{profiles:s0.profiles,perVideo:{W5aaaaaaaaa:{codec:'vp9',res:360}}}});
 t.player.getVideoData=()=>({video_id:'W5aaaaaaaaa'}); t.video.readyState=4; t.video.currentTime=6;
 t.player.getStatsForNerds=()=>({codecs:'vp09.00.21.08 (243)',resolution:'640x360@30'});
 const real=Date.now; Date.now=()=>real()+4000; t.tick(); Date.now=real;
 T('switch worked -> no reload', t.reloads()===0);}
// ---- v3.10: your preference wins when the codec is a real version of the video ----
{const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9',startRes:240}}),mixed('Y1aaaaaaaaa')); T('start 240, AV1 has 240 -> AV1', /^av01/.test(show(r)) && !/vp9/.test(show(r)), show(r));}
{const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9',startRes:4320}}),mixed('Y2aaaaaaaaa')); T('start at Best -> the codec with the top quality (VP9 4K)', /^vp9 2160/.test(show(r)), show(r));}
{const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9',startRes:240}}),uv('Y3aaaaaaaaa')); T('lone VP9 360p copy IS chosen over the H.264 ladder (codec first)', /^vp9 360/.test(show(r)) && !/h264/.test(show(r)), show(r));}
{const av720=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[F('av01.0.01M.08',256,144,30),F('av01.0.02M.08',426,240,30),F('av01.0.04M.08',854,480,30),F('av01.0.05M.08',1280,720,30),F('vp09.00.21.08',426,240,30),F('vp09.00.30.08',854,480,30),F('vp09.00.31.08',1280,720,30),F('vp09.00.40.08',1920,1080,30),F('vp09.00.51.08',3840,2160,30),A]}});
 const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9',startRes:240}}),av720('Y4aaaaaaaaa')); T('your case: AV1 144–720p, VP9 to 4K, start 240 -> AV1', /^av01/.test(show(r)) && !/vp9/.test(show(r)), show(r));
 const [t2,r2]=load(PR({video:{codec1:'av1',codec2:'vp9'}}),av720('Y5aaaaaaaaa')); T('same with YouTube decides -> AV1 too (reaches 720p)', /^av01/.test(show(r2)), show(r2));}
{const avLow=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[F('av01.0.01M.08',256,144,30),F('av01.0.04M.08',640,360,30),F('vp09.00.21.08',426,240,30),F('vp09.00.30.08',640,360,30),F('vp09.00.31.08',1280,720,30),F('vp09.00.40.08',1920,1080,30),A]}});
 const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9',startRes:240}}),avLow('Y6aaaaaaaaa')); T('codec first: AV1 only 144/360, start 240 -> still AV1', /^av01/.test(show(r)) && !/vp9/.test(show(r)), show(r));
 const [t2,r2]=load(PR({video:{codec1:'av1',codec2:'vp9'}}),avLow('Y7aaaaaaaaa')); T('codec first: YouTube decides -> AV1', /^av01/.test(show(r2)) && !/vp9/.test(show(r2)), show(r2));}
{const one=id=>({videoDetails:{videoId:id},streamingData:{adaptiveFormats:[F('av01.0.04M.08',640,360,30),F('vp09.00.21.08',426,240,30),F('vp09.00.30.08',640,360,30),F('vp09.00.40.08',1920,1080,30),A]}});
 const [t,r]=load(PR({shorts:{codec1:'av1',codec2:'vp9',startRes:240}}),one('Y8aaaaaaaaa')); T('AV1 only 360p, want 240 -> AV1 360p', show(r)==='av01 360p30', show(r));}
{global.NO_AV1=true; const [t,r]=load(PR({video:{codec1:'av1',codec2:'vp9'}}),mixed('Y9aaaaaaaaa')); global.NO_AV1=false;
 T('browser cannot decode AV1 (Edge without AV1 extension) -> VP9, never an unplayable AV1-only list', /^vp9/.test(show(r)) && !/av01/.test(show(r)), show(r));}
done();
