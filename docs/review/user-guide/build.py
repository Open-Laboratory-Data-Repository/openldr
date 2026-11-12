"""Rebuild the review pages using only Python 3. Run from any directory."""
from pathlib import Path
import base64, json, re

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SHOTS = REPO / 'apps/studio/src/docs/0.1.0/screenshots'

def asset(path, mime=None):
    path = Path(path)
    if not path.is_absolute(): path = ROOT / path
    mime = mime or {'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4'}[path.suffix]
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode()

def save(fragment, name):
    icons = json.loads((ROOT/'icons.json').read_text())
    fragment = re.sub(r'<i data-lucide="([^"]+)"[^>]*></i>', lambda m: icons[m[1]], fragment)
    # Preserve product styling. No network resources are required for the walkthrough.
    head = (ROOT/'standalone-head.html').read_text()
    (ROOT/name).write_text(head+'\n'+fragment+'\n</body></html>\n')

def dashboard():
    steps = {s['id']:s for s in json.loads((ROOT/'evidence/step-evidence.json').read_text())['steps']}
    steps['dashboard-done'] = dict(steps['bar-step-2-add-widget'], crop_box=[1060,265,1268,310])
    captures = json.loads((ROOT/'create-dashboard-focus/capture-manifest.json').read_text())
    crops = {'open-dashboard':[0,0,640,400], 'open-actions':[640,0,640,400],
             'choose-new-dashboard':[640,0,640,400], 'dashboard-created':[200,0,640,400]}
    for step in captures['steps']:
        if step['id']=='dashboard-created': step['focus'][1]={'x':240,'y':141,'width':1040,'height':659}
        steps[step['id']] = dict(step, full_frame=step['path'], crop=crops[step['id']],source_dimensions=[1280,800])
    html=(ROOT/'dashboard-evidence-template.html').read_text().replace('__GUIDE_ARTICLE__',(ROOT/'dashboard-article.html').read_text())
    for key,file in [('FILTER_STEPS','filter-steps.html'),('BUILD_STEPS','bar-steps.html'),('CREATE_STEPS','create-steps.html'),('SAMPLE_SETUP','sample-setup.html'),('WIDGET_STEPS','widget-steps.html')]:
        html=html.replace('__'+key+'__',(ROOT/file).read_text())
    images={}
    def figure(key,alt,caption):
        step=steps[key]; sw,sh=step['source_dimensions']
        if 'focus' in step: focus=step['focus']
        else:
            x,y,x2,y2=step['crop_box'];focus=[dict(x=x,y=y,width=x2-x,height=y2-y)]
        if 'crop' in step: cx,cy,cw,ch=step['crop']
        else:
            f=focus[0];cw=min(sw,max(640,(f['width']+64),(f['height']+64)*1.6));ch=cw/1.6
            cx=min(sw-cw,max(0,f['x']+f['width']/2-cw/2));cy=min(sh-ch,max(0,f['y']+f['height']/2-ch/2))
        images[key]=asset(step['full_frame'])
        layers='';rings=''
        for i,f in enumerate(focus):
            x,y,w,h=[f[k] for k in ['x','y','width','height']]
            inset=f'{y/sh*100}% {(sw-x-w)/sw*100}% {(sh-y-h)/sh*100}% {x/sw*100}%'
            layers+=f'<img class="fc-sharp" data-evidence="{key}" alt="" aria-hidden="true" style="clip-path:inset({inset})">'
            if key!='dashboard-created' or i==0:
                badge = f'<span class="fc-marker">{list(crops).index(key)+1}</span>' if key in crops and key!='dashboard-created' else ''
                rings+=f'<span class="fc-ring" aria-hidden="true" style="left:{x/sw*100}%;top:{y/sh*100}%;width:{w/sw*100}%;height:{h/sh*100}%">{badge}</span>'
        scene=f'width:{sw/cw*100}%;height:{sh/ch*100}%;left:{-cx/cw*100}%;top:{-cy/ch*100}%'
        return f'<figure class="dg-shot dg-context-shot" data-shot-id="{key}"><button type="button" class="cursor-interaction" data-enlarge aria-label="Enlarge {alt}"><span class="fc-screenshot"><span class="fc-scene" style="{scene}"><img class="fc-background" data-evidence="{key}" alt="{alt}">{layers}{rings}</span></span></button><figcaption>{caption}</figcaption></figure>'
    labels={'open-dashboard':('Dashboard in the main menu','Dashboard is near the top of the main menu.'),
            'open-actions':('Dashboard menu beside Refresh','The dots menu is at the right end of the toolbar.'),
            'choose-new-dashboard':('New dashboard in the open menu','New dashboard is the first item in the menu.'),
            'dashboard-created':('New empty dashboard in edit mode','The new dashboard is selected and its editing grid is empty.')}
    html=re.sub(r'__FOCUS_SHOT:([^_]+)__',lambda m:figure(m[1],*labels[m[1]]),html)
    pattern=r'<figure class="dg-shot"[^>]*><button[^>]*><img src="__IMAGE:([^_]+)__" alt="([^"]*)"></button><figcaption>(.*?)</figcaption></figure>'
    html=re.sub(pattern,lambda m:figure(m[1],m[2],m[3]),html,flags=re.S)
    html=html.replace('__EVIDENCE_ASSETS__',json.dumps(images,separators=(',',':')))
    for key,file in [('FILTER_VIDEO','dashboard-filters.mp4'),('BUILD_VIDEO','dashboard-new-widget.mp4'),('FILTER_POSTER','dashboard-filters.png'),('BUILD_POSTER','dashboard-new-widget.png')]:html=html.replace('__'+key+'__',asset(SHOTS/file))
    html+=(ROOT/'focus-styles.html').read_text()
    assert not re.search(r'__(?:IMAGE|WIDTH|FOCUS_SHOT|BUILD|FILTER)',html)
    save(html,'dashboard-review.html')
    print('Dashboard:',len(images),'original full-screen captures,',html.count('class="fc-screenshot"'),'equal frames')

def start():
    steps={s['id']:s for s in json.loads((ROOT/'start-evidence/start-evidence.json').read_text())['steps']}
    terminal=json.loads((ROOT/'terminal-illustrations/manifest.json').read_text())['steps']
    steps.update({s['id']:s for s in terminal})
    html=(ROOT/'start-here-template.html').read_text().replace('__START_ARTICLE__',(ROOT/'start-here-article.html').read_text())
    used=set()
    def reference(m):used.add(m[1]);return 'data-evidence="'+m[1]+'"'
    html=re.sub(r'src="__IMAGE:([^_]+)__"',reference,html)
    stages=set(re.findall(r'data-terminal-stage="([^"]+)"',html))
    used.update(s['id'] for s in terminal if s['stage'] in stages)
    html=html.replace('__EVIDENCE_ASSETS__',json.dumps({k:asset(steps[k]['path']) for k in sorted(used)},separators=(',',':')))
    html=re.sub(r'__WIDTH:([^_]+)__',lambda m:str(min(500,steps[m[1]]['crop_dimensions'][0])),html)
    save(html,'start-here-review.html'); print('Start here:',len(used),'illustrations')

if __name__=='__main__':dashboard();start()
