from pathlib import Path
from html.parser import HTMLParser
import base64,hashlib,json,re,subprocess
root=Path(__file__).parent
parent=root.parent
manifest=json.loads((root/'capture-manifest.json').read_text())
keys=['dashboard-review.html','dashboard-evidence-preview.html','dashboard-article.html','create-steps.html','create-dashboard-focus-preview.html','create-dashboard-focus-review.html','create-dashboard-focus-wrapped.html']
original_paths=[parent/key for key in keys]
original_paths += sorted((parent/'evidence').glob('*'))
original_hashes={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in original_paths if p.is_file()}
if not (root/'original-hashes.json').exists():
    (root/'original-hashes.json').write_text(json.dumps(original_hashes,indent=2))
labels={
 'open-dashboard':('the Dashboard link in the main menu','Dashboard is near the top of the main menu.', '1'),
 'open-actions':('the dashboard dots menu beside Refresh','The dots menu is at the right end of this toolbar.', '2'),
 'choose-new-dashboard':('New dashboard in the open menu','New dashboard is the first item in the menu.', '3'),
 'dashboard-created':('the new empty dashboard in edit mode','The selected dashboard is new and its editing grid is empty.', ''),
}
crops={'open-dashboard':(0,0,640,400),'open-actions':(640,0,640,400),'choose-new-dashboard':(640,0,640,400),'dashboard-created':(200,0,640,400)}
article=(root/'article.html').read_text()
assets={}
for step in manifest['steps']:
    key=step['id'];alt,caption,number=labels[key]
    assets[key]='data:image/png;base64,'+base64.b64encode(Path(step['path']).read_bytes()).decode()
    focus=step['focus']
    if key=='dashboard-created':
        # The editable dotted area fills the workspace below the toolbar, beyond the empty grid node's height.
        focus=[focus[0],{'x':240,'y':141,'width':1040,'height':659}]
    layers=[];rings=[]
    for index,box in enumerate(focus):
        x,y,w,h=box['x'],box['y'],box['width'],box['height']
        inset=f'{y/8:.5f}% {(1280-x-w)/12.8:.5f}% {(800-y-h)/8:.5f}% {x/12.8:.5f}%'
        layers.append(f'<img class="fc-sharp" data-evidence="{key}" alt="" aria-hidden="true" style="clip-path:inset({inset})">')
        if key!='dashboard-created' or index==0:
            badge=f'<span class="fc-marker">{number}</span>' if number else ''
            rings.append(f'<span class="fc-ring" aria-hidden="true" style="left:{x/12.8:.5f}%;top:{y/8:.5f}%;width:{w/12.8:.5f}%;height:{h/8:.5f}%">{badge}</span>')
    figure=(root/'figure-template.html').read_text().replace('__ID__',key).replace('__ALT__',alt).replace('__CAPTION__',caption).replace('__SHARP_LAYERS__',''.join(layers)).replace('__FOCUS_RINGS__',''.join(rings))
    cx,cy,cw,ch=crops[key]
    scene_style=f'width:{1280/cw*100:.5f}%;height:{800/ch*100:.5f}%;left:{-cx/cw*100:.5f}%;top:{-cy/ch*100:.5f}%'
    figure=figure.replace('__SCENE_STYLE__',scene_style)
    article=article.replace('__FOCUS_SHOT:'+key+'__',figure)
source=(parent/'dashboard-evidence-template.html').read_text()
source=source.replace('dashboard-evidence-guide','dashboard-create-zoom-guide')
source=source.replace('__GUIDE_ARTICLE__',article).replace('__EVIDENCE_ASSETS__',json.dumps(assets,separators=(',',':')))
source=source.replace('Dashboard guide preview','Create a dashboard: closer screenshot crops')
source=re.sub(r'<nav class="dg-onpage".*?</nav>','<nav class="dg-onpage" aria-label="On this page"><p>On this page</p><a href="#dg-create">Create a dashboard</a><a href="#dg-open-dashboard">Open Dashboard</a><a href="#dg-open-actions">Open its menu</a><a href="#dg-choose-new">Choose New dashboard</a><a href="#dg-result">Expected result</a></nav>',source,flags=re.S)
# The new article uses captured frames instead of the original recording assets.
source+=(root/'focus-styles.html').read_text()
if re.search(r'__[A-Z][^\s]*__',source):raise ValueError('Unresolved placeholder')
if '\u2014' in source:raise ValueError('Em dash in preview')
fragment=parent/'create-dashboard-zoom-preview.html'
fragment.write_text(source)
if fragment.stat().st_size>=1_000_000:raise ValueError('Preview exceeds one megabyte')
renderer=Path('VISUALIZE_SKILL_DIR/scripts/render.py')
wrapped=parent/'create-dashboard-zoom-wrapped.html'
subprocess.run(['python3',str(renderer),str(fragment),str(wrapped),'--force'],check=True)
class Frame(HTMLParser):
    document=None
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='iframe' and attrs.get('id')=='codex-visualization':self.document=attrs.get('data-srcdoc')
frame=Frame();frame.feed(wrapped.read_text())
bridge=renderer.parent.parent.joinpath('assets/standalone-host-bridge.js').read_text().replace('</script',r'<\/script')
document=frame.document.replace('<script>'+bridge+'</script>','').replace('__CODEX_VISUALIZATION_WIDGET_STATE__','{}')
(parent/'create-dashboard-zoom-review.html').write_text(document)
kept=json.loads((root/'original-hashes.json').read_text())
assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in kept.items()),'An original file changed'
print('Zoom preview bytes:',fragment.stat().st_size)
print('Original files preserved:',len(kept))
print('Full-screen captures:',len(assets))
