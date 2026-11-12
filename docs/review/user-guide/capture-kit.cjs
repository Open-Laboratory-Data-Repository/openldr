// Native evidence for documentation previews. Workflow writes belong only to the isolated API.
const fs=require('fs'),path=require('path');
const root=__dirname,repo=path.resolve(root,'../../..');
const API_BASE=process.env.GUIDE_API_URL||'http://localhost:3006';
const APP_BASE=process.env.GUIDE_STUDIO_URL||'http://localhost:5186';
for(const [base,ports] of [[API_BASE,['3006','3007','3008','3009']],[APP_BASE,['5186','5187','5188','5189']]]){const u=new URL(base);if(!['localhost','127.0.0.1'].includes(u.hostname)||!ports.includes(u.port))throw Error('Capture requires an isolated review port: '+base)}
function durableJson(file,value){const temporary=file+'.tmp-'+process.pid;const fd=fs.openSync(temporary,'w');try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temporary,file);const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}
const {chromium,expect}=require(path.join(repo,'e2e/node_modules/@playwright/test'));
async function api(route,method='GET',data){
 const r=await fetch(API_BASE+'/api'+route,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
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
 async function go(){await page.goto(APP_BASE+'/studio/'+route);await settle()}
 async function shot(id,label,target){
  await settle();const focus=[];
  for(const t of Array.isArray(target)?target:[target]){
   if(t.boundingBox){await t.scrollIntoViewIfNeeded();const b=await t.boundingBox();if(!b)throw Error('Missing target '+id);focus.push(b)}else focus.push(t);
  }
  const size=page.viewportSize();for(const f of focus)if(f.x<0||f.y<0||f.x+f.width>size.width+1||f.y+f.height>size.height+1)throw Error('Target outside viewport '+id+' '+JSON.stringify(f));
  const temporaryImage=path.join(out,id+'.capture-'+process.pid+'.png');
  await page.screenshot({path:temporaryImage,animations:'disabled'});
  const imageFd=fs.openSync(temporaryImage,'r');try{fs.fsyncSync(imageFd)}finally{fs.closeSync(imageFd)}
  fs.renameSync(temporaryImage,path.join(out,id+'.png'));
  if(fs.existsSync(manifestFile))steps=JSON.parse(fs.readFileSync(manifestFile)).steps;
  steps=steps.filter(x=>x.id!==id);steps.push({id,label,path:slug+'-evidence/'+id+'.png',source_dimensions:[size.width,size.height],pixel_dimensions:[size.width*4,size.height*4],focus});
  durableJson(manifestFile,{capturedAt:new Date().toISOString(),source:'Live isolated Studio. Native DPR 4 screenshots.',appUrl:APP_BASE+'/studio/'+route,steps});console.log('CAPTURE '+id);
 }
 await go();return {browser,page,shot,go,settle,api,expect,out,
 button:name=>page.getByRole('button',{name,exact:true}),menu:name=>page.getByRole('menuitem',{name,exact:true}),dialog:()=>page.getByRole('dialog').first()};
}
module.exports={start,api,expect,durableJson};
