import { useState, useEffect, useCallback, Component } from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, Wallet, CreditCard, PlusCircle, Layers, Repeat, ShoppingBag, ShoppingCart, Calculator, Link2, MoreHorizontal, Settings as Cog, ChevronDown, ChevronRight } from 'lucide-react';
import { AppCtx, Modal } from './ui.jsx';
import { get, post, setToken } from './api.js';
import pkg from '../../package.json';
import Dashboard from './pages/Dashboard.jsx';
import Entries from './pages/Entries.jsx';
import Accounts from './pages/Accounts.jsx';
import Subscriptions from './pages/Subscriptions.jsx';
import Reserves from './pages/Reserves.jsx';
import Withdrawal from './pages/Withdrawal.jsx';
import Planning from './pages/Planning.jsx';
import Debts from './pages/Debts.jsx';
import Cards, { NewCardPage, PurchasePage } from './pages/Cards.jsx';
import Tools from './pages/Tools.jsx';
import NewPurchase from './pages/NewPurchase.jsx';
import Money from './pages/Money.jsx';
import Simulators from './pages/Simulators.jsx';
import Connect from './pages/Connect.jsx';
import Receivables from './pages/Receivables.jsx';
import Analysis from './pages/Analysis.jsx';
import CalendarPage from './pages/Calendar.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import BatchShopping from './pages/BatchShopping.jsx';

const MAIN_TOP = [['dashboard', 'Painel completo'], ['dinheiro', 'Meu dinheiro']];
const CARDS_NAV = [['novo-cartao', 'Novo cartão'], ['compra-parcelada', 'Adicionar parcela'], ['cartoes', 'Cartões']];
const MAIN_BOTTOM = [['assinaturas', 'Assinaturas'], ['compra-nova', 'Compra nova'], ['compras-lote', 'Compras em lote'], ['simuladores', 'Simuladores'], ['conectar', 'Conectar']];
const MORE = [
  ['ferramentas', 'Visão geral'], ['calendario', 'Calendário'], ['areceber', 'Valores a receber'], ['reservas', 'Reservas e investimentos'],
  ['metas', 'Metas'], ['projecao', 'Projeção'], ['analises', 'Análise'],
  ['receitas', 'Receitas'], ['despesas', 'Despesas'], ['contas', 'Contas'], ['dividas', 'Dívidas e parcelas'], ['retirada', 'Retirada pessoal'], ['relatorios', 'Relatórios'],
];
const MORE_KEYS = MORE.map(([k]) => k);
const ICONS = { dashboard: LayoutDashboard, dinheiro: Wallet, 'novo-cartao': PlusCircle, 'compra-parcelada': Layers, cartoes: CreditCard, assinaturas: Repeat, 'compra-nova': ShoppingBag, 'compras-lote': ShoppingCart, simuladores: Calculator, conectar: Link2 };
const Ico = ({ k }) => { const I = ICONS[k]; return I ? <I size={16} strokeWidth={1.9} /> : null; };

export const APP_VERSION = pkg.version; // única fonte da versão: package.json

function Logo() {
  return <img src="/logo.png" alt="" width="28" height="28" style={{ borderRadius: 7 }} />;
}

