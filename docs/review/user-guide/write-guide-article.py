"""Render task prose and evidence placements into the established preview article."""
from pathlib import Path
import html,json,sys
ROOT=Path(__file__).resolve().parent
slug=sys.argv[1]
guide=json.loads((ROOT/f'{slug}-guide.json').read_text())
parts=['<article class="dg-article" id="dg-top">','<div class="dg-meta">'+''.join('<span>'+html.escape(x)+'</span>' for x in guide['meta'])+'</div>','<h1>'+html.escape(guide['title'])+'</h1>']
def para(text):return '<p>'+text+'</p>'
def shot(key,number):return '__SHOT:'+key+':'+str(number)+'__'
parts.extend(para(p) for p in guide['intro'])
for task in guide['tasks']:
 parts.append('<h2 id="dg-'+task['id']+'">'+html.escape(task['title'])+'</h2>')
 parts.extend(para(p) for p in task['intro'])
 for i,step in enumerate(task['steps'],1):
  title,text,ids=step
  assert ids,(task['id'],title)
  parts.append('<section class="dg-step"><h3><span class="dg-number">'+str(i)+'.</span> '+html.escape(title)+'</h3>'+para(text)+''.join(shot(k,i) for k in ids)+'</section>')
 if task.get('result'):parts.append('<div class="dg-result">'+para('<strong>Expected result:</strong> '+task['result'])+'</div>')
 parts.extend(shot(k,0) for k in task.get('resultShots',[]))
for section in guide['end']:
 parts.append('<h2 id="dg-'+section['id']+'">'+html.escape(section['title'])+'</h2>')
 parts.extend(para(p) for p in section.get('paragraphs',[]))
 parts.extend(section.get('html',[]))
parts.append('</article>')
(ROOT/f'{slug}-article.html').write_text('\n'.join(parts)+'\n')
print(guide['title'],sum(len(t['steps']) for t in guide['tasks']),'numbered steps')
