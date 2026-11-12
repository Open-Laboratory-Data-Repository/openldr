import { useId, type ReactNode } from 'react';
import type { ProductVideo } from '@/landing/videos';

const blue = 'var(--brand)';
const ink = 'var(--text)';
const muted = 'var(--border-2)';
const wash = 'var(--brand-wash)';

function Pane({ x, y, width, height, children }: { x: number; y: number; width: number; height: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="7" fill="var(--card)" stroke="var(--border)" />
      {children}
    </g>
  );
}

function Lines({ x, y, widths, gap = 16 }: { x: number; y: number; widths: number[]; gap?: number }) {
  return <g stroke={muted} strokeWidth="5" strokeLinecap="round">
    {widths.map((width, index) => <path key={index} d={`M${x} ${y + index * gap}h${width}`} />)}
  </g>;
}

function Dashboard() {
  return <>
    {[64, 184, 304].map((x, index) => <Pane key={x} x={x} y={72} width={110} height={48}>
      <path d={`M${x + 12} 86h38`} stroke={muted} strokeWidth="4" strokeLinecap="round" />
      <path d={`M${x + 12} 105h${26 + index * 9}`} stroke={blue} strokeWidth="8" strokeLinecap="round" />
    </Pane>)}
    <Pane x={64} y={130} width={170} height={92}>
      {[30, 52, 40, 64, 48].map((height, index) => <rect key={index} x={80 + index * 29} y={210 - height} width="18" height={height} rx="3" fill={blue} opacity={.5 + index * .1} />)}
    </Pane>
    <Pane x={244} y={130} width={170} height={92}>
      <path d="M258 207 278 194 294 201 316 157 335 182 355 166 379 180 400 148V210H258Z" fill={wash} />
      <path d="M258 207 278 194 294 201 316 157 335 182 355 166 379 180 400 148" fill="none" stroke={blue} strokeWidth="4" strokeLinejoin="round" />
    </Pane>
  </>;
}

function Query() {
  return <>
    <Pane x={64} y={72} width={350} height={92}>
      <g fontFamily="ui-monospace, monospace" fontSize="17" fontWeight="600">
        <text x="80" y="99" fill={blue}>SELECT</text><text x="154" y="99" fill={ink}>*</text>
        <text x="80" y="122" fill={blue}>FROM</text><text x="135" y="122" fill={ink}>lab_results</text>
      </g>
      <path d="m375 122 10 6-10 6Z" fill={blue} />
      <Lines x={80} y={145} widths={[118]} />
    </Pane>
    <Pane x={64} y={174} width={350} height={48}>
      <path d="M65 190h348M65 206h348M175 175v46M294 175v46" stroke="var(--border)" />
      <path d="M78 182h63m47 0h55m64 0h62" stroke={blue} strokeWidth="3" strokeLinecap="round" />
    </Pane>
  </>;
}

function Report() {
  return <>
    <Pane x={64} y={72} width={96} height={150}>
      <Lines x={78} y={90} widths={[54, 36, 62, 46]} gap={23} />
      <rect x="75" y="181" width="74" height="27" rx="4" fill={wash} />
      <path d="M86 194h48" stroke={blue} strokeWidth="4" strokeLinecap="round" />
    </Pane>
    <rect x="207" y="66" width="145" height="164" rx="3" fill="var(--card)" stroke={muted} />
    <path d="M225 87h73" stroke={blue} strokeWidth="6" strokeLinecap="round" />
    <Lines x={225} y={105} widths={[105, 84]} gap={12} />
    <rect x="224" y="133" width="111" height="68" rx="3" fill={wash} />
    {[28, 40, 32, 49].map((height, index) => <rect key={index} x={237 + index * 23} y={193 - height} width="13" height={height} rx="2" fill={blue} opacity={.5 + index * .15} />)}
    <path d="M225 215h65" stroke={muted} strokeWidth="3" strokeLinecap="round" />
    <path d="M188 79v134m177-134v134M195 59h164m-164 178h164" stroke={blue} strokeDasharray="3 5" opacity=".45" />
  </>;
}

function Forms() {
  return <>
    <Pane x={64} y={72} width={108} height={150}>
      {[83, 122, 161].map(y => <g key={y}>
        <rect x="75" y={y} width="86" height="29" rx="4" fill="var(--sidebar)" stroke="var(--border)" />
        <path d={`M85 ${y + 14}h8m-4-4v8m17-4h39`} stroke={y === 122 ? blue : muted} strokeWidth="3" strokeLinecap="round" />
      </g>)}
    </Pane>
    <Pane x={190} y={72} width={224} height={150}>
      <Lines x={208} y={91} widths={[82]} />
      {[105, 149].map(y => <g key={y}>
        <rect x="207" y={y} width="190" height="30" rx="4" fill="var(--sidebar)" stroke="var(--border)" />
        <path d={`M219 ${y + 15}h${y === 105 ? 96 : 64}`} stroke={muted} strokeWidth="4" strokeLinecap="round" />
      </g>)}
      <rect x="207" y="191" width="14" height="14" rx="3" fill={blue} />
      <path d="m210 198 3 3 5-6" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" />
      <path d="M230 198h66" stroke={muted} strokeWidth="4" strokeLinecap="round" />
    </Pane>
  </>;
}