function LockScreen({ onUnlock }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { const { token } = await post('/api/auth/login', { password: pw }); setToken(token); onUnlock(); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="lock">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><Logo /> Wallet <span className="badge" style={{ fontSize: 10, padding: '1px 6px', marginLeft: 4, fontWeight: 700, background: 'var(--panel)', border: '1px solid var(--line)' }}>v{APP_VERSION}</span></div>
        <label className="field"><span>Senha</span><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <div className="alert danger">{err}</div>}
        <button className="btn primary" type="submit">Entrar</button>
      </form>
    </div>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="pad" style={{ padding: 24 }}>
          <div className="alert danger">
            <h3 style={{ marginBottom: 8 }}>Ops! Ocorreu um erro ao carregar esta tela.</h3>
            <p style={{ margin: 0 }}>{this.state.error?.message || String(this.state.error)}</p>
          </div>
          <button className="btn primary" style={{ marginTop: 16 }} onClick={() => this.setState({ hasError: false, error: null })}>
            Recarregar tela
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [params, setParams] = useState({});
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [dismissUpdate, setDismissUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [localUpdate, setLocalUpdate] = useState(null);
  const [dismissLocal, setDismissLocal] = useState(false);

  const load = useCallback(async () => {
    try {
      const st = await get('/api/auth/status');
      if (st.locked && !st.authed) { setLocked(true); return; }
      setLocked(false);
      setBoot(await get('/api/bootstrap'));
      setError('');
      // Verifica atualizações na inicialização
      get('/api/updater/status').then(setUpdateStatus).catch(() => {});
      get('/api/local-update/status').then(setLocalUpdate).catch(() => {});
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Polling suave a cada 2 minutos caso o download em background termine
    const timer = setInterval(() => {
      get('/api/updater/status').then(setUpdateStatus).catch(() => {});
      get('/api/local-update/status').then(setLocalUpdate).catch(() => {});
    }, 120000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const h = () => { setBoot(null); setLocked(true); };
    window.addEventListener('wallet-locked', h);
    return () => window.removeEventListener('wallet-locked', h);
  }, []);

  const refresh = useCallback(async () => {
    try { setBoot(await get('/api/bootstrap')); } catch { /* tratado nas telas */ }
    setVersion((v) => v + 1);
  }, []);
  const notify = useCallback((msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), err ? 6000 : 3000);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  const nav = useCallback((p, prm = {}) => { setParams(prm); setPage(p); window.scrollTo(0, 0); }, []);

  if (locked) return <LockScreen onUnlock={load} />;
  if (error) return <div className="pad"><div className="alert danger">{error}</div><button className="btn" style={{ marginTop: 12 }} onClick={load}>Tentar novamente</button></div>;
  if (!boot) return <div className="pad muted">Abrindo Wallet…</div>;

  const ctx = { boot, accounts: boot.accounts, categories: boot.categories, settings: boot.settings, today: boot.today, version, refresh, notify, confirm, nav, params };
  const pages = {
    dinheiro: <Money />, simuladores: <Simulators key={JSON.stringify(params)} />, conectar: <Connect />, dashboard: <Dashboard />, calendario: <CalendarPage />, receitas: <Entries key="i" kind="income" />, despesas: <Entries key="e" kind="expense" />,
    areceber: <Receivables />, cartoes: <Cards />, 'novo-cartao': <NewCardPage key={JSON.stringify(params)} />, 'compra-parcelada': <PurchasePage key={JSON.stringify(params)} />, ferramentas: <Tools />, 'compra-nova': <NewPurchase />, 'compras-lote': <BatchShopping />, metas: <Planning key="g" only="goals" />, projecao: <Planning key="p" only="proj" />, contas: <Accounts />, assinaturas: <Subscriptions />, dividas: <Debts />, reservas: <Reserves />, retirada: <Withdrawal />,
    analises: <Analysis />, relatorios: <Reports />, configuracoes: <Settings />,
  };
  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <Logo /> Wallet <span className="badge" style={{ fontSize: 10, padding: '1px 6px', marginLeft: 4, fontWeight: 700, background: 'var(--panel)', border: '1px solid var(--line)' }}>v{APP_VERSION}</span>
          </div>
          <nav className="nav">
            {MAIN_TOP.map(([k, label]) => <button key={k} className={page === k ? 'on' : ''} onClick={() => nav(k)}><Ico k={k} />{label}</button>)}
            <div className="grp"><span className="grp-label">Cartões</span></div>
            {CARDS_NAV.map(([k, label]) => <button key={k} className={`sub-item${page === k ? ' on' : ''}`} onClick={() => nav(k)}><Ico k={k} />{label}</button>)}
            <div className="grp" />
            {MAIN_BOTTOM.map(([k, label]) => <button key={k} className={page === k ? 'on' : ''} onClick={() => nav(k)}><Ico k={k} />{label}</button>)}
            <div className="grp" />
            <button className={MORE_KEYS.includes(page) && !moreOpen ? 'on' : ''} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
              <MoreHorizontal size={16} strokeWidth={1.9} />Mais ferramentas {moreOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{!moreOpen && MORE_KEYS.includes(page) && <span className="cur-tool"> · {MORE.find(([k]) => k === page)[1]}</span>}
            </button>
            {moreOpen && MORE.map(([k, label]) => <button key={k} className={`sub-item${page === k ? ' on' : ''}`} onClick={() => { nav(k); setMoreOpen(false); }}>{label}</button>)}
            <div className="grp" />
            <button className={page === 'configuracoes' ? 'on' : ''} onClick={() => nav('configuracoes')}><Cog size={16} strokeWidth={1.9} />Configurações</button>
          </nav>
          <div className="foot">
            Olá, {boot.settings.user_name}.<br />
            Dados salvos neste computador.<br />
            <span style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, display: 'inline-block' }}>Versão {APP_VERSION}</span>
          </div>
        </aside>
        <main className="main">
          <ErrorBoundary key={page}>
            {localUpdate?.hasUpdate && !dismissLocal && (
              <div style={{ background: '#052e16', border: '1px solid #16a34a', color: '#f0fdf4', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13, marginBottom: 14, borderRadius: 10 }}>
                <span><strong>Nova versão {localUpdate.available} pronta para instalar</strong> (você está na {localUpdate.installed}). O Wallet fecha, faz backup do banco e abre de novo.</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn sm" style={{ background: '#22c55e', color: '#052e16', fontWeight: 700, border: 'none' }} onClick={async () => { try { await post('/api/local-update/apply', {}); notify('Abrindo o atualizador…'); } catch (x) { notify(x.message, true); } }}>Atualizar agora</button>
                  <button className="btn sm ghost" style={{ color: '#86efac' }} onClick={() => setDismissLocal(true)}>Depois</button>
                </span>
              </div>
            )}
            {updateStatus?.readyToInstall && !dismissUpdate && (
              <div style={{ background: '#052e16', borderBottom: '1px solid #16a34a', color: '#f0fdf4', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🚀</span>
                  <span>
                    <strong>Nova versão disponível (v{updateStatus?.updateInfo?.latestVersion || updateStatus?.latestVersion})!</strong> O instalador foi baixado e está pronto.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className="btn sm"
                    style={{ background: '#22c55e', color: '#052e16', fontWeight: 700, border: 'none' }}
                    disabled={applyingUpdate}
                    onClick={async () => {
                      setApplyingUpdate(true);
                      try {
                        await post('/api/updater/apply', {});
                      } catch (x) {
                        notify(x.message, true);
                        setApplyingUpdate(false);
                      }
                    }}
                  >
                    {applyingUpdate ? 'Reiniciando...' : 'Reiniciar e Atualizar'}
                  </button>
                  <button className="btn sm ghost" style={{ color: '#86efac' }} onClick={() => setDismissUpdate(true)}>
                    Depois
                  </button>
                </div>
              </div>
            )}
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>{pages[page]}</motion.div>
          </ErrorBoundary>
        </main>
      </div>
      {toast && <motion.div className={`toast${toast.err ? ' err' : ''}`} role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>{toast.msg}</motion.div>}
      {applyingUpdate && (
        <Modal title="Atualizando o aplicativo" onClose={() => {}}>
          <p style={{ lineHeight: 1.6 }}>
            O Wallet está aplicando a nova versão e reiniciará em instantes. Por favor, aguarde...
          </p>
        </Modal>
      )}
      {confirmState && (
        <Modal title={confirmState.title || 'Confirmar'} onClose={() => { confirmState.resolve(false); setConfirmState(null); }}
          footer={<>
            <button className="btn" onClick={() => { confirmState.resolve(false); setConfirmState(null); }}>Cancelar</button>
            {(confirmState.options || []).map((o) => <button key={o.label} className={`btn ${o.danger ? 'danger' : ''}`} onClick={() => { confirmState.resolve(o.value); setConfirmState(null); }}>{o.label}</button>)}
            {!confirmState.options && <button className={`btn ${confirmState.danger ? 'danger' : 'primary'}`} onClick={() => { confirmState.resolve(true); setConfirmState(null); }}>{confirmState.okLabel || 'Confirmar'}</button>}
          </>}>
          <p style={{ lineHeight: 1.5 }}>{confirmState.message}</p>
        </Modal>
      )}
    </AppCtx.Provider>
  );
}
