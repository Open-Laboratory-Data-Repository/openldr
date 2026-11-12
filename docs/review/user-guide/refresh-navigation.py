"""Refresh active preview menus without rebuilding their image payloads."""
from pathlib import Path
import runpy,json,re
ROOT=Path(__file__).resolve().parent
helpers=runpy.run_path(str(ROOT/'build.py'))
for name in json.loads((ROOT/'preview-pages.json').read_text()).values():
    p=ROOT/name
    if not p.exists():continue
    text,n=re.subn(r'<nav class="dg-docnav".*?</nav>',lambda _:helpers['navigation'](name),p.read_text(),flags=re.S)
    assert n==1,(name,n)
    p.write_text(text)
    print(name)
