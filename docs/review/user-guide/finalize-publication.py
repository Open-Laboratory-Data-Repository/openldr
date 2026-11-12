"""Keep translated links, command samples and native assets aligned at publication."""
from pathlib import Path
from collections import Counter
import difflib,hashlib,json,re,runpy,unicodedata
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
DOCS=REPO/'apps/studio/src/docs/0.1.8'
ASSETS=json.loads((ROOT/'publication-assets.json').read_text())
SLUGS=list(ASSETS['capturedNames'])

def heading_ids(text):
 used=Counter();result=[];fence=False
 for line in text.splitlines():
  if line.startswith('```'):fence=not fence;continue
  match=not fence and re.match(r'^(#{1,6}) (.+)$',line)
  if not match:continue
  value=re.sub(r'\[([^]]*)\]\([^)]+\)',r'\1',match[2]);value=re.sub(r'[*`]', '',value)
  base=re.sub('[^a-z0-9]+','-',unicodedata.normalize('NFD',value).encode('ascii','ignore').decode().lower()).strip('-') or 'section'
  n=used[base];used[base]+=1;result.append((base+('-'+str(n) if n else ''),len(match[1])))
 return result

def original_ids(values):
 used=Counter();out=[]
 for value in values:
  n=used[value];used[value]+=1;out.append(value+('-'+str(n) if n else ''))
 return out

if __name__=='__main__':
 # Preserve the original, tested command samples. Only launcher notation changes.
 helper=runpy.run_path(str(ROOT/'promote-guides.py'))
 for slug in SLUGS:
  parser=helper['Parser']();parser.feed((ROOT/(slug+'-article.html')).read_text());blocks=[]
  def walk(n):
   if isinstance(n,str):return
   if n.tag=='pre':blocks.append(helper['plain'](n).strip())
   else:
    for c in n.children:walk(c)
  walk(parser.root)
  for locale in ['en','fr','pt']:
   p=DOCS/locale/(slug+'.md');text=p.read_text();found=re.findall(r'```[^\n]*\n(.*?)\n```',text,re.S);assert len(found)==len(blocks),(locale,slug,'fences')
   iterator=iter(blocks)
   text=re.sub(r'(```[^\n]*\n)(.*?)(\n```)',lambda m:m[1]+re.sub(r'(?m)^openldr ', './openldr ',next(iterator))+m[3],text,flags=re.S)
   if slug in ['query','reports','workflows']:
    hints={
     'en':'Use `./openldr` in your installed Linux or macOS folder, `.\\openldr.ps1` on Windows, or `pnpm openldr` in a development checkout. Run it from your actual `openldr_ce` folder. [Start here](/docs/start-here) explains the launcher and file paths.',
     'fr':"Utilisez `./openldr` dans votre dossier installé sous Linux ou macOS, `.\\openldr.ps1` sous Windows, ou `pnpm openldr` dans une copie de développement. Lancez la commande depuis votre dossier `openldr_ce`. [Start here](/docs/start-here) explique le lanceur et les chemins.",
     'pt':'Use `./openldr` na pasta instalada em Linux ou macOS, `.\\openldr.ps1` em Windows, ou `pnpm openldr` numa cópia de desenvolvimento. Execute o comando na sua pasta `openldr_ce`. [Start here](/docs/start-here) explica o lançador e os caminhos.'}
    # The paragraph immediately above the CLI block is the launcher handoff.
    text=re.sub(r'[^\n]+\n\n(?=```shell\n\./openldr )',lambda _:hints[locale]+'\n\n',text)
   p.write_text(text)

 headings={locale:{p.stem:heading_ids(p.read_text()) for p in (DOCS/locale).glob('*.md')} for locale in ['en','fr','pt']}
 old_to_en={}
 for slug,values in ASSETS['sourceHeadingIds'].items():
  old=original_ids(values);new=[x[0] for x in headings['en'][slug]];mapping={x:x for x in old if x in new}
  for op,a,b,c,d in difflib.SequenceMatcher(a=old,b=new,autojunk=False).get_opcodes():
   if op=='replace' and b-a==d-c:
    mapping.update(zip(old[a:b],new[c:d]))
  old_to_en[slug]=mapping
 for locale in ['en','fr','pt']:
  for slug in SLUGS:
   p=DOCS/locale/(slug+'.md');text=p.read_text()
   def fix(m):
    href=m[1];parts=href.split('#',1);target=slug if not parts[0] else parts[0].removeprefix('/docs/')
    if target not in headings[locale]:raise AssertionError((slug,locale,href))
    en_ids=[x[0] for x in headings['en'][target]];local_ids=[x[0] for x in headings[locale][target]]
    assert len(en_ids)==len(local_ids),(locale,target,'headings')
    original=parts[1];anchor=old_to_en.get(target,{}).get(original,original)
    if anchor in en_ids:anchor=local_ids[en_ids.index(anchor)]
    assert anchor in local_ids,(locale,slug,href,anchor)
    return ']('+parts[0]+'#'+anchor+')'
   text=re.sub(r'\]\(((?:/docs/[^)#]+)?#[^)]+)\)',fix,text);p.write_text(text)

 report={'guides':len(SLUGS),'stepsPerLocale':0,'framesPerLocale':0,'locales':['en','fr','pt'],'downloads':len(ASSETS['downloads']),'nativeAssets':0}
 focus=json.loads((REPO/'apps/studio/src/docs/reviewed-guides-focus.json').read_text())
 for slug in SLUGS:
  en=(DOCS/'en'/(slug+'.md')).read_text();en_steps=re.findall(r'^### (\d+)\. ',en,re.M);images=re.findall(r'!\[[^\n]*?\]\(([^)]+)\)',en);fences=re.findall(r'```[^\n]*\n(.*?)\n```',en,re.S)
  assert '\u2014' not in en and '-review.html' not in en and 'this preview' not in en.lower(),slug
  expected=sum(len(t['steps']) for t in json.loads((ROOT/(slug+'-guide.json')).read_text())['tasks']);assert len(en_steps)==expected,(slug,len(en_steps),expected)
  report['stepsPerLocale']+=expected;report['framesPerLocale']+=len(images)
  for locale in ['fr','pt']:
   text=(DOCS/locale/(slug+'.md')).read_text();assert re.findall(r'^### (\d+)\. ',text,re.M)==en_steps,(locale,slug,'steps')
   assert re.findall(r'!\[[^\n]*?\]\(([^)]+)\)',text)==images,(locale,slug,'images')
   assert re.findall(r'```[^\n]*\n(.*?)\n```',text,re.S)==fences,(locale,slug,'code')
   assert [x[1] for x in headings[locale][slug]]==[x[1] for x in headings['en'][slug]],(locale,slug,'heading levels')
   assert '\u2014' not in text and '-review.html' not in text,(locale,slug)
  manifest={s['id']:s for s in json.loads((ROOT/(slug+'-evidence/capture-manifest.json')).read_text())['steps']}
  for image in ASSETS['capturedNames'][slug]:
   key=image.removeprefix(slug+'-guide-').removesuffix('.png');key=re.sub(r'-step-\d+$','',key);source=ROOT/manifest[key]['path'];target=REPO/'apps/studio/src/docs/0.1.0/screenshots'/image
   assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(target.read_bytes()).digest(),image
   assert image in focus,image
   report['nativeAssets']+=1
 for url,file in ASSETS['downloads'].items():assert (REPO/file).is_file(),url
 (ROOT/'publication-integrity.json').write_text(json.dumps(report,indent=2)+'\n');print('PUBLICATION INTEGRITY PASS '+json.dumps(report))
