import { useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { useApp, useFetch, Card, Stat, PageHead, Field, MoneyInput, ErrorBox, Badge, Empty, Modal } from '../ui.jsx';
import { brl, monthShort } from '../fmt.js';

const EMPTY = { name: '', image: '', price: 0, count: 1, installment: 0, interest: '' };
const cardLabel = (c) => `${c.bank || c.name}${c.bank && c.name !== c.bank ? ` — ${c.name}` : ''}`;

export default function NewPurchase() {
  const { nav, accounts, categories, today, refresh, notify } = useApp();
  const { data: cardsOv } = useFetch(() => get('/api/cards'), []);
  const cards = cardsOv?.cards || [];
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null); // resposta da análise (ou null se for manual)
  const [form, setForm] = useState(null);     // prévia editável
  const [mode, setMode] = useState('card');   // 'cash' | 'card'
  const [cardId, setCardId] = useState('');
  const [confirmCash, setConfirmCash] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const analyze = async (browser = false) => {
    setBusy(true); setErr('');
    try {
      const r = await post('/api/product/analyze', { url, browser });
      setResult(r);
      const p = r.product;
      setForm({
        name: p.name || '', image: p.image || '', price: p.price_cash || 0,
        count: p.installments?.count || 1, installment: p.installments?.value || 0, interest: p.installments?.interest || '',
      });
    } catch (x) { setErr(x.message); setResult(null); setForm(null); }
    setBusy(false);
  };
  const manual = () => { setResult(null); setErr(''); setForm({ ...EMPTY }); };

  const n = Number(form?.count) || 1;
  const parcelTotal = form ? form.installment * n : 0;
  const hasParcel = form && n >= 2 && form.installment > 0;
  const extra = hasParcel && form.price > 0 ? parcelTotal - form.price : null;
  const cid = Number(cardId) || cards[0]?.id;

  const simulate = () => {
    const withInterest = form.interest === 'com juros' || (extra != null && extra > Math.max(100, form.price * 0.005));
    nav('simuladores', { tab: 'compra', preset: { card_id: cid, total: hasParcel ? parcelTotal : form.price, installments: hasParcel ? n : 1, installment_amount: withInterest && hasParcel ? form.installment : 0 } });
  };
  const registerCash = async (b) => {
    try {
      await post('/api/expenses/list', { description: form.name || 'Compra', amount: form.price, due_date: b.date, status: 'paid', paid_date: b.date, account_id: b.account_id, category_id: b.category_id || null, nature: 'avista', notes: url || null });
      notify('Compra à vista registrada; saldo atualizado.'); setConfirmCash(false); setForm(null); setResult(null); setUrl(''); refresh();
    } catch (x) { notify(x.message, true); }
  };

  return (
    <div className="stack">
      <PageHead title="Compra nova" sub="Cole o link do produto para ler o preço e as parcelas. Nada é gravado até você confirmar, e só valores que a página realmente informa são preenchidos." />
      <Card title="Link do produto">
        <div className="filters" style={{ marginBottom: 6 }}>
          <input type="url" style={{ flex: 1, minWidth: 280 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.loja.com.br/produto..." onKeyDown={(e) => e.key === 'Enter' && url && analyze()} />
          <button className="btn primary" disabled={busy || !url.trim()} onClick={() => analyze()}>{busy ? 'Analisando…' : 'Analisar produto'}</button>
          <button className="btn" onClick={manual}>Preencher manualmente</button>
        </div>
        <p className="muted">A análise roda no seu computador: o Wallet baixa a página, lê os metadados e os dados estruturados e não usa serviços pagos. Links para endereços locais ou de rede privada são bloqueados.</p>
        <ErrorBox error={err} />
      </Card>

      {result && (
        <Card title="O que foi encontrado">
          <div className="alert-list">
            {result.blocked && <div className="item overdue"><span>A loja parece bloquear a leitura automática.</span></div>}
            <div className="item" style={{ borderLeftColor: result.product.name ? 'var(--green)' : undefined }}><span>Nome</span><span style={{ textAlign: 'right' }}>{result.product.name ? <><strong>{result.product.name.length > 80 ? `${result.product.name.slice(0, 80)}…` : result.product.name}</strong> <Badge tone="ok">{result.product.sources.name || 'página'}</Badge></> : <Badge tone="warn">não encontrado</Badge>}</span></div>
            <div className="item" style={{ borderLeftColor: result.product.price_cash ? (result.product.price_confidence === 'estimado' ? 'var(--amber)' : 'var(--green)') : undefined }}><span>Preço à vista</span><span style={{ textAlign: 'right' }}>{result.product.price_cash ? <><strong style={{ fontSize: 18 }}>{brl(result.product.price_cash)}</strong> <Badge tone={result.product.price_confidence === 'estimado' ? 'warn' : 'ok'}>{result.product.price_confidence === 'estimado' ? 'estimado, confira' : 'exato'} · {result.product.sources.price_cash || 'página'}</Badge></> : <Badge tone="warn">não encontrado</Badge>}</span></div>
            <div className="item" style={{ borderLeftColor: result.product.installments ? 'var(--green)' : undefined }}><span>Parcelamento</span><span style={{ textAlign: 'right' }}>{result.product.installments ? <><strong>{result.product.installments.count}x de {brl(result.product.installments.value)}</strong> <Badge tone="ok">{result.product.installments.interest || 'juros não informados'}</Badge>{result.product.installments.extra_total > 0 && <span className="sub">total {brl(result.product.installments.count * result.product.installments.value)} · {brl(result.product.installments.extra_total)} a mais que o à vista</span>}</> : <Badge tone="warn">não encontrado</Badge>}</span></div>
            <div className="item" style={{ borderLeftColor: result.product.image ? 'var(--green)' : undefined }}><span>Imagem</span><span>{result.product.image ? <Badge tone="ok">encontrada · {result.product.sources.image || 'página'}</Badge> : <Badge tone="warn">não encontrada</Badge>}</span></div>
          </div>
          {(result.product.price_confidence === 'estimado' || !result.product.price_cash) && (result.product.price_candidates || []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <span className="muted">Valores que a página mostra (clique no que for o preço à vista): </span>
              {result.product.price_candidates.map((c) => <button key={c.value} className={`btn sm${c.value === form?.price ? ' primary' : ''}`} style={{ marginRight: 6, marginTop: 4 }} onClick={() => set('price', c.value)}>{brl(c.value)}</button>)}
            </div>
          )}
          {result.notes.length > 0 && <ul className="muted" style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>{result.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
          {!result.product.price_cash && !result.used_browser && !result.blocked && <div style={{ marginTop: 10 }}><button className="btn" disabled={busy} onClick={() => analyze(true)}>Tentar com navegador local (lojas que montam o preço com JavaScript)</button></div>}
          {result.used_browser && <p className="muted" style={{ marginTop: 8 }}>Leitura feita com o navegador local, sem janela.</p>}
        </Card>
      )}

      {form && (
        <Card title="Prévia (edite o que precisar)">
          <div className="cols-2" style={{ marginBottom: 0, gridTemplateColumns: form.image ? '160px 1fr' : '1fr' }}>
            {form.image && <img src={form.image} alt="" referrerPolicy="no-referrer" style={{ width: 160, maxHeight: 160, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 8 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
            <div className="grid">
              <Field label="Nome do produto" className="full"><input value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Notebook" /></Field>
              <Field label="Preço à vista" hint={form.price ? undefined : 'Não informado'}><MoneyInput value={form.price} onChange={(v) => set('price', v)} /></Field>
              <Field label="Forma de pagamento"><select value={mode} onChange={(e) => setMode(e.target.value)}><option value="card">Parcelar em um cartão</option><option value="cash">Pagar à vista</option></select></Field>
              {mode === 'card' && <>
                <Field label="Cartão"><select value={cardId || cid || ''} onChange={(e) => setCardId(e.target.value)}>{cards.length === 0 && <option value="">Cadastre um cartão</option>}{cards.map((c) => <option key={c.id} value={c.id}>{cardLabel(c)}</option>)}</select></Field>
                <Field label="Quantidade de parcelas"><input type="number" min="1" max="48" value={form.count} onChange={(e) => set('count', e.target.value)} /></Field>
                <Field label="Valor de cada parcela" hint={form.installment ? undefined : 'Não informado: sem juros = preço ÷ parcelas'}><MoneyInput value={form.installment} onChange={(v) => set('installment', v)} /></Field>
                <Field label="Juros"><select value={form.interest} onChange={(e) => set('interest', e.target.value)}><option value="">Não informado</option><option value="sem juros">Sem juros</option><option value="com juros">Com juros</option></select></Field>
              </>}
            </div>
          </div>
          {mode === 'card' && (
            <div className={`alert${extra > 0 ? ' warn' : ''}`} style={{ marginTop: 12 }}>
              {hasParcel ? <>Parcelas somam <strong>{brl(parcelTotal)}</strong>{form.price > 0 && (extra > 0 ? <> — <strong>{brl(extra)}</strong> a mais que o preço à vista (diferença calculada pelos valores informados; pode ser juros ou encargos, a taxa não é conhecida)</> : extra < 0 ? <> — {brl(-extra)} a menos que o à vista</> : <> — igual ao preço à vista</>)}.</>
                : form.price > 0 && n >= 2 ? <>Sem o valor da parcela, a simulação usará {n}x de {brl(Math.round(form.price / n))} (preço ÷ parcelas, sem juros). Informe a parcela real se houver juros.</> : 'Informe a quantidade de parcelas e, se souber, o valor da parcela.'}
            </div>
          )}
          {form && (form.price > 0 || hasParcel) && <PurchaseSim form={form} mode={mode} cid={cid} n={n} hasParcel={hasParcel} parcelTotal={parcelTotal} extra={extra} />}
          <div className="actions" style={{ marginTop: 12 }}>
            {mode === 'card' ? (
              <button className="btn primary big" disabled={!cid || !(form.price > 0 || hasParcel) || n < 1} onClick={simulate}>Enviar ao simulador</button>
            ) : (
              <button className="btn primary big" disabled={!(form.price > 0) || !form.name.trim()} onClick={() => setConfirmCash(true)}>Registrar compra à vista…</button>
            )}
            <span className="muted">{mode === 'card' ? 'Nada é registrado: você confirma a compra dentro do simulador.' : 'Só será registrada depois da sua confirmação.'}</span>
          </div>
        </Card>
      )}
      {!form && !result && !busy && <Card><Empty>Cole o link de um produto e clique em "Analisar produto", ou preencha manualmente.</Empty></Card>}
      {confirmCash && <CashModal form={form} accounts={accounts} categories={categories} today={today} onClose={() => setConfirmCash(false)} onConfirm={registerCash} />}
    </div>
  );
}

function CashModal({ form, accounts, categories, today, onClose, onConfirm }) {
  const accs = accounts.filter((a) => !a.archived && a.type !== 'fgts');
  const [b, setB] = useState({ account_id: accs[0]?.id || '', date: today, category_id: '' });
  return (
    <Modal title="Confirmar compra à vista" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!b.account_id} onClick={() => onConfirm(b)}>Registrar e descontar do saldo</button></>}>
      <div className="alert" style={{ marginBottom: 12 }}><strong>{form.name}</strong> — {brl(form.price)}. Será registrada como despesa já paga e reduzirá o saldo da conta escolhida.</div>
      <div className="grid">
        <Field label="Conta"><select value={b.account_id} onChange={(e) => setB({ ...b, account_id: Number(e.target.value) })}>{accs.length === 0 && <option value="">Cadastre uma conta</option>}{accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Data"><input type="date" value={b.date} onChange={(e) => setB({ ...b, date: e.target.value })} /></Field>
        <Field label="Categoria" className="full"><select value={b.category_id} onChange={(e) => setB({ ...b, category_id: e.target.value })}><option value="">Sem categoria</option>{categories.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

// Simulação da compra: mostra, sem gravar nada, o que acontece com parcelas, limite, saldo e faturas dos próximos meses.
function PurchaseSim({ form, mode, cid, n, hasParcel, parcelTotal, extra }) {
  const { data: dash } = useFetch(() => get('/api/dashboard'), []);
  const [sim, setSim] = useState(null);
  const [err, setErr] = useState('');
  const interest = form.interest === 'com juros' || (extra != null && extra > Math.max(100, form.price * 0.005));
  // base da comparação = preço à vista (as outras quantidades são mostradas sem juros); a parcela informada vale só para a quantidade escolhida
  const total = form.price > 0 ? form.price : parcelTotal;
  const count = mode === 'card' ? (hasParcel ? n : Math.max(1, n)) : 1;
  const fixed = mode === 'card' && interest && hasParcel ? form.installment : 0;
  useEffect(() => {
    if (mode !== 'card' || !cid || !(total > 0)) { setSim(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      post('/api/cards/simulate', { card_id: cid, total, installments: count, installment_amount: fixed || null, show_all: true })
        .then((r) => { if (alive) { setSim(r); setErr(''); } })
        .catch((x) => { if (alive) { setErr(x.message); setSim(null); } });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [mode, cid, total, count, fixed]);

  const available = dash?.available;
  const income30 = dash?.income30 || 0;
  const cashAfter = available != null ? available - form.price : null;
  const parcel = sim?.installment || 0;
  const rows = sim ? sim.rows.filter((r) => r.month >= sim.firstMonth && r.month <= sim.lastMonth).slice(0, 12) : [];
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      <h3 style={{ margin: 0 }}>Simulação da compra</h3>
      <ErrorBox error={err} />
      {mode === 'card' && sim && (
        <>
          <div className="grid-stats">
            <Stat label="Parcela mensal" value={brl(parcel)} sub={`${sim.n}x · primeira em ${monthShort(sim.firstMonth)} · última em ${monthShort(sim.lastMonth)}`} />
            <Stat label="Total a pagar" value={brl(sim.totalPaid)} sub={form.price > 0 ? (sim.totalPaid > form.price ? `${brl(sim.totalPaid - form.price)} a mais que o à vista` : sim.totalPaid < form.price ? `${brl(form.price - sim.totalPaid)} a menos que o à vista` : 'igual ao preço à vista') : 'sem preço à vista para comparar'} tone={form.price > 0 && sim.totalPaid > form.price ? 'neg' : ''} />
            <Stat label={`Faturas em ${monthShort(sim.firstMonth)}`} value={brl(sim.allFirstMonth)} sub={`Antes da compra: ${brl(sim.allBeforeFirstMonth)}`} />
            <Stat label="Maior mês de faturas" value={brl(sim.allPeak)} sub="Soma de todos os cartões durante o parcelamento" />
          </div>
          {sim.limit.limit > 0 && (
            <div className={`alert ${sim.limit.exceeds ? 'danger' : 'ok'}`}>Limite disponível no {sim.card.name}: <strong>{brl(sim.limit.available)}</strong> → <strong>{brl(sim.limit.availableAfter)}</strong> depois desta compra.{sim.limit.exceeds && ' A compra passa do limite disponível.'}</div>
          )}
          {income30 > 0 && parcel > 0 && <div className="alert">Cada parcela equivale a <strong>{Math.round((parcel / income30) * 100)}%</strong> do que você tem a receber com certeza nos próximos 30 dias ({brl(income30)}).</div>}
          {rows.length > 0 && (
            <div>
              <h3 style={{ margin: '4px 0 8px' }}>Impacto nas faturas dos cartões</h3>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Mês</th><th className="num">Faturas sem a compra</th><th className="num">Com a compra</th><th className="num">Diferença</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.month}><td>{monthShort(r.month)}</td><td className="num">{brl(r.allBefore)}</td><td className="num"><strong>{brl(r.allAfter)}</strong></td><td className="num neg">+{brl(r.allAfter - r.allBefore)}</td></tr>)}</tbody>
              </table></div>
            </div>
          )}
          <div>
            <h3 style={{ margin: '4px 0 8px' }}>E se parcelar em outra quantidade?</h3>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Parcelas</th><th className="num">Valor da parcela</th><th className="num">Total</th><th className="num">Maior mês de faturas</th></tr></thead>
              <tbody>{sim.comparison.map((c) => (
                <tr key={c.n} style={c.n === sim.n ? { background: 'var(--accent-soft)' } : undefined}><td>{c.n}x {c.n === sim.n && <Badge tone="ok">escolhida</Badge>}</td><td className="num">{brl(c.installment)}</td><td className="num">{brl(c.totalPaid)}</td><td className="num">{brl(c.allPeak)}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="muted" style={{ marginTop: 6 }}>{fixed ? 'A quantidade escolhida usa a parcela informada por você (com juros). As outras dividem o preço à vista, sem juros: a loja pode cobrar juros nelas também.' : 'As outras quantidades dividem o preço em partes iguais, sem juros. Se a loja cobrar juros, informe o valor real da parcela.'}</p>
          </div>
          <p className="muted">{sim.note}</p>
        </>
      )}
      {available != null && form.price > 0 && (
        <div className={`alert${cashAfter < 0 ? ' warn' : ''}`}>
          {mode === 'cash' ? 'Pagando à vista: ' : 'Se pagasse à vista: '}saldo livre hoje <strong>{brl(available)}</strong> → <strong>{brl(cashAfter)}</strong>
          {cashAfter < 0 ? '. Não cabe à vista com o saldo livre atual.' : '.'}
        </div>
      )}
    </div>
  );
}
