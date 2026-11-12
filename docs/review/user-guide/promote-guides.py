"""Publish the approved structured guides with their original native image framing."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import html,json,re,shutil,unicodedata
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
DOCS=REPO/'apps/studio/src/docs'
PUBLIC=REPO/'apps/web/public/docs-samples/user-guide'
GUIDES={p.name.removesuffix('-guide.json'):json.loads(p.read_text()) for p in sorted(ROOT.glob('*-guide.json'))}
PAGES=json.loads((ROOT/'preview-pages.json').read_text())
PAGE_SLUGS={v:k for k,v in PAGES.items()}
def plain_heading(s):return re.sub(r'[*`]', '',s)
def slugify(s):return re.sub('[^a-z0-9]+','-',unicodedata.normalize('NFD',plain_heading(s)).encode('ascii','ignore').decode().lower()).strip('-')
ANCHORS={s:{'dg-'+x['id']:slugify(x['title']) for x in g['tasks']+g['end']} for s,g in GUIDES.items()}
DOWNLOADS={}
class Node:
 def __init__(self,tag='',attrs=()):self.tag,self.attrs,self.children=tag,dict(attrs),[]
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.root=Node();self.stack=[self.root]
 def handle_starttag(self,tag,attrs):
  n=Node(tag,attrs);self.stack[-1].children.append(n)
  if tag not in ['br','img','hr','input']:self.stack.append(n)
 def handle_endtag(self,tag):
  if self.stack[-1].tag==tag:self.stack.pop()
 def handle_data(self,data):self.stack[-1].children.append(data)
def plain(n):return n if isinstance(n,str) else ''.join(plain(c) for c in n.children)
def link(href,slug):
 parsed=urlsplit(href)
 if parsed.scheme or href.startswith('/'):return href
 if href.startswith('#'):return '#'+ANCHORS[slug].get(href[1:],href[1:])
 file=parsed.path.removeprefix('./')
 if file in PAGE_SLUGS:
  target=PAGE_SLUGS[file];frag=ANCHORS.get(target,{}).get(parsed.fragment,parsed.fragment)
  return '/docs/'+target+('#'+frag if frag else '')
 source=(ROOT/file).resolve();assert source.is_relative_to(ROOT) and source.is_file(),(slug,href)
 target=PUBLIC/slug/source.name;target.parent.mkdir(parents=True,exist_ok=True)
 if target.exists():assert target.read_bytes()==source.read_bytes(),target
 else:shutil.copy2(source,target)
 url='https://openldr.online/docs-samples/user-guide/'+slug+'/'+source.name
 DOWNLOADS[url]=str(target.relative_to(REPO))
 return url

def render(n,slug):
 if isinstance(n,str):return n
 if n.attrs.get('class')=='dg-meta':return ''
 if n.tag=='pre':return '\n```shell\n'+plain(n).strip()+'\n```\n\n'
 if n.tag=='table':
  rows=[]
  def walk(x):
   if isinstance(x,str):return
   if x.tag=='tr':rows.append([''.join(render(y,slug) for y in c.children).strip().replace('|','\\|').replace('\n',' ') for c in x.children if not isinstance(c,str) and c.tag in ['th','td']])
   else:
    for c in x.children:walk(c)
  walk(n);assert rows
  return '\n'+'\n'.join(['| '+' | '.join(rows[0])+' |','| '+' | '.join('---' for _ in rows[0])+' |']+['| '+' | '.join(row)+' |' for row in rows[1:]])+'\n\n'
 body=''.join(render(c,slug) for c in n.children)
 if n.tag in ['h1','h2','h3']:return '\n'+'#'*int(n.tag[1])+' '+body.strip()+'\n\n'
 if n.tag=='strong':return '**'+body+'**'
 if n.tag=='code':return '`'+body+'`'
 if n.tag=='p':return body.strip()+'\n\n'
 if n.tag=='a':return '['+body+']('+link(n.attrs['href'],slug)+')'
 if n.tag=='li':return '- '+body.strip()+'\n'
 if n.tag in ['ul','ol','details']:return '\n'+body.strip()+'\n\n'
 if n.tag=='summary':return '\n### '+body.strip()+'\n\n'
 if n.tag=='br':return '\n'
 return body

if __name__=='__main__':
 focus={};published={};headings={}
 for slug,guide in GUIDES.items():
  manifest=json.loads((ROOT/(slug+'-evidence/capture-manifest.json')).read_text());steps={s['id']:s for s in manifest['steps']}
  article=(ROOT/(slug+'-article.html')).read_text();uses=re.findall(r'__SHOT:([^:]+):(\d+)__',article)
  reused={key for key,_ in uses if len({n for k,n in uses if k==key})>1}
  def name(key,number):return slug+'-guide-'+key+('-step-'+str(number) if key in reused else '')+'.png'
  parser=Parser();parser.feed(article);text=render(parser.root,slug)
  def shot(m):
   key,number=m.groups();return '\n\n!['+steps[key]['label'].replace(']','\\]')+']('+name(key,number)+')\n\n'
  text=re.sub(r'__SHOT:([^:]+):(\d+)__',shot,text);text=re.sub(r'\n[ \t]+','\n',text);text=re.sub(r'\n{3,}','\n\n',text).strip()+'\n'
  (DOCS/('0.1.8/en/'+slug+'.md')).write_text(text)
  headings[slug]=[slugify(line) for line in re.findall(r'^#{1,6} (.+)$',text,re.M)]
  names=[]
  for frame in json.loads((ROOT/(slug+'-evidence/framing.json')).read_text()):
   key=frame['id'];filename=name(key,str(frame['step'] or 0));source=ROOT/steps[key]['path'];target=DOCS/'0.1.0/screenshots'/filename
   if target.exists():assert target.read_bytes()==source.read_bytes(),filename
   else:shutil.copy2(source,target)
   entry={'crop':dict(zip(['x','y','width','height'],frame['crop'])),'targets':frame['targets'],'source':dict(zip(['width','height'],steps[key]['source_dimensions'])),'markerPlacement':frame.get('markerPlacement')}
   if len(entry['targets'])>1:
    c=entry['crop'];space=24*c['width']/500
    entry['markerPlacements']=['after' if c['x']+c['width']-t['x']-t['width']>=space else 'before' if t['x']-c['x']>=space else 'inside' for t in entry['targets']]
   if frame['step']:entry['step']=frame['step']
   if filename in focus:assert focus[filename]==entry,filename
   focus[filename]=entry;names.append(filename)
  published[slug]=list(dict.fromkeys(names))
 (DOCS/'reviewed-guides-focus.json').write_text(json.dumps(focus,indent=2)+'\n')
 (ROOT/'publication-assets.json').write_text(json.dumps({'capturedNames':published,'downloads':DOWNLOADS,'sourceHeadingIds':headings},indent=2)+'\n')
 registry=DOCS/'registry.ts';ts=registry.read_text()
 for slug,names in published.items():
  pattern=r"(?ms)^  \{\n    slug: '"+re.escape(slug)+r"',.*?^  \},"
  match=re.search(pattern,ts);assert match,slug
  block=match.group();old=re.search(r'capturedNames:\s*\[([\s\S]*?)\],',block)
  existing=re.findall("'([^']+)'",old[1]) if old else []
  value='capturedNames: [\n'+''.join("      '"+x+"',\n" for x in dict.fromkeys(existing+names))+'    ],'
  block=re.sub(r'capturedNames:\s*\[[\s\S]*?\],',lambda _:value,block) if old else block.replace("    status:","    "+value+"\n    status:")
  ts=ts[:match.start()]+block+ts[match.end():]
 registry.write_text(ts)
 component=DOCS/'FocusedScreenshot.tsx';ts=component.read_text()
 if "import reviewedGuidesFocus" not in ts:ts=ts.replace("import facilitiesFocus from './facilities-focus.json';","import facilitiesFocus from './facilities-focus.json';\nimport reviewedGuidesFocus from './reviewed-guides-focus.json';").replace('  ...facilitiesFocus as Record<string, Focus>,','  ...facilitiesFocus as Record<string, Focus>,\n  ...reviewedGuidesFocus as Record<string, Focus>,')
 component.write_text(ts)
 print('Published English sources for',len(published),'guides,',len(focus),'native image placements and',len(DOWNLOADS),'optional downloads.')
