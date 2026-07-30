import { chromium } from 'playwright';
import { launchOpts } from './lib/chromium.mjs';
const b = await chromium.launch(launchOpts({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio','--disable-frame-rate-limit','--disable-gpu-vsync'] }));
const out=[];
for (const [w,h] of [[1280,720],[1920,1080],[2560,1440]]) {
  const p = await b.newPage({ viewport:{width:w,height:h} });
  await p.goto('http://127.0.0.1:8080/?capture=1',{waitUntil:'domcontentloaded'});
  await p.waitForFunction('window.__READY__===true',null,{timeout:60000});
  await p.evaluate(()=>window.__APPLY_SHOT__('hero'));
  await p.evaluate(()=>new Promise(d=>{let i=0;const t=()=>++i>=120?d():requestAnimationFrame(t);requestAnimationFrame(t)})); // warm
  const r = await p.evaluate(()=>new Promise(d=>{
    const N=300, ts=[]; let last=performance.now(), i=0;
    const t=()=>{const n=performance.now(); ts.push(n-last); last=n;
      if(++i>=N){ts.sort((a,b)=>a-b); d({med:ts[Math.floor(N*0.5)], p95:ts[Math.floor(N*0.95)], min:ts[0]});}
      else requestAnimationFrame(t);};
    requestAnimationFrame(t);}));
  const info = await p.evaluate(()=>window.__RENDER_INFO__);
  out.push({res:`${w}x${h}`, medMs:+r.med.toFixed(2), p95Ms:+r.p95.toFixed(2), medFps:+(1000/r.med).toFixed(0), calls:info.calls, tris:info.tris});
  await p.close();
}
console.log(JSON.stringify(out,null,2));
await b.close();
