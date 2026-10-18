import { useState } from 'react';
import { get, post } from '../api.js';
import { useApp, useFetch, Card, PageHead, Badge, Empty, ErrorBox, Loading, FormModal, useForm, Txt, Money, Sel, accountOptions, MoneyInput, Field, RISK } from '../ui.jsx';
import { brl, dateBR } from '../fmt.js';

function Scenario({ s, onUse }) {
  const [open, setOpen] = useState(false);
  const [tone, label] = RISK[s.risk.level];
  return (
    <Card className="scenario">
      <div className="card-head"><h3>{s.label}</h3><Badge tone={tone}>{label}</Badge></div>
      <div className="muted">{s.description}</div>
      <div><div className="muted">Retirada sugerida</div><div className="big">{brl(s.suggested)}</div></div>
      <div>
        <div className="kv"><span>Saldo restante ao fim do período</span><span>{brl(s.remaining)}</span></div>
        <div className="kv"><span>Despesas previstas no período</span><span>{brl(s.expectedExpenses)}</span></div>
        <div className="kv"><span>Receitas confirmadas consideradas</span><span>{brl(s.confirmedIncome)}</span></div>
        <div className="kv"><span>Receitas incertas (não contadas)</span><span>{brl(s.uncertainIncome)}</span></div>
        <div className="kv"><span>Preservado (reservas + segurança + economia)</span><span>{brl(s.preserved.total)}</span></div>
        <div className="kv"><span>Menor saldo no período</span><span className={s.minBalance < 0 ? 'neg' : ''}>{brl(s.minBalance)}</span></div>
      </div>
      <div className="muted">{s.risk.reason}</div>
      <div className="muted"><strong>Metas:</strong> {s.goalsImpact}</div>
      {s.uncovered.length > 0 && <div className="alert danger">Contas sem cobertura: {s.uncovered.map((u) => `${u.label} (${brl(u.amount)})`).join(', ')}</div>}
      <div className="actions">
        <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Ocultar cálculo' : 'Ver cálculo detalhado'}</button>
        <button className="btn sm primary" disabled={s.suggested <= 0} onClick={() => onUse(s.suggested, s.key)}>Simular este valor</button>
      </div>
      {open && (
        <div className="explain">
          {s.explanation.map((r, i) => (
            <div key={i} className={`row ${i === s.explanation.length - 1 ? 'total' : ''}`}><span>{r.label}</span><span className="num">{brl(r.value)}</span>{r.note && <small>{r.note}</small>}</div>
          ))}
          {s.items.length > 0 && <>
            <h3 style={{ margin: '12px 0 6px' }}>Compromissos considerados</h3>
            {s.items.map((it, i) => <div key={i} className="kv"><span>{it.label} · {dateBR(it.due)}{it.kind === 'overdue' ? ' (vencida)' : ''}</span><span>{brl(it.amount)}</span></div>)}
          </>}
        </div>
      )}
    </Card>
  );
}

function ConfirmWithdrawal({ amount, sim, onClose }) {
  const { accounts, today, refresh, notify } = useApp();
  const f = useForm({ account_id: accounts.find((a) => a.spendable && !a.archived)?.id || '', date: today, amount, note: 'Retirada pessoal' });
  return (
    <FormModal title="Registrar retirada efetiva" onClose={onClose} submitLabel="Confirmar e registrar" danger={sim?.risk.level === 'alto'}
      onSubmit={async () => { await post('/api/withdrawal/confirm', f.v); notify('Retirada registrada; saldo atualizado.'); refresh(); }}>
      <div className="full alert">Isto cria uma <strong>saída real</strong> na conta escolhida e reduz o saldo. Não conta como despesa de categoria.</div>
      {sim && <div className={`full alert ${sim.risk.level === 'alto' ? 'danger' : sim.belowSafety ? 'warn' : 'ok'}`}>{sim.message}</div>}
      <Money f={f} name="amount" label="Valor" required />
      <Sel f={f} name="account_id" label="Conta de origem" options={accountOptions(accounts)} empty="Selecione…" required />
      <Txt f={f} name="date" type="date" label="Data" required />
      <Txt f={f} name="note" label="Descrição" maxLength={120} />
    </FormModal>
  );
}

