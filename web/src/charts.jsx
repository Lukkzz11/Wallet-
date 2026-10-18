import { brl, monthShort } from './fmt.js';

const GREEN = '#34d399', SLATE = '#64748b', RED = '#fb7185', INK = '#e2e8f0', GRID = 'rgba(100,116,139,.28)';

function niceMax(v) {
  if (v <= 0) return 10000;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const short = (c) => {
  const v = Math.abs(c) / 100;
  const s = v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v)}`;
  return (c < 0 ? '-' : '') + s;
};

// Barras agrupadas. data: [{label, values:[n,...]}], series: [{name,color}]
export function BarChart({ data, series, height = 220 }) {
  const W = 640, H = height, L = 46, B = 26, T = 8, R = 8;
  const all = data.flatMap((d) => d.values);
  const max = niceMax(Math.max(0, ...all)), min = Math.min(0, ...all);
  const lo = min < 0 ? -niceMax(-min) : 0;
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (max - lo));
  const gw = (W - L - R) / Math.max(1, data.length);
  const bw = Math.min(28, (gw * 0.7) / series.length);
  const ticks = [lo, ...(lo < 0 ? [0] : []), max / 2, max].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
        {ticks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="tick">{short(t)}</text></g>
        ))}
        {data.map((d, i) => {
          const cx = L + gw * i + gw / 2;
          return (
            <g key={d.label}>
              {d.values.map((v, j) => {
                const x = cx - (bw * series.length) / 2 + j * bw;
                const y0 = y(0), y1 = y(v);
                return <rect key={j} x={x} y={Math.min(y0, y1)} width={bw - 2} height={Math.max(1, Math.abs(y0 - y1))} rx="2" fill={series[j].color}><title>{`${series[j].name} · ${d.label}: ${brl(v)}`}</title></rect>;
              })}
              <text x={cx} y={H - 8} textAnchor="middle" className="tick">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </div>
  );
}

// Linhas. labels: [...], lines: [{name,color,values}]
export function LineChart({ labels, lines, height = 220, zero = true }) {
  const W = 640, H = height, L = 46, B = 26, T = 8, R = 12;
  const all = lines.flatMap((l) => l.values);
  let hi = Math.max(...all, zero ? 0 : -Infinity), lo = Math.min(...all, zero ? 0 : Infinity);
  if (hi === lo) { hi += 10000; lo -= 10000; }
  const pad = (hi - lo) * 0.08;
  hi += pad; if (lo < 0 || !zero) lo -= pad;
  const x = (i) => L + ((W - L - R) * i) / Math.max(1, labels.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
        {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="tick">{short(t)}</text></g>)}
        {lo < 0 && hi > 0 && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={SLATE} strokeDasharray="3 3" />}
        {lines.map((l) => (
          <g key={l.name}>
            <polyline fill="none" stroke={l.color} strokeWidth="2" points={l.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {l.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="#0f172a" stroke={l.color} strokeWidth="1.5"><title>{`${l.name} · ${labels[i]}: ${brl(v)}`}</title></circle>)}
          </g>
        ))}
        {labels.map((lb, i) => (labels.length <= 8 || i % 2 === 0) && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="tick">{lb}</text>)}
      </svg>
      <Legend series={lines} />
    </div>
  );
}

export function Legend({ series }) {
  return <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

// Barras horizontais (ranking), HTML puro.
export function HBars({ items, color = SLATE, total }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = total ?? items.reduce((t, i) => t + i.value, 0);
  return (
    <div className="hbars">
      {items.map((i) => (
        <div key={i.name} className="hbar" title={`${i.name}: ${brl(i.value)}`}>
          <span className="hb-name">{i.name}</span>
          <div className="hb-track"><div style={{ width: `${(i.value / max) * 100}%`, background: color }} /></div>
          <span className="hb-val">{brl(i.value)}{sum ? <em>{Math.round((i.value / sum) * 100)}%</em> : null}</span>
        </div>
      ))}
    </div>
  );
}

export const monthLabels = (rows) => rows.map((r) => monthShort(r.month));
export const COLORS = { green: GREEN, slate: SLATE, red: RED, ink: INK };
