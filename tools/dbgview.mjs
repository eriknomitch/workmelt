import { chromium } from 'playwright';
import { launchOpts } from './lib/chromium.mjs';
const PORT=5402;
const browser = await chromium.launch(launchOpts({headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist','--force-color-profile=srgb','--mute-audio']}));
const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
await page.goto(`http://127.0.0.1:${PORT}/?capture=1`,{waitUntil:'domcontentloaded',timeout:90000});
await page.waitForFunction('window.__READY__ === true',null,{timeout:90000});
const shot=process.argv[2]??'interior';
await page.evaluate((n)=>window.__APPLY_SHOT__(n,{grabFrame:60}),shot);
await page.evaluate((n)=>new Promise(d=>{let i=0;const t=()=>(++i>=n?d():requestAnimationFrame(t));requestAnimationFrame(t)}),60);
for(const m of ['ao','contact','skyvis']){
  await page.evaluate((mm)=>{window.__ENGINE__.ctx.get('render').debugView=mm;},m);
  await page.evaluate((n)=>new Promise(d=>{let i=0;const t=()=>(++i>=n?d():requestAnimationFrame(t));requestAnimationFrame(t)}),8);
  await page.screenshot({path:`/tmp/dbg-${shot}-${m}.png`});
}
await browser.close();
console.log('ok');