export default function Withdrawal() {
  const { settings, nav } = useApp();
  const [horizon, setHorizon] = useState(Number(settings.withdrawal_horizon || 30));
  const { data: w, error } = useFetch(() => get('/api/withdrawal', { horizon }), [horizon]);
  const { data: hist } = useFetch(() => get('/api/withdrawal/history'), []);
  const [amount, setAmount] = useState(0);
  const [scenario, setScenario] = useState('equilibrado');
  const [sim, setSim] = useState(null);
  const [simErr, setSimErr] = useState('');
  const [confirmAmt, setConfirmAmt] = useState(null);

  const simulate = async (a = amount, sc = scenario) => {
    setSimErr(''); setSim(null);
    try { setSim(await post('/api/withdrawal/simulate', { amount: a, horizon, scenario: sc })); } catch (e) { setSimErr(e.message); }
  };
  const use = (v, sc) => { setAmount(v); setScenario(sc); simulate(v, sc); };
  if (error) return <ErrorBox error={error} />;
  if (!w) return <Loading />;
  return (
    <div className="stack">
      <PageHead title="Calculadora de retirada pessoal" sub="Quanto posso retirar sem comprometer contas, reservas e metas. Nada é registrado até você confirmar.">
        <Field label="Período de planejamento (dias)"><input type="number" min="7" max="365" value={horizon} onChange={(e) => setHorizon(Math.max(7, Number(e.target.value) || 30))} style={{ width: 110 }} /></Field>
      </PageHead>
      {w.incomplete && (
        <div className="alert warn"><strong>Estimativa incompleta.</strong> Para um resultado confiável, cadastre:
          <ul>{w.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      <div className="grid-stats">
        <Card><div className="muted">Disponível hoje (já descontadas as reservas)</div><div className="stat-value">{brl(w.available)}</div><div className="muted">Saldo gastável {brl(w.spendable)} − reservado {brl(w.reserved)}</div></Card>
        <Card><div className="muted">Reserva mínima de segurança</div><div className="stat-value">{brl(w.minReserve)}</div><button className="link" onClick={() => nav('configuracoes')}>Alterar em Configurações</button></Card>
        <Card><div className="muted">Período analisado</div><div className="stat-value">{horizon} dias</div><div className="muted">Até {dateBR(w.horizonEnd)}</div></Card>
      </div>
      <div className="cols-3">{Object.values(w.scenarios).map((s) => <Scenario key={s.key} s={s} onUse={use} />)}</div>

      <Card title="Simular uma retirada">
        <div className="filters">
          <Field label="Valor a retirar"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Cenário de referência"><select value={scenario} onChange={(e) => setScenario(e.target.value)}>{Object.values(w.scenarios).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!amount} onClick={() => simulate()}>Simular</button>
        </div>
        <ErrorBox error={simErr} />
        {sim && (
          <div className="stack">
            <div className={`alert ${sim.risk.level === 'alto' ? 'danger' : sim.belowSafety ? 'warn' : 'ok'}`}>
              {sim.message} {sim.exceedsAvailable && 'O valor é maior que o disponível hoje.'}
            </div>
            <div className="cols-3" style={{ marginBottom: 0 }}>
              <div className="kv"><span>Disponível antes</span><span>{brl(sim.availableBefore)}</span></div>
              <div className="kv"><span>Saldo ao fim do período</span><span className={sim.remaining < 0 ? 'neg' : ''}>{brl(sim.remaining)}</span></div>
              <div className="kv"><span>Menor saldo no período</span><span className={sim.minBalance < 0 ? 'neg' : ''}>{brl(sim.minBalance)}</span></div>
            </div>
            <div className="muted">{RISK[sim.risk.level][1]}: {sim.risk.reason}</div>
            {sim.uncovered.length > 0 && <div className="alert danger">Ficariam sem cobertura: {sim.uncovered.map((u) => `${u.label} (${brl(u.amount)})`).join(', ')}</div>}
            <div><button className="btn" onClick={() => setConfirmAmt(amount)}>Registrar esta retirada…</button></div>
          </div>
        )}
      </Card>

      <Card title="Retiradas registradas">
        {!hist || hist.length === 0 ? <Empty>Nenhuma retirada registrada.</Empty> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th className="num">Valor</th></tr></thead>
            <tbody>{hist.map((h) => <tr key={h.id}><td>{dateBR(h.date)}</td><td>{h.account_name}</td><td>{h.description}</td><td className="num">{brl(-h.amount)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      {confirmAmt != null && <ConfirmWithdrawal amount={confirmAmt} sim={sim} onClose={() => setConfirmAmt(null)} />}
    </div>
  );
}
