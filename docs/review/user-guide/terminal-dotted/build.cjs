const fs=require('fs');const path=require('path');const {pathToFileURL}=require('url');
const root=__dirname;const repo=path.resolve(root,'../../../..');
const {chromium}=require(path.join(repo,'e2e/node_modules/@playwright/test'));
const React=require(path.join(repo,'apps/studio/node_modules/react'));
const {renderToStaticMarkup}=require(path.join(repo,'apps/studio/node_modules/react-dom/server'));
const icons=require(path.join(repo,'apps/studio/node_modules/lucide-react'));
const icon=(name,className='')=>renderToStaticMarkup(React.createElement(icons[name],{size:16,className,'aria-hidden':true}));
const esc=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const source=path.join(root,'../terminal-illustrations');const old=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const shell=fs.readFileSync(path.join(root,'scene.html'),'utf8');
function browser(platform){const folder=platform==='windows'?'C:\\openldr_ce':'~/Downloads/openldr_ce';const names=['config','data','docker-compose.yml',platform==='windows'?'openldr.ps1':'openldr'];
 return `<div class="files-toolbar"><div class="arrows">${icon('ArrowLeft')}${icon('ArrowRight')}${icon('ArrowUp')}</div><div class="location-bar">${esc(folder)}</div></div><div class="file-layout"><div class="file-sidebar"><div class="place">${icon('House')}Home</div><div class="place selected">${icon('Download')}Downloads</div><div class="place">${icon('FileText')}Documents</div></div><div class="file-list"><div class="file-head"><span>Name</span><span>Type</span></div>${names.map((name,i)=>`<div class="file-row"><span class="name">${icon(i<2?'Folder':'FileText',i<2?'folder':'document')}${esc(name)}</span><span class="type">${i<2?'Folder':i===2?'YAML file':'Script'}</span></div>`).join('')}</div></div>`;
}
(async()=>{const b=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});const p=await b.newPage({viewport:{width:736,height:1000},deviceScaleFactor:2});const steps=[];try{
 for(const item of old.steps.filter(s=>s.stage!=='launch')){
  let content;
  if(item.stage==='folder')content=browser(item.platform);
  else{await p.setContent(fs.readFileSync(path.join(source,item.id+'.html'),'utf8'));
   content=await p.locator('.terminal').evaluate(el=>{const copy=el.cloneNode(true);const first=[...copy.querySelectorAll('.line')];if(first[0]?.textContent==='Windows PowerShell 5.1'){first.slice(0,3).forEach(line=>line.remove());}return copy.innerHTML;});
   content=`<div class="terminal ${item.id.startsWith('proof-')?'transcript':''}">${content}</div>`;
  }
  const html=shell.replace('__CONTENT__',content);const htmlPath=path.join(root,item.id+'.html');fs.writeFileSync(htmlPath,html);
  await p.goto(pathToFileURL(htmlPath).href);await p.evaluate(()=>document.fonts.ready);if(await p.locator('.control').count()!==3)throw Error('Expected three controls: '+item.id);
  if((await p.locator('.titlebar').innerText()).trim())throw Error('Unexpected title: '+item.id);
  if(await p.locator('img').count())throw Error('Unexpected bitmap frame: '+item.id);
  const overflow=await p.evaluate(()=>{const content=document.querySelector('.terminal');if(!content)return false;return [...content.querySelectorAll('.line')].some(line=>line.scrollWidth>line.clientWidth)||content.scrollHeight>content.clientHeight;});
  if(overflow)throw Error('Clipped text in '+item.id);
  const png=await p.locator('#scene').screenshot({type:'png'});
  const filename=item.id+'.png';fs.writeFileSync(path.join(root,filename),png);
  steps.push({...item,path:'./terminal-dotted/'+filename,crop_dimensions:[736,416],pixel_dimensions:[1472,832],mime:'image/png',chrome:'native-dotted-frame'});
 }
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({notes:'Preview only. Native terminal and matching file browser, with a 16px dotted margin. No bitmap template is used. Original illustration files are preserved. Commands, paths and Linux proof transcripts retain their previous contents. The Windows startup banner was removed.',steps},null,2)+'\n');
 console.log('Generated '+steps.length+' illustrations with native frames, three controls, and no clipped terminal text.');
}finally{await b.close();}})().catch(error=>{console.error(error);process.exit(1)});
