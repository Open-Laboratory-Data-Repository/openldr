"""Repeatable backup rehearsal for the worker's isolated databases only."""
import json,subprocess
from pathlib import Path
out=Path(__file__).parent
container='openldr-docs-system-pg'
def run(args):
 p=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 if p.returncode:raise RuntimeError(p.stdout)
 return p.stdout.strip()
results={}
for source,target in [('guide_internal','guide_restore_internal'),('guide_target','guide_restore_target')]:
 run(['docker','exec',container,'pg_dump','-U','guide','-Fc','-f','/tmp/'+source+'.dump',source])
 run(['docker','cp',container+':/tmp/'+source+'.dump','/tmp/openldr-guides-system-'+source+'.dump'])
 run(['docker','exec',container,'createdb','-U','guide',target])
 run(['docker','exec',container,'pg_restore','-U','guide','--exit-on-error','--dbname',target,'/tmp/'+source+'.dump'])
 query='SELECT count(*) FROM fhir.fhir_resources' if source=='guide_internal' else 'SELECT count(*) FROM lab_requests'
 counts={db:run(['docker','exec',container,'psql','-U','guide','-d',db,'-Atc',query]) for db in [source,target]}
 if len(set(counts.values()))!=1:raise RuntimeError('Restored count mismatch')
 results[source]={'restore':target,'counts':counts,'dumpExit':0,'restoreExit':0}
(out/'restore-proof.json').write_text(json.dumps(results,indent=2)+'\n')
print('RESTORE REHEARSAL PASS',results)
