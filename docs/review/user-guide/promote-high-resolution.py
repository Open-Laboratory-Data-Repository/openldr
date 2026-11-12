"""Copy native captures into approved guides. Terminology stays in review."""
from pathlib import Path
import json
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parent
DOCS = ROOT.parents[2] / 'apps/studio/src/docs'
APP = DOCS / '0.1.0/screenshots'
ARCHIVE = ROOT / 'high-resolution/original-app'
ARCHIVE.mkdir(exist_ok=True)
focus = {}
creation_names = {
    'open-dashboard': 'dashboard-create-open.png',
    'open-actions': 'dashboard-create-menu.png',
    'choose-new-dashboard': 'dashboard-create-new.png',
    'dashboard-created': 'dashboard-create-result.png',
}


def preserve(name):
    if (APP / name).exists() and not (ARCHIVE / name).exists():
        shutil.copy2(APP / name, ARCHIVE / name)


for page in ['dashboard', 'preferences']:
    manifest = json.loads((ROOT / f'high-resolution/{page}-manifest.json').read_text())
    steps = {step['id']: step for step in manifest['steps']}
    framing = ROOT / ('high-resolution/dashboard-framing.json' if page == 'dashboard'
                      else 'preferences-evidence/framing.json')
    previous = json.loads((DOCS / f'{page}-focus.json').read_text())
    for frame in json.loads(framing.read_text()):
        key = frame['id']
        name = (creation_names.get(key, f'dashboard-guide-{key}.png')
                if page == 'dashboard' else f'preferences-guide-{key}.png')
        fresh = steps[key]
        preserve(name)
        shutil.copy2(ROOT / fresh['path'], APP / name)
        focus[name] = {
            'crop': dict(zip(['x', 'y', 'width', 'height'], frame['crop'])),
            'targets': frame['targets'],
            'source': dict(zip(['width', 'height'], fresh['source_dimensions'])),
        }
        if page == 'preferences':
            focus[name]['markerAfter'] = True
            if 'step' in previous.get(name, {}):
                focus[name]['step'] = previous[name]['step']
        elif key in ['open-dashboard', 'open-actions', 'choose-new-dashboard']:
            focus[name]['step'] = ['open-dashboard', 'open-actions', 'choose-new-dashboard'].index(key) + 1

(DOCS / 'high-resolution-focus.json').write_text(json.dumps(focus, indent=2) + '\n')
reference_manifest = ROOT / 'high-resolution/dashboard-reference-manifest.json'
if reference_manifest.exists():
    for frame in json.loads(reference_manifest.read_text())['steps']:
        name = frame['id'] + '.png'
        preserve(name)
        image = Image.open(ROOT / frame['path'])
        if frame['id'] not in ['dashboard-builder', 'dashboard-phone']:
            box = frame['focus'][0]
            scale = image.width / frame['source_dimensions'][0]
            bounds = (box['x'], box['y'], box['x'] + box['width'], box['y'] + box['height'])
            image = image.crop(tuple(round(value * scale) for value in bounds))
        image.save(APP / name)
    print('Promoted 7 native Dashboard reference images with their original framing.')
print(f'Promoted {len(focus)} focused guide images. Original assets preserved.')
