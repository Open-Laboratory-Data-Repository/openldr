import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {generatePublisherKeypair,packBundle,pluginManifestToArtifact} from '../../../../packages/marketplace/src/index.ts';
async function main(){
const out=resolve('docs/review/user-guide/marketplace-evidence/practice-registry');
const key=generatePublisherKeypair();
const manifest={...pluginManifestToArtifact(JSON.parse(readFileSync('reference-plugins/test-sink/manifest.json','utf8'))),summary:'Local training sink. No external destination.',readme:'# Training sink\n\nUse this local example to review and approve a plugin. It does not send data to a real destination.',publisher:{id:'guide-system-review',name:'Guide practice publisher',keyFingerprint:'0'.repeat(64)}};
const p=await packBundle({manifest,payload:new Uint8Array(readFileSync('reference-plugins/test-sink/plugin.wasm')),outDir:out+'/test-sink',privateKeyDer:key.privateKeyDer,publicKeyDer:key.publicKeyDer});mkdirSync(out,{recursive:true});
writeFileSync(out+'/index.json',JSON.stringify({schemaVersion:1,packages:[{id:p.manifest.id,kind:p.manifest.type,latestVersion:p.manifest.version,publisher:'Guide practice publisher',summary:'Local training sink. No external destination.',path:'bundles/test-sink',signatureFingerprint:p.fingerprint}]},null,2)+'\n');console.log(out);

}
main().catch(e=>{console.error(e);process.exit(1)});
