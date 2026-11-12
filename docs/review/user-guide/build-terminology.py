"""Build the terminology review without changing published documentation."""
from pathlib import Path
import html
import json
import re
import runpy

ROOT = Path(__file__).resolve().parent
helpers = runpy.run_path(str(ROOT / 'build.py'))


def build():
    manifest = json.loads((ROOT / 'terminology-evidence/capture-manifest.json').read_text())
    steps = {step['id']: step for step in manifest['steps']}
    helpers['high_resolution']('terminology', steps)
    assets = {}
    placements = []

    def figure(match):
        key, number = match.groups()
        step = steps[key]
        sw, sh = step['source_dimensions']
        targets = [dict(target) for target in step['focus']]
        if key in ('value-set-expansion', 'value-set-created'):
            targets[0]['height'] = 120
            targets[0]['width'] = 420
        if key == 'value-set-system-selection':
            targets[0]['width'] = 600
        if key == 'import-error':
            targets[0]['width'] = 450
        target = targets[0]
        # Keep the same display frame while bringing the relevant control closer.
        cw = min(sw, max(480, target['width'] + 50, (target['height'] + 50) * 1.6))
        ch = cw / 1.6
        if ch > sh:
            ch = sh
            cw = ch * 1.6
        cx = min(sw - cw, max(0, target['x'] + target['width'] / 2 - cw / 2))
        cy = min(sh - ch, max(0, target['y'] + target['height'] / 2 - ch / 2))
        layers = ''
        rings = ''
        marker_placement = None
        for target in targets:
            x, y, w, h = (target[k] for k in ['x', 'y', 'width', 'height'])
            inset = f'{y/sh*100}% {(sw-x-w)/sw*100}% {(sh-y-h)/sh*100}% {x/sw*100}%'
            layers += f'<img class="fc-sharp" data-evidence="{key}" alt="" aria-hidden="true" style="clip-path:inset({inset})">'
            marker_space = 24 * cw / 500
            if cx + cw - x - w >= marker_space:
                marker_placement, marker_style = 'after', 'left:calc(100% + 3px);right:auto'
            elif x - cx >= marker_space:
                marker_placement, marker_style = 'before', 'left:auto;right:calc(100% + 3px)'
            else:
                marker_placement, marker_style = 'inside', 'left:auto;right:4px'
            marker = f'<span class="fc-marker" style="{marker_style}">{number}</span>' if number != '0' else ''
            rings += f'<span class="fc-ring" aria-hidden="true" style="left:{x/sw*100}%;top:{y/sh*100}%;width:{w/sw*100}%;height:{h/sh*100}%">{marker}</span>'
        scene = f'width:{sw/cw*100}%;height:{sh/ch*100}%;left:{-cx/cw*100}%;top:{-cy/ch*100}%'
        assets[key] = helpers['asset'](step['path'])
        label = html.escape(step['label'], quote=True)
        placements.append({'id': key, 'crop': [cx, cy, cw, ch], 'targets': targets, 'step': int(number) or None, 'markerPlacement': marker_placement if number != '0' else None})
        return f'<figure class="dg-shot dg-context-shot" data-shot-id="{key}"><button type="button" class="cursor-interaction" data-enlarge aria-label="Enlarge {label}"><span class="fc-screenshot"><span class="fc-scene" style="{scene}"><img class="fc-background" data-evidence="{key}" alt="{label}">{layers}{rings}</span></span></button><figcaption>{label}</figcaption></figure>'

    article = (ROOT / 'terminology-article.html').read_text()
    page = (ROOT / 'terminology-template.html').read_text().replace('__GUIDE_ARTICLE__', article)
    page = re.sub(r'__SHOT:([^:]+):(\d+)__', figure, page)
    page = page.replace('__EVIDENCE_ASSETS__', json.dumps(assets, separators=(',', ':')))
    page += (ROOT / 'focus-styles.html').read_text().replace('dashboard-evidence-guide', 'terminology-evidence-guide')
    page += '<style>#terminology-evidence-guide .fc-marker{left:calc(100% + 3px);right:auto}#terminology-evidence-guide .dg-head-icons{padding-right:0}@media(max-width:900px){#terminology-evidence-guide .fc-marker{left:auto!important;right:4px!important}}</style>'
    assert '__SHOT:' not in page
    step_blocks = re.findall(r'<section class="dg-step">.*?</section>', article, re.S)
    assert all('__SHOT:' in block for block in step_blocks)
    assert len(placements) >= len(step_blocks)
    assert all(0 <= p['targets'][0]['y'] < steps[p['id']]['source_dimensions'][1] for p in placements)
    helpers['save'](page, 'terminology-review.html')
    (ROOT / 'terminology-evidence/framing.json').write_text(json.dumps(placements, indent=2) + '\n')
    print(f'Terminology: {len(placements)} equal screenshot frames, {len(step_blocks)} steps, {len(assets)} original captures.')


if __name__ == '__main__':
    build()
