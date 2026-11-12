"""Keep approved screenshot placements while translating article text blocks."""
from pathlib import Path
import html,re,runpy
ROOT=Path(__file__).resolve().parent
m=runpy.run_path(str(ROOT.parent/'promote-facilities.py'))
Parser=m['Parser']
def inline(text):
    text=html.escape(text,quote=False)
    text=re.sub(r'`([^`]+)`',r'<code>\1</code>',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',text)
def serial(n):
    if isinstance(n,str):return n
    attrs=''.join(' '+k+'="'+html.escape(v or '',quote=True)+'"' for k,v in n.attrs.items())
    body=''.join(serial(c) for c in n.children)
    return '<'+n.tag+attrs+'>'+body+('</'+n.tag+'>' if n.tag not in ['br','img','hr','input'] else '') if n.tag else body
for locale in ['fr','pt']:
    p=Parser();p.feed((ROOT.parent/'facilities-article.html').read_text())
    lines=(ROOT/f'{locale}.txt').read_text().splitlines();units=[]
    def walk(n):
        if isinstance(n,str):return
        if n.tag in ['p','h1','h2','h3','summary','li']:units.append(n)
        else:
            for c in n.children:walk(c)
    walk(p.root)
    assert len(lines)==len(units),(locale,len(lines),len(units))
    for n,t in zip(units,lines):n.children=[inline(t)]
    (ROOT/f'{locale}.html').write_text(serial(p.root))
    print(locale,len(units),'translated blocks, original screenshot placements retained')
