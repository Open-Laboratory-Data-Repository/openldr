// Native evidence for documentation previews. Workflow writes belong only to the isolated API.
const fs=require('fs'),path=require('path');
const root=__dirname,repo=path.resolve(root,'../../..');
const {chromium,expect}=require(path.join(repo,'e2e/node_modules/@playwright/test'));
async function api(route,method='GET',data){
 const r=await fetch('http://localhost:3006/api'+route,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
 if(!r.ok)throw Error(route+' '+r.status+' '+await r.text());
 return r.status===204?null:r.json();
}
async function start(slug,route){
 await api('/me/preferences','PUT',{language:'en',theme:'dark',sidebarCollapsed:false});
 const out=path.join(root,slug+'-evidence');fs.mkdirSync(out,{recursive:true});
 const manifestFile=path.join(out,'capture-manifest.json');
 let steps=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile)).steps:[];
 const browser=await chromium.launch({headless:true,executablePath:'/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'});
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:4});page.setDefaultTimeout(12000);
 const settle=async()=>{await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready)};
 async function go(){await page.goto('http://localhost:5186/studio/'+route);await settle()}
 async function shot(id,label,target){
  await settle();const focus=[];
  for(const t of Array.isArray(target)?target:[target]){
   if(t.boundingBox){await t.scrollIntoViewIfNeeded();const b=await t.boundingBox();if(!b)throw Error('Missing target '+id);focus.push(b)}else focus.push(t);
  }
  const size=page.viewportSize();for(const f of focus)if(f.x<0||f.y<0||f.x+f.width>size.width+1||f.y+f.height>size.height+1)throw Error('Target outside viewport '+id+' '+JSON.stringify(f));
  await page.screenshot({path:path.join(out,id+'.png'),animations:'disabled'});
  steps=steps.filter(x=>x.id!==id);steps.push({id,label,path:slug+'-evidence/'+id+'.png',source_dimensions:[size.width,size.height],pixel_dimensions:[size.width*4,size.height*4],focus});
  fs.writeFileSync(manifestFile,JSON.stringify({capturedAt:new Date().toISOString(),source:'Live isolated Studio. Native DPR 4 screenshots.',appUrl:'http://localhost:5186/studio/'+route,steps},null,2)+'\n');console.log('CAPTURE '+id);
 }
 await go();return {browser,page,shot,go,settle,api,expect,out,
 button:name=>page.getByRole('button',{name,exact:true}),menu:name=>page.getByRole('menuitem',{name,exact:true}),dialog:()=>page.getByRole('dialog').first()};
}
module.exports={start,api,expect};
