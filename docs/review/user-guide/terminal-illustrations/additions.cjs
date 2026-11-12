const fs=require('fs');const path=require('path');
const {chromium}=require('../../../../e2e/node_modules/@playwright/test');
const {systems,cmd,output,terminal}=require('./generate.cjs');
const root=__dirname;const shell=fs.readFileSync(path.join(root,'scene.html'),'utf8');
const testRoot=path.resolve(root,'../verification');
const records=JSON.parse(fs.readFileSync(path.join(testRoot,'results.json'),'utf8'));const devRecords=JSON.parse(fs.readFileSync(path.join(testRoot,'dev-results.json'),'utf8'));
const record=id=>records.find(r=>r.id===id);const result=id=>(record(id).stdout+record(id).stderr).split('\n').filter(l=>l&&!l.startsWith('(node:')&&!l.startsWith('(Use '));
const imported=result('import-recovered').find(l=>l.startsWith('batch '));
const devImported=devRecords.find(r=>r.id==='source-import').stdout.split('\n').find(l=>l.startsWith('batch '));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));manifest.steps=manifest.steps.filter(s=>!s.id.startsWith('proof-')&&!s.stage.startsWith('dev-'));
const scenes=[];
for(const [key,base]of Object.entries(systems)){
 const s={...base,folder:key==='windows'?'PS C:\\openldr_ce>':key==='mac'?'operator@Mac openldr_ce %':'operator@workstation:~/Downloads/openldr_ce$'};
 const devPath=key==='windows'?'C:\\openldr_ce':'~/Downloads/openldr_ce';
 const definitions={
  'dev-root':cmd(s,s.home,'cd '+devPath)+cmd(s,s.folder,key==='windows'?'Get-ChildItem -Name':'ls')+output(key==='windows'?['apps','packages','package.json','pnpm-lock.yaml','pnpm-workspace.yaml']:['apps  packages  package.json','pnpm-lock.yaml  pnpm-workspace.yaml'])+cmd(s,s.folder,'',true),
  'dev-help':cmd(s,s.folder,'pnpm openldr --help')+output(['Usage: openldr [options] [command]',''])+cmd(s,s.folder,'pnpm openldr ingest --help')+output(['Usage: openldr ingest [options] <file>'])+cmd(s,s.folder,'',true),
  'dev-file':cmd(s,s.folder,'pnpm openldr fhir validate files/my-file.json')+output(['files/my-file.json: all valid','  Bundle               valid','  entry[0]             valid'])+cmd(s,s.folder,'',true),
  'dev-import':cmd(s,s.folder,'pnpm openldr ingest files/my-file.json')+output([devImported])+cmd(s,s.folder,'pnpm openldr pipeline status')+output(['  '+devImported.split(' ')[1].slice(0,8)+'  done  fhir-bundle  1 res'])+cmd(s,s.folder,'',true)
 };
 for(const [stage,lines]of Object.entries(definitions))scenes.push({id:'terminal-'+key+'-'+stage,platform:key,stage,html:terminal(key,lines,'Development example: '+devPath+'; output excerpts')});
}
const s=systems.linux;
const proofs={
 'wrong-folder':cmd(s,s.home,'./openldr --help')+output(result('wrong-folder'))+cmd(s,s.home,'cd ~/Downloads/openldr_ce')+cmd(s,s.folder,'./openldr --help')+output(['Usage: openldr [options] [command]']),
 'docker':cmd(s,s.folder,'./openldr --help')+output(result('unreachable-docker'))+cmd(s,s.folder,'unset DOCKER_HOST')+cmd(s,s.folder,'./openldr --help')+output(['Usage: openldr [options] [command]']),
 'api':cmd(s,s.folder,'./openldr --help')+output(result('api-stopped'))+cmd(s,s.folder,'docker compose up -d api')+output(['[Startup progress omitted]'])+cmd(s,s.folder,'./openldr --help')+output(['Usage: openldr [options] [command]']),
 'file':cmd(s,s.folder,'./openldr ingest my-file.json')+output(result('import-outside-shared-folder'))+cmd(s,s.folder,'mv my-file.json data/my-file.json')+cmd(s,s.folder,'./openldr fhir validate data/my-file.json')+output(['data/my-file.json: all valid'])+cmd(s,s.folder,'./openldr ingest data/my-file.json')+output([imported])
};
for(const [id,lines]of Object.entries(proofs))scenes.push({id:'proof-'+id,platform:'linux',stage:'proof-'+id,html:terminal('linux',lines,'Illustrated transcript; errors and recovery results captured on Linux')});
(async()=>{const b=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});try{const p=await b.newPage({viewport:{width:720,height:1000}});for(const item of scenes){const html=shell.replace('__SCENE__',item.html).replace('</style>','.line{white-space:pre-wrap;overflow-wrap:anywhere}.terminal{font-size:15px}.line{min-height:23px}</style>');fs.writeFileSync(path.join(root,item.id+'.html'),html);await p.setContent(html);await p.evaluate(()=>document.fonts.ready);const file=path.join(root,item.id+'.jpg');await p.locator('#scene').screenshot({path:file,type:'jpeg',quality:82});const box=await p.locator('#scene').boundingBox();manifest.steps.push({id:item.id,path:file,crop_dimensions:[720,Math.ceil(box.height)],kind:'illustrated-tested-transcript',platform:item.platform,stage:item.stage});}fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));console.log('Added '+scenes.length+' source and tested-error illustrations');}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
