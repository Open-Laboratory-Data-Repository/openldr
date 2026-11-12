"""Publish the approved Facilities article and its native screenshot framing."""
from pathlib import Path
from html.parser import HTMLParser
import html
import json
import re
import shutil

ROOT = Path(__file__).resolve().parent
DOCS = ROOT.parents[2] / 'apps/studio/src/docs'
import unicodedata

ANCHORS={}
for locale in ['en','fr','pt']:
    file=ROOT/'facilities-article.html' if locale=='en' else ROOT/'facilities-translations'/f'{locale}.html'
    if file.exists():
        ANCHORS[locale]={key:re.sub('[^a-z0-9]+','-',unicodedata.normalize('NFD',re.sub('<[^>]+>','',label)).encode('ascii','ignore').decode().lower()).strip('-') for key,label in re.findall(r'<h2 id="([^"]+)">(.*?)</h2>',file.read_text())}

MANIFEST = json.loads((ROOT / 'facilities-evidence/capture-manifest.json').read_text())
STEPS = {s['id']:s for s in MANIFEST['steps']}
ARTICLE = (ROOT/'facilities-article.html').read_text()
PLACEMENTS = re.findall(r'__SHOT:([^:]+):(\d+)__', ARTICLE)
REUSED = {key for key, _ in PLACEMENTS if len({n for k,n in PLACEMENTS if k==key})>1}

def image_name(key, number):
    return 'facilities-guide-'+key+('-step-'+str(number) if key in REUSED else '')+'.png'

LABELS = {s['id']:s['label'] for s in json.loads((ROOT / 'facilities-evidence/capture-manifest.json').read_text())['steps']}

class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(); self.root = Node(); self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs); self.stack[-1].children.append(n)
        if tag not in ('br','img','hr','input'): self.stack.append(n)
    def handle_endtag(self, tag):
        if self.stack[-1].tag == tag: self.stack.pop()
    def handle_data(self, data): self.stack[-1].children.append(data)

def render(node):
    if isinstance(node,str): return node
    if node.attrs.get('class')=='dg-meta': return ''
    body = ''.join(render(c) for c in node.children)
    if node.tag in ['h1','h2','h3']: return '\n'+'#'*int(node.tag[1])+' '+body.strip()+'\n\n'
    if node.tag=='strong': return '**'+body+'**'
    if node.tag=='pre': return '\n```shell\n'+plain(node).strip()+'\n```\n\n'
    if node.tag=='li': return '- '+body.strip()+'\n'
    if node.tag=='ul': return '\n'+body+'\n'
    if node.tag=='code': return '`'+body+'`'
    if node.tag=='p': return body.strip()+'\n\n'
    if node.tag=='summary': return '\n### '+body+'\n\n'
    if node.tag=='details': return body.strip()+'\n\n'
    if node.tag=='a':
        href=node.attrs['href'].replace('http://100.107.125.94:5173/studio/docs/','/docs/')
        href={'start-here-review.html':'/docs/start-here','preferences-review.html':'/docs/user-preferences'}.get(href,href)
        href={'facilities-evidence/example-facilities.csv':'https://openldr.online/docs-samples/example-facilities.csv','facilities-evidence/example-observed-data.json':'https://openldr.online/docs-samples/example-observed-data.json','terminology-review.html':'/docs/terminology','dashboard-review.html':'/docs/dashboard'}.get(href,href)
        if href.startswith('#dg-'):
            href='#'+ANCHORS[locale][href[1:]]
        return '['+body+']('+href+')'
    return body

def plain(node):
    return node if isinstance(node,str) else ''.join(plain(c) for c in node.children)

def shots(text,locale):
    def replace(m):
        key=m[1];label=LABELS[key]
        if locale!='en':
            headings = re.findall(r'^#{2,3} (.+)$',text[:m.start()],re.M)
            heading = re.sub(r'^\d+\. ', '',headings[-1]) if headings else 'Terminologia'
            label=('Capture de Studio : ' if locale=='fr' else 'Captura do Studio: ')+heading
        return '\n\n!['+label+']('+image_name(key,m[2])+')\n\n'
    return re.sub(r'__SHOT:([^:]+):(\d+)__',replace,text)

if __name__=='__main__':
    locale='en'
    parser=Parser();parser.feed((ROOT/'facilities-article.html').read_text())
    article=shots(render(parser.root),'en')
    article=re.sub(r'\n[ \t]+','\n',article)
    article=re.sub(r'\n{3,}','\n\n',article).strip()+'\n'
    (DOCS/'0.1.8/en/facilities.md').write_text(article)
    for locale in ['fr','pt']:
        parser=Parser();parser.feed((ROOT/'facilities-translations'/f'{locale}.html').read_text())
        translated=shots(render(parser.root),locale)
        translated=re.sub(r'\n[ \t]+','\n',translated)
        (DOCS/f'0.1.8/{locale}/facilities.md').write_text(re.sub(r'\n{3,}','\n\n',translated).strip()+'\n')
    focus={}
    for frame in json.loads((ROOT/'facilities-evidence/framing.json').read_text()):
        key=frame['id'];name=image_name(key,frame['step'] or 0)
        shutil.copy2(ROOT/STEPS[key]['path'],DOCS/'0.1.0/screenshots'/name)
        entry={'crop':dict(zip(['x','y','width','height'],frame['crop'])), 'targets':frame['targets'],
               'source':dict(zip(['width','height'],STEPS[key]['source_dimensions'])),
               'markerPlacement':frame.get('markerPlacement')}
        if frame['step']: entry['step']=frame['step']
        focus[name]=entry
    (DOCS/'facilities-focus.json').write_text(json.dumps(focus,indent=2)+'\n')
    print(f'Published approved Facilities in English, French and Portuguese and {len(focus)} native screenshots.')
