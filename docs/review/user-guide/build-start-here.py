from pathlib import Path
import base64
import json
import re

root = Path(__file__).parent
mapping = json.loads((root/'start-evidence/start-evidence.json').read_text())
steps = {step['id']: step for step in mapping['steps']}
steps['dashboard-actions'] = steps['studio-actions-menu']
terminal_steps = json.loads((root/'terminal-illustrations/manifest.json').read_text())['steps']
steps.update({step['id']:step for step in terminal_steps})
source = (root/'start-here-template.html').read_text()
html = source.replace('__START_ARTICLE__', (root/'start-here-article.html').read_text())

def asset(path, mime):
    return 'data:'+mime+';base64,'+base64.b64encode(Path(path).read_bytes()).decode()

used_images = set()
def image_reference(match):
    key = match[1]
    used_images.add(key)
    return 'data-evidence="'+key+'"'

html = re.sub(r'src="__IMAGE:([^_]+(?:_[^_]+)*)__"', image_reference, html)
terminal_stages = set(re.findall(r'data-terminal-stage="([^"]+)"', html))
used_images.update(step['id'] for step in terminal_steps if step['stage'] in terminal_stages)
images = {key:asset(steps[key]['path'],steps[key].get('mime','image/jpeg')) for key in sorted(used_images)}
html = html.replace('__EVIDENCE_ASSETS__',json.dumps(images,separators=(',',':')))
html = re.sub(r'__WIDTH:([^_]+(?:_[^_]+)*)__',lambda m:str(min(500,steps[m[1]]['crop_dimensions'][0])),html)
if re.search(r'__[A-Z][A-Z_:a-z0-9-]*__',html):
    raise ValueError('An unresolved placeholder remains')
if '\u2014' in html:
    raise ValueError('Em dash in new writing')
target=root/'start-here-evidence-preview.html'
target.write_text(html)
print('Start here preview bytes:',target.stat().st_size)
print('Start here evidence images:',len(used_images))
if target.stat().st_size>=1_000_000:
    raise ValueError('Inline preview exceeds one megabyte')
