import { useState, useEffect } from 'react';
import { get, post } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Tabs, Field, MoneyInput, ErrorBox, Loading, Empty } from '../ui.jsx';
import { LineChart, COLORS } from '../charts.jsx';
import { brl, monthShort } from '../fmt.js';
import { Simulator, PurchaseForm } from './Cards.jsx';

function Invest() {
  const { nav } = useApp();
  const [s, setS] = useState({ lump: 0, monthly: 0, months: 12, rate: 0 });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    const t = setTimeout(() => post('/api/invest/simulate', { lump: s.lump, monthly: s.monthly, months: s.months, annual_rate_pct: s.rate }).then((r) => { setRes(r); setErr(''); }).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [s.lump, s.monthly, s.months, s.rate]);
  const verdict = res && { pode: ['ok', 'Cabe no seu orçamento'], atencao: ['warn', 'Cabe, mas aperta: fica abaixo da reserva mínima'], nao: ['danger', 'Não cabe: o saldo ficaria negativo'] }[res.verdict];
  const empty = !s.lump && !s.monthly;
  return (
    <div className="stack">
      <Card title="Quero investir...">
        <div className="filters">
          <Field label="Um valor agora"><MoneyInput value={s.lump} onChange={(v) => set('lump', v)} /></Field>
          <Field label="E/ou por mês"><MoneyInput value={s.monthly} onChange={(v) => set('monthly', v)} /></Field>
          <Field label="Por quantos meses"><input type="number" min="1" max="600" value={s.months} onChange={(e) => set('months', Math.max(1, Number(e.target.value) || 1))} style={{ width: 90 }} /></Field>
          <Field label="Rendimento ao ano % (opcional)"><input type="number" min="0" max="100" step="0.1" value={s.rate} onChange={(e) => set('rate', Number(e.target.value) || 0)} style={{ width: 120 }} /></Field>
        </div>
        <p className="muted">O rendimento é só uma hipótese sua; deixe 0 para ver apenas a soma dos aportes.</p>
        <ErrorBox error={err} />
      </Card>
      {res && (
        <>
          {res.missing.length > 0 && <div className="alert warn">Resultado incompleto: {res.missing.join(' ')}</div>}
          <div className="grid-stats">
            <Stat label="Livre para gastar hoje" value={brl(res.available)} />
            <Stat label="Posso tirar agora com segurança" value={brl(res.safeNow)} tone="pos" sub="Já considera contas, cartões e reserva mínima" />
            <Stat label="Maior aporte mensal seguro" value={brl(res.maxMonthly)} tone="pos" sub="Sem ficar abaixo da reserva mínima" />
            {!empty && <Stat label={`Total investido em ${s.months} meses`} value={brl(res.invested)} sub={`Valor futuro: ${brl(res.futureValue)}`} />}
          </div>
          {!empty && (
            <div className={`alert ${verdict[0]}`}><strong>{verdict[1]}.</strong>{res.reasons.length > 0 && <ul>{res.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}</div>
          )}
          {!empty && (
            <Card title="Como fica o seu dinheiro livre mês a mês">
              <LineChart labels={res.plan.months.map((m) => monthShort(m.month))} lines={[
                { name: 'Sem investir', color: COLORS.slate, values: res.baseline.months.map((m) => m.closingFree) },
                { name: 'Investindo', color: COLORS.green, values: res.plan.months.map((m) => m.closingFree) },
              ]} />
              <ul className="muted" style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>{res.plan.premises.map((p) => <li key={p}>{p}</li>)}</ul>
            </Card>
          )}
          <p className="muted">{res.note}</p>
          {!empty && <div><button className="btn" onClick={() => nav('reservas')}>Registrar em Reservas e investimentos</button></div>}
        </>
      )}
    </div>
  );
}

export default function Simulators() {
  const { params, nav } = useApp();
  const [tab, setTab] = useState(params.tab || 'invest');
  const [buy, setBuy] = useState(null);
  const { data: ov, error } = useFetch(() => get('/api/cards'), []);
  if (error) return <ErrorBox error={error} />;
  if (!ov) return <Loading />;
  return (
    <div>
      <PageHead title="Simuladores" sub="Teste antes de decidir. Nada aqui altera seus dados." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'invest', label: 'Posso investir?' }, { value: 'compra', label: 'Compra parcelada' }]} />
      {tab === 'invest' ? <Invest /> : ov.cards.length === 0 ? (
        <Card><Empty action={<button className="btn primary" onClick={() => nav('cartoes')}>Cadastrar cartão</button>}>Para simular uma compra parcelada, cadastre antes o seu cartão (e o que você já paga nele).</Empty></Card>
      ) : <Simulator cards={ov.cards} onConfirm={(p) => setBuy(p)} initial={params.preset} />}
      {buy && <PurchaseForm cards={ov.cards} preset={buy} onClose={() => setBuy(null)} />}
    </div>
  );
}
