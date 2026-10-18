import { useState } from 'react';
import { get } from '../api.js';
import { useApp, useFetch, Card, PageHead, Empty, ErrorBox, Loading, Field } from '../ui.jsx';
import { brl, dateBR, monthShort, toCsv, download, monthEnd, addMonthKey } from '../fmt.js';

const TYPES = [
  ['income', 'Receitas'], ['expenses', 'Despesas'], ['subscriptions', 'Assinaturas'], ['debts', 'Dívidas'],
  ['patrimony', 'Patrimônio e reservas'], ['cashflow', 'Fluxo de caixa'], ['evolution', 'Evolução financeira'], ['goals', 'Metas'],
];
const NEEDS_FILTER = ['income', 'expenses'];

function defaultRange(today, period) {
  const k = today.slice(0, 7);
  if (period === 'year') return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
  if (period === 'quarter') return [`${addMonthKey(k, -2)}-01`, monthEnd(k)];
  return [`${k}-01`, monthEnd(k)];
}
const cell = (c, v) => (v == null || v === '' ? '—' : c.type === 'money' ? brl(v) : c.type === 'date' ? dateBR(v) : c.type === 'month' ? monthShort(v) : c.type === 'percent' ? `${String(v).replace('.', ',')}%` : v);

export default function Reports() {
  const { today, settings, accounts, categories } = useApp();
  const [type, setType] = useState('expenses');
  const [range, setRange] = useState(defaultRange(today, settings.default_report_period));
  const [category, setCategory] = useState('');
  const [account, setAccount] = useState('');
  const useRange = !['patrimony', 'subscriptions', 'debts', 'goals'].includes(type);
  const catKind = type === 'income' ? 'income' : 'expense';
  const { data: r, error } = useFetch(() => get(`/api/reports/${type}`, { from: useRange ? range[0] : '', to: useRange ? range[1] : '', category_id: NEEDS_FILTER.includes(type) ? category : '', account_id: NEEDS_FILTER.includes(type) ? account : '' }), [type, range, category, account]);
  const exportCsv = () => download(`WalletLucas_${type}_${today}.csv`, toCsv(r.columns, r.rows));
  return (
    <div className="stack">
      <PageHead title="Relatórios" sub="Gere por período, categoria e conta. Exporte em CSV ou salve como PDF.">
        <button className="btn" disabled={!r || !r.rows.length} onClick={exportCsv}>Exportar CSV</button>
        <button className="btn primary" disabled={!r} onClick={() => window.print()}>Gerar PDF / imprimir</button>
      </PageHead>
      <div className="filters no-print">
        <select value={type} onChange={(e) => { setType(e.target.value); setCategory(''); }} aria-label="Relatório">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {useRange && <>
          <Field label="De"><input type="date" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} /></Field>
          <Field label="Até"><input type="date" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} /></Field>
        </>}
        {NEEDS_FILTER.includes(type) && <>
          <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Todas as categorias</option>{categories.filter((c) => c.kind === catKind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Todas as contas</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </>}
      </div>
      <ErrorBox error={error} />
      {!r ? <Loading /> : (
        <Card title={r.title}>
          <p className="print-only muted" style={{ marginBottom: 8 }}>Wallet · gerado em {dateBR(today)}{useRange && ` · período ${dateBR(range[0])} a ${dateBR(range[1])}`}</p>
          {r.rows.length === 0 ? <Empty>Nenhum dado para este relatório e período.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr>{r.columns.map((c) => <th key={c.key} className={c.type === 'money' || c.type === 'percent' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{r.rows.map((row, i) => <tr key={i}>{r.columns.map((c) => <td key={c.key} className={c.type === 'money' || c.type === 'percent' ? 'num' : ''}>{cell(c, row[c.key])}</td>)}</tr>)}</tbody>
            </table></div>
          )}
          {r.totals.length > 0 && <div style={{ marginTop: 12 }}>{r.totals.map((t) => <div key={t.label} className="kv"><span>{t.label}</span><strong>{brl(t.value)}</strong></div>)}</div>}
        </Card>
      )}
    </div>
  );
}
