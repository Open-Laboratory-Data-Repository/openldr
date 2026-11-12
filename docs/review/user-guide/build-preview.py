from pathlib import Path
import base64
import json
import re

root = Path(__file__).parent
mapping = json.loads((root/'evidence/step-evidence.json').read_text())
steps = {step['id']: step for step in mapping['steps']}
steps['dashboard-done'] = {
    'path': '../../../../apps/studio/src/docs/0.1.0/screenshots/dashboard-menu-edit.png',
    'crop_dimensions': [246, 342],
}
source = root/'dashboard-evidence-template.html'
html = source.read_text().replace('__GUIDE_ARTICLE__', (root/'dashboard-article.html').read_text())
html = html.replace('__FILTER_STEPS__', (root/'filter-steps.html').read_text()).replace('__BUILD_STEPS__', (root/'bar-steps.html').read_text())
html = html.replace('__CREATE_STEPS__', (root/'create-steps.html').read_text())
html = html.replace('__SAMPLE_SETUP__', (root/'sample-setup.html').read_text())
html = html.replace('__WIDGET_STEPS__', (root/'widget-steps.html').read_text())

def asset(path, mime):
    return 'data:'+mime+';base64,'+base64.b64encode(Path(path).read_bytes()).decode()

used_images = set()
def image_reference(match):
    key = match[1]
    used_images.add(key)
    return 'data-evidence="'+key+'"'
html = re.sub(r'src="__IMAGE:([^_]+(?:_[^_]+)*)__"', image_reference, html)
images = {key: asset(steps[key]['path'], 'image/png' if Path(steps[key]['path']).suffix == '.png' else 'image/jpeg') for key in sorted(used_images)}
html = html.replace('__EVIDENCE_ASSETS__', json.dumps(images, separators=(',', ':')))
html = re.sub(r'__WIDTH:([^_]+(?:_[^_]+)*)__', lambda match: str(min(500, steps[match[1]]['crop_dimensions'][0])), html)
clips = Path('../../../../apps/studio/src/docs/0.1.0/screenshots')
html = html.replace('__FILTER_VIDEO__', asset(clips/'dashboard-filters.mp4', 'video/mp4'))
html = html.replace('__BUILD_VIDEO__', asset(clips/'dashboard-new-widget.mp4', 'video/mp4'))
html = html.replace('__FILTER_POSTER__', asset(clips/'dashboard-filters.png', 'image/png'))
html = html.replace('__BUILD_POSTER__', asset(clips/'dashboard-new-widget.png', 'image/png'))
if re.search(r'__(IMAGE|WIDTH|FILTER|BUILD)[^ ]*__', html):
    raise ValueError('Unresolved preview placeholder')
if '\u2014' in html:
    raise ValueError('Em dash in new writing')
target = root/'dashboard-evidence-preview.html'
target.write_text(html)
print('Preview bytes:', target.stat().st_size)
print('Evidence images:', html.count('data-enlarge aria-label='))
print('Path:', target)
if target.stat().st_size >= 1_000_000:
    raise ValueError('Inline preview exceeds one megabyte')
