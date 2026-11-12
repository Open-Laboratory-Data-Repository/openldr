const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('../../../../e2e/node_modules/@playwright/test');
(async () => {
 const localChromium = '/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
 const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(localChromium) ? localChromium : undefined);
 const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
 try {
  const page = await browser.newPage({viewport:{width:800,height:1100}});
  await page.goto('http://localhost:4392/start-here-theme-review.html');
  const checks=[];
  for (const width of [800,736,500,375,320]) {
   await page.setViewportSize({width,height:1100});
   for (const theme of ['light','dark']) {
    await page.getByRole('button',{name:theme==='light'?'Light':'Dark',exact:true}).click();
    const frames=await page.locator('.doc-dotted-frame').evaluateAll(elements=>elements.map(el=>{
     const box=el.getBoundingClientRect(); const windowBox=el.querySelector('.doc-dotted-window').getBoundingClientRect();
     const dots=getComputedStyle(el.querySelector('.doc-dotted-dots'));
     const pitchX=box.width/Math.round(box.width/12),pitchY=box.height/Math.round(box.height/12);
     const count=(space,pitch)=>Math.floor((space-pitch/2)/pitch)+1;
     const margins=[windowBox.left-box.left,windowBox.top-box.top,box.right-windowBox.right,box.bottom-windowBox.bottom];
     return {width:box.width,height:box.height,margins,rows:margins.map((margin,index)=>count(margin,index%2?pitchY:pitchX)),dots:dots.backgroundImage,repeat:dots.backgroundRepeat,imageLoaded:el.querySelector('img').naturalWidth>0};
    }));
    for(const frame of frames){assert.deepEqual(frame.rows,[2,2,2,2]);assert(frame.margins.every(n=>Math.abs(n-24)<0.1));assert(frame.dots.includes(theme==='dark'?'/ 0.35':'/ 0.95'));assert(frame.imageLoaded);}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    checks.push({width,theme,frames});
    if(width===800) await page.locator('#start-here-theme-preview').screenshot({path:path.join(__dirname,'balanced-dots-'+theme+'.png')});
   }
  }
  await page.setViewportSize({width:1280,height:900});
  await page.goto('http://localhost:5173/studio/docs/start-here');
  await page.locator('.doc-dotted-frame').first().waitFor({state:'attached'});
  await page.waitForTimeout(1000);
  for(const theme of ['dark','light']){
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const frame=page.locator('.doc-dotted-frame').first();
   await frame.evaluate(el=>el.scrollIntoView({behavior:'instant',block:'center'}));
   const state=await page.locator('.doc-dotted-frame').first().evaluate(el=>({padding:getComputedStyle(el).padding,dots:getComputedStyle(el.querySelector('.doc-dotted-dots')).backgroundImage,windowWidth:el.querySelector('.doc-dotted-window').getBoundingClientRect().width}));
   assert.equal(state.padding,'24px');assert(state.dots.includes(theme==='dark'?'/ 0.35':'/ 0.95'));assert(state.windowWidth>0);
   checks.push({appTheme:theme,...state});
  }
  fs.writeFileSync(path.join(__dirname,'balanced-dots-verification.json'),JSON.stringify({checks},null,2)+'\n');
  console.log('PASS: two dot rows on every edge at 800, 736, 500, 375 and 320px in both themes.');
  console.log('PASS: light opacity 95%, dark opacity 35%; actual app uses shared styles.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
