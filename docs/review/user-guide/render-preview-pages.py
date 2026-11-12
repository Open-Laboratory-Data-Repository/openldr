from html.parser import HTMLParser
from pathlib import Path
import subprocess

root=Path(__file__).parent
renderer=Path('VISUALIZE_SKILL_DIR/scripts/render.py')

class FrameDocument(HTMLParser):
    document=None
    def handle_starttag(self,tag,attrs):
        if tag=='iframe':
            values=dict(attrs)
            if values.get('id')=='codex-visualization':
                self.document=values.get('data-srcdoc')

for source_name,target_name in [
    ('dashboard-evidence-preview.html','dashboard-review.html'),
    ('start-here-evidence-preview.html','start-here-review.html'),
]:
    wrapped=root/target_name.replace('.html','-wrapped.html')
    subprocess.run(['python3',str(renderer),str(root/source_name),str(wrapped),'--force'],check=True)
    frame=FrameDocument()
    frame.feed(wrapped.read_text())
    if not frame.document:
        raise ValueError('Generated preview document is missing')
    # Serve the full document directly so ordinary sidebar links change pages.
    bridge=renderer.parent.parent.joinpath('assets/standalone-host-bridge.js').read_text().replace('</script',r'<\/script')
    document=frame.document.replace('<script>'+bridge+'</script>','')
    document=document.replace('__CODEX_VISUALIZATION_WIDGET_STATE__','{}')
    root.joinpath(target_name).write_text(document)
    print('Served page:',target_name)
