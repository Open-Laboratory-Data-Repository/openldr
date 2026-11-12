"""Rebuild the review pages using only Python 3. Run from any directory."""
from pathlib import Path
import base64, html as html_escape, json, re

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SHOTS = REPO / 'apps/studio/src/docs/0.1.0/screenshots'

def asset(path, mime=None):
    path = Path(path)
    if not path.is_absolute(): path = ROOT / path
    mime = mime or {'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4'}[path.suffix]
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode()

def high_resolution(page, steps):
    manifest = ROOT / 'high-resolution' / (page + '-manifest.json')
    if not manifest.exists(): return steps
    captured = {s['id']:s for s in json.loads(manifest.read_text())['steps']}
    for key, step in steps.items():
        if key not in captured: continue
        fresh = captured[key]
        step['path'] = fresh['path']
        step['full_frame'] = fresh['path']
        if page == 'dashboard':
            if 'focus' not in step:
                x,y,x2,y2 = step['crop_box']
                step['focus'] = [dict(x=x,y=y,width=x2-x,height=y2-y)]
            previous = step['focus']
            step['focus'] = [dict(r) for r in fresh['focus']]
            if key != 'dashboard-created' and previous:
                step['focus'][0]['width'] = min(previous[0]['width'],step['focus'][0]['width'])
                step['focus'][0]['height'] = min(previous[0]['height'],step['focus'][0]['height'])
        elif key not in ('term-details','distribution-importer'):
            previous = step.get('focus', [])
            step['focus'] = [dict(r) for r in fresh['focus']]
            # Preserve the approved close framing when a table row spans the page.
            if previous and step['focus']:
                step['focus'][0]['width'] = min(previous[0]['width'],step['focus'][0]['width'])
                if key in ('language-result','start-page-result'):
                    step['focus'][0]['height'] = previous[0]['height']
        step['source_dimensions'] = fresh['source_dimensions']
    return steps

def navigation(name):
    pages={'start-here':'start-here-review.html','dashboard':'dashboard-review.html',
           'user-preferences':'preferences-review.html','terminology':'terminology-review.html',
           'facilities':'facilities-review.html'}
    current=next((k for k,v in pages.items() if v==name),None)
    result='<nav class="dg-docnav" aria-label="Documentation sections">'
    for group in json.loads((ROOT/'navigation.json').read_text()):
        result+='<div class="dg-group"><span class="dg-group-label">'+group['title']+'</span>'
        for item in group['items']:
            slug=item['slug'];label=html_escape.escape(item['title'])
            title=' title="Optional setup. Strongly recommended as you use OpenLDR."' if item['optional'] else ''
            if slug in pages:
                selected=' dg-selected' if slug==current else ''
                here=' aria-current="page"' if slug==current else ''
                href=('#sh-top' if slug=='start-here' else '#dg-top') if slug==current else pages[slug]
                result+=f'<a class="dg-navitem{selected}" href="{href}"{here}{title}>{label}</a>'
            else:
                result+=f'<span class="dg-navitem"{title}>{label}</span>'
        result+='</div>'
    return result+'</nav>'

def save(fragment, name):
    fragment=fragment.replace('__PREVIEW_NAVIGATION__',navigation(name))
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
    high_resolution('dashboard', steps)
    html=(ROOT/'dashboard-evidence-template.html').read_text().replace('__GUIDE_ARTICLE__',(ROOT/'dashboard-article.html').read_text())
    for key,file in [('FILTER_STEPS','filter-steps.html'),('BUILD_STEPS','bar-steps.html'),('CREATE_STEPS','create-steps.html'),('SAMPLE_SETUP','sample-setup.html'),('WIDGET_STEPS','widget-steps.html')]:
        html=html.replace('__'+key+'__',(ROOT/file).read_text())
    images={}
    placements=[]
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
        placements.append(dict(id=key,crop=[cx,cy,cw,ch],targets=focus))
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
    (ROOT/'high-resolution/dashboard-framing.json').write_text(json.dumps(placements,indent=2)+'\n')
    print('Dashboard:',len(images),'original full-screen captures,',html.count('class="fc-screenshot"'),'equal frames')

def start():
    steps={s['id']:s for s in json.loads((ROOT/'start-evidence/start-evidence.json').read_text())['steps']}
    terminal=json.loads((ROOT/'terminal-dotted/app-manifest.json').read_text())['steps']
    steps.update({s['id']:s for s in terminal})
    html=(ROOT/'start-here-template.html').read_text().replace('__START_ARTICLE__',(ROOT/'start-here-article.html').read_text())
    used=set()
    def reference(m):used.add(m[1]);return 'data-evidence="'+m[1]+'"'
    html=re.sub(r'src="__IMAGE:([^_]+)__"',reference,html)
    stages=set(re.findall(r'data-terminal-stage="([^"]+)"',html))
    used.update(s['id'] for s in terminal if s['stage'] in stages)
    html=html.replace('__EVIDENCE_ASSETS__',json.dumps({k:asset(steps[k]['path']) for k in sorted(used)},separators=(',',':')))
    html=re.sub(r'__WIDTH:([^_]+)__',lambda m:str(min(500,steps[m[1]]['crop_dimensions'][0])),html)
    def themed_figure(match):
        figure = match[0].replace('class="dg-shot"', 'class="dg-shot dg-dotted-shot"')
        return re.sub(r'(<img[^>]*>)', r'<span class="dg-dotted-frame doc-dotted-frame"><span class="doc-dotted-dots" aria-hidden="true"></span><span class="doc-dotted-window">\1</span></span>', figure)
    html = re.sub(r'<figure class="dg-shot"[^>]*>.*?</figure>', themed_figure, html, flags=re.S)
    html += '<style>' + (REPO/'apps/studio/src/docs/DottedIllustration.css').read_text() + '</style>'
    save(html,'start-here-review.html'); print('Start here:',len(used),'themed illustrations')

if __name__=='__main__':dashboard();start()