function Terminology() {
  return <>
    <Pane x={64} y={72} width={134} height={150}>
      <path d="M89 98v95m0-65h16m-16 33h16m-16 32h16" stroke={muted} strokeWidth="2" />
      {[95, 128, 161, 194].map((y, index) => <g key={y}>
        <rect x={index === 0 ? 82 : 104} y={y - 5} width="12" height="10" rx="2" fill={index === 1 ? blue : muted} />
        <path d={`M${index === 0 ? 104 : 126} ${y}h${index === 0 ? 59 : 42}`} stroke={index === 1 ? blue : muted} strokeWidth="4" strokeLinecap="round" />
      </g>)}
    </Pane>
    <Pane x={212} y={72} width={202} height={150}>
      <rect x="226" y="86" width="174" height="25" rx="4" fill={wash} />
      <circle cx="240" cy="98" r="5" fill="none" stroke={blue} strokeWidth="2" /><path d="m244 102 4 4" stroke={blue} strokeWidth="2" />
      <path d="M261 99h89" stroke={blue} strokeWidth="4" strokeLinecap="round" />
      {[131, 163, 195].map(y => <g key={y}>
        <rect x="227" y={y - 7} width="26" height="14" rx="3" fill={wash} />
        <path d={`M267 ${y}h113`} stroke={muted} strokeWidth="4" strokeLinecap="round" />
      </g>)}
    </Pane>
  </>;
}

function Mapping() {
  return <>
    <Pane x={64} y={72} width={136} height={150} />
    <Pane x={278} y={72} width={136} height={150} />
    <Lines x={80} y={89} widths={[60]} /><Lines x={294} y={89} widths={[82]} />
    {[121, 160, 199].map((y, index) => <g key={y}>
      <rect x="77" y={y - 12} width="110" height="26" rx="4" fill={wash} />
      <rect x="291" y={y - 12} width="110" height="26" rx="4" fill={wash} />
      <path d={`M89 ${y}h${46 + index * 10}M304 ${y}h${50 - index * 5}`} stroke={blue} strokeWidth="4" strokeLinecap="round" />
      <path d={`M204 ${y}H270m-8-5 8 5-8 5`} fill="none" stroke={blue} strokeWidth="2.5" strokeLinejoin="round" />
    </g>)}
  </>;
}

function Workflows() {
  return <>
    <g fill="none" stroke={blue} strokeWidth="2.5" strokeLinecap="round">
      <path d="M110 147h42m42 0c20 0 20-44 44-44h29m-73 44c20 0 20 44 44 44h29M307 103c25 0 20 44 46 44m-46 44c25 0 20-44 46-44" />
    </g>
    {[[68, 127], [153, 127], [267, 83], [267, 171], [353, 127]].map(([x, y], index) => <g key={index}>
      <rect x={x} y={y} width="40" height="40" rx="9" fill="var(--card)" stroke={index === 0 ? blue : muted} strokeWidth="2" />
      <circle cx={x} cy={y + 20} r="3" fill={blue} /><circle cx={x + 40} cy={y + 20} r="3" fill={blue} />
    </g>)}
    <path d="m82 141 6-6 6 6-6 6Z M164 140h8v14h8m-8-7h8m98-53h18v18h-18Z" fill="none" stroke={blue} strokeWidth="2" strokeLinejoin="round" />
    <path d="m279 190 6 6 10-12m69-39 7 5-7 5m12 0h7" fill="none" stroke={blue} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </>;
}

const artwork = {
  dashboard: Dashboard,
  query: Query,
  'report-designer': Report,
  forms: Forms,
  terminology: Terminology,
  'national-codes': Mapping,
  workflows: Workflows,
} satisfies Record<ProductVideo['name'], () => ReactNode>;

/** Custom vector cover art. Theme colours come from the page, independently of video playback. */
export function VideoThumbnail({ item }: { item: ProductVideo }) {
  const id = useId().replace(/:/g, '');
  const Art = artwork[item.name];
  return (
    <svg viewBox="0 0 480 270" role="img" aria-label={item.description} className="block aspect-video w-full" data-video-thumbnail={item.name}>
      <defs>
        <pattern id={`${id}-dots`} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="1" fill={muted} />
        </pattern>
        <radialGradient id={`${id}-fade`}>
          <stop offset=".5" stopColor="white" /><stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}><rect width="480" height="270" fill={`url(#${id}-fade)`} /></mask>
      </defs>
      <rect width="480" height="270" fill="var(--sidebar)" />
      <rect width="480" height="270" fill={`url(#${id}-dots)`} mask={`url(#${id}-mask)`} />
      <rect x="41" y="34" width="398" height="209" rx="10" fill="var(--text)" opacity=".04" />
      <rect x="40" y="28" width="400" height="210" rx="9" fill="var(--bg)" stroke="var(--border-2)" />
      <path d="M40 58h400" stroke="var(--border)" />
      <g fill={muted}>{[55, 66, 77].map(x => <circle key={x} cx={x} cy="43" r="2.5" />)}</g>
      <Art />
    </svg>
  );
}
