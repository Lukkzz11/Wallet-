import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { brl, parseMoneyDigits } from './fmt.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

/* ---------- carregamento de dados ---------- */
export function useFetch(fn, deps = []) {
  const { version } = useApp();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: null, error: error.message, loading: false }),
    );
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}

/* ---------- elementos básicos ---------- */
export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title} initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </motion.div>
    </motion.div>
  );
}

export function useConfirm() {
  const { confirm } = useApp();
  return confirm;
}

export function Badge({ tone = 'neutral', children }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Card({ title, action, children, className = '' }) {
  return (
    <motion.section className={`card ${className}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
      {(title || action) && <div className="card-head"><h3>{title}</h3>{action}</div>}
      {children}
    </motion.section>
  );
}
export function Stat({ label, value, sub, tone, onClick, hint }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`stat${onClick ? ' clickable' : ''}`} onClick={onClick} title={hint}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone || ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </Tag>
  );
}
// Card grande do painel: ícone, rótulo, valor em destaque e detalhe. color = cor de destaque (CSS).
export function Kpi({ label, value, sub, icon: Icon, color, onClick, index = 0, tone }) {
  return (
    <motion.button type="button" className="kpi" style={{ '--k': color }} onClick={onClick}
      initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: [0.2, 0.8, 0.2, 1] }}>
      <span className="kpi-top"><span className="kpi-label">{label}</span>{Icon && <span className="kpi-icon"><Icon size={18} strokeWidth={2} /></span>}</span>
      <span className={`kpi-value ${tone || ''}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </motion.button>
  );
}
export function Progress({ pct, tone }) {
  return <div className="progress"><div className={tone || ''} style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%` }} /></div>;
}
export function Empty({ children, action }) { return <div className="empty"><p>{children}</p>{action}</div>; }
export function ErrorBox({ error }) { return error ? <div className="alert danger">{error}</div> : null; }
export function Loading() { return <div className="muted pad">Carregando…</div>; }
export function PageHead({ title, sub, children }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div><div className="actions">{children}</div></div>;
}
export function Tabs({ value, onChange, items }) {
  return <div className="tabs">{items.map((t) => <button key={t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>{t.label}</button>)}</div>;
}

/* ---------- formulários ---------- */
export function useForm(init) {
  const [v, setV] = useState(init);
  const set = useCallback((k, val) => setV((p) => ({ ...p, [k]: val })), []);
  return { v, set, setV };
}
export function Field({ label, hint, children, className = '' }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function MoneyInput({ value, onChange, ...rest }) {
  const text = value ? (value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  return <input inputMode="numeric" placeholder="0,00" value={text} onChange={(e) => onChange(parseMoneyDigits(e.target.value))} {...rest} />;
}
export const Txt = ({ f, name, label, hint, className, type = 'text', ...r }) => (
  <Field label={label} hint={hint} className={className}><input type={type} value={f.v[name] ?? ''} onChange={(e) => f.set(name, e.target.value)} {...r} /></Field>
);
export const Num = ({ f, name, label, hint, className, ...r }) => (
  <Field label={label} hint={hint} className={className}><input type="number" value={f.v[name] ?? ''} onChange={(e) => f.set(name, e.target.value)} {...r} /></Field>
);
export const Money = ({ f, name, label, hint, className, ...r }) => (
  <Field label={label} hint={hint} className={className}><MoneyInput value={f.v[name]} onChange={(x) => f.set(name, x)} {...r} /></Field>
);
export const Area = ({ f, name, label }) => (
  <Field label={label} className="full"><textarea rows={2} value={f.v[name] ?? ''} onChange={(e) => f.set(name, e.target.value)} /></Field>
);
export const Sel = ({ f, name, label, options, empty, hint, className, ...r }) => (
  <Field label={label} hint={hint} className={className}>
    <select value={f.v[name] ?? ''} onChange={(e) => f.set(name, e.target.value)} {...r}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </Field>
);
export const Chk = ({ f, name, label, hint }) => (
  <label className="check full"><input type="checkbox" checked={!!f.v[name]} onChange={(e) => f.set(name, e.target.checked)} /><span>{label}{hint && <small>{hint}</small>}</span></label>
);
export const accountOptions = (accounts, includeArchived = false) => accounts.filter((a) => a.type !== 'fgts' && (includeArchived || !a.archived)).map((a) => ({ value: a.id, label: `${a.name} (${brl(a.balance)})` }));
export const categoryOptions = (cats, kind) => cats.filter((c) => c.kind === kind).map((c) => ({ value: c.id, label: c.name }));

// Modal de formulário com envio, erro e bloqueio de duplo clique.
// inline: mostra o formulário na própria página (sem janela); onClose é chamado após salvar para a página reiniciar o formulário.
export function FormModal({ title, onClose, onSubmit, children, submitLabel = 'Salvar', wide, danger, inline }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try { await onSubmit(); setBusy(false); onClose(); } catch (x) { setErr(x.message); setBusy(false); }
  };
  const form = (
    <form onSubmit={submit} className="form">
      <div className="grid">{children}</div>
      {err && <div className="alert danger" style={{ marginTop: 10 }}>{err}</div>}
      <div className="form-actions">
        {!inline && <button type="button" className="btn" onClick={onClose}>Cancelar</button>}
        <button type="submit" className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy}>{busy ? 'Salvando…' : submitLabel}</button>
      </div>
    </form>
  );
  if (inline) return <Card title={title}>{form}</Card>;
  return <Modal title={title} onClose={onClose} wide={wide}>{form}</Modal>;
}

export function MonthPicker({ value, onChange }) {
  return (
    <div className="month-picker">
      <button className="btn sm" onClick={() => onChange(shift(value, -1))} aria-label="Mês anterior">‹</button>
      <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button className="btn sm" onClick={() => onChange(shift(value, 1))} aria-label="Próximo mês">›</button>
    </div>
  );
}
function shift(k, n) {
  const [y, m] = k.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export const STATUS_TONE = { paid: 'ok', pending: 'neutral', overdue: 'danger' };
export function StatusBadge({ status, income }) {
  const label = { paid: income ? 'Recebida' : 'Paga', pending: income ? 'Prevista' : 'Pendente', overdue: 'Atrasada' }[status];
  return <Badge tone={STATUS_TONE[status]}>{label}</Badge>;
}
export const RISK = { baixo: ['ok', 'Risco baixo'], medio: ['warn', 'Risco médio'], alto: ['danger', 'Risco alto'] };

