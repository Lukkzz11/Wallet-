// Compras em lote. Reconstruído a partir do app instalado (código compilado); nomes internos abreviados.
import * as S from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { useApp, Card as M, PageHead as Me, Tabs as Ht, Field as z, Stat as $, Badge as q, Empty as ae, Modal as sn, MoneyInput as _e } from '../ui.jsx';
import { post as K } from '../api.js';
import { brl as x, addMonthKey as nn, monthShort as G } from '../fmt.js';
import { BarChart as an, COLORS as fe } from '../charts.jsx';

const n = { jsx, jsxs, Fragment };
const H = useApp;

const ES = [{
    id: "demo-1",
    name: 'Monitor LG Ultrawide 29"',
    image: "",
    url: "https://www.kabum.com.br/produto/monitor-lg-29",
    domain: "kabum.com.br",
    price_cash: 119900,
    count: 10,
    installment: 13322,
    interest: "com juros",
    status: "ok",
    notes: []
  }, {
    id: "demo-2",
    name: "Cadeira de Escritório Ergonômica",
    image: "",
    url: "https://www.mercadolivre.com.br/produto/cadeira-ergonomica",
    domain: "mercadolivre.com.br",
    price_cash: 78e3,
    count: 6,
    installment: 13e3,
    interest: "sem juros",
    status: "ok",
    notes: []
  }, {
    id: "demo-3",
    name: "Teclado Mecânico Sem Fio",
    image: "",
    url: "https://www.amazon.com.br/dp/teclado-mecanico",
    domain: "amazon.com.br",
    price_cash: 34990,
    count: 3,
    installment: 11663,
    interest: "sem juros",
    status: "ok",
    notes: []
  }],
  Yo = [{
    id: "cmp-1",
    store: "Amazon Brasil",
    url: "https://www.amazon.com.br/produto-exemplo",
    price_pix: 249900,
    installments_count: 10,
    installment_val: 27766,
    shipping: 0,
    notes: "Frete Grátis Prime"
  }, {
    id: "cmp-2",
    store: "Mercado Livre",
    url: "https://www.mercadolivre.com.br/produto-exemplo",
    price_pix: 239900,
    installments_count: 12,
    installment_val: 21990,
    shipping: 2990,
    notes: "Envio Full"
  }, {
    id: "cmp-3",
    store: "Kabum",
    url: "https://www.kabum.com.br/produto-exemplo",
    price_pix: 224900,
    installments_count: 10,
    installment_val: 24990,
    shipping: 3500,
    notes: "15% de desconto no PIX"
  }];
function ga(e) {
  try {
    return new URL(e.trim()).hostname.replace(/^www\./, "");
  } catch {
    return "loja";
  }
}
function AS() {
  const {
      today: e,
      nav: t,
      notify: s,
      confirm: a
    } = H(),
    [r, i] = S.useState("lote"),
    [o, l] = S.useState(() => {
      try {
        const E = localStorage.getItem("wallet_batch_items");
        return E ? JSON.parse(E) : [];
      } catch {
        return [];
      }
    });
  S.useEffect(() => {
    try {
      localStorage.setItem("wallet_batch_items", JSON.stringify(o));
    } catch {}
  }, [o]);
  const [c, d] = S.useState(""),
    [u, h] = S.useState(!1),
    [p, v] = S.useState({
      current: 0,
      total: 0,
      currentUrl: ""
    }),
    [y, f] = S.useState(null),
    [j, m] = S.useState(!1),
    [g, b] = S.useState(() => e ? e.slice(0, 7) : new Date().toISOString().slice(0, 7)),
    k = async () => {
      var pe, J, Ye;
      const E = c.split(/[\r\n]+/),
        T = [],
        O = /(https?:\/\/[^\s"'<>]+)/gi;
      for (const dt of E) {
        const mt = dt.trim();
        if (!mt) continue;
        const it = mt.match(O);
        if (it) for (const _t of it) T.push(_t);else (mt.startsWith("http://") || mt.startsWith("https://")) && T.push(mt);
      }
      if (T.length === 0) {
        s("Nenhum link válido encontrado no texto. Cole links começando com https:// ou http://.", !0);
        return;
      }
      h(!0);
      let Y = 0;
      const he = [];
      for (let dt = 0; dt < T.length; dt++) {
        const mt = T[dt],
          it = ga(mt);
        v({
          current: dt + 1,
          total: T.length,
          currentUrl: mt
        });
        try {
          const _t = await K("/api/product/analyze", {
              url: mt
            }),
            ht = _t.product || {},
            yr = ((pe = ht.installments) == null ? void 0 : pe.count) || 1,
            Bu = ((J = ht.installments) == null ? void 0 : J.value) || (ht.price_cash && yr > 1 ? Math.round(ht.price_cash / yr) : 0);
          he.push({
            id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: ht.name || `Produto em ${it}`,
            image: ht.image || "",
            url: mt,
            domain: it,
            price_cash: ht.price_cash || 0,
            count: yr,
            installment: Bu,
            interest: ((Ye = ht.installments) == null ? void 0 : Ye.interest) || (ht.price_cash && Bu * yr > ht.price_cash * 1.01 ? "com juros" : "sem juros"),
            status: ht.price_cash ? "ok" : "warning",
            notes: _t.notes || []
          }), Y++;
        } catch (_t) {
          he.push({
            id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: `Item (${it}) - preencher valores`,
            image: "",
            url: mt,
            domain: it,
            price_cash: 0,
            count: 1,
            installment: 0,
            interest: "",
            status: "manual",
            notes: [_t.message || "Falha ao ler página automaticamente."]
          });
        }
      }
      l(dt => [...dt, ...he]), h(!1), d(""), s(`${Y} de ${T.length} produto(s) lidos com sucesso.`);
    },
    N = async () => {
      (await a({
        title: "Limpar lista de compras?",
        message: "Todos os produtos adicionados à simulação em lote serão removidos.",
        danger: !0,
        okLabel: "Limpar tudo"
      })) && (l([]), s("Lista de compras limpa."));
    },
    C = () => {
      l(ES), s("Exemplo de compras em lote carregado.");
    },
    _ = E => {
      l(T => T.filter(O => O.id !== E));
    },
    w = E => {
      l(T => T.map(O => O.id === E.id ? E : O)), f(null), s("Produto atualizado.");
    },
    F = E => {
      l(T => [...T, {
        ...E,
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        domain: E.url ? ga(E.url) : "Manual",
        status: "ok",
        notes: []
      }]), m(!1), s("Produto adicionado.");
    },
    {
      totalPix: B,
      totalCard: ne,
      diffCashCredit: ce,
      maxInstallments: le,
      monthlySchedule: ge
    } = S.useMemo(() => {
      let E = 0,
        T = 0,
        O = 1;
      for (const pe of o) {
        const J = pe.price_cash || 0;
        E += J;
        const Ye = pe.count || 1;
        Ye > O && (O = Ye);
        const dt = pe.installment || 0;
        Ye > 1 && dt > 0 ? T += Ye * dt : T += J;
      }
      const Y = T - E,
        he = [];
      for (let pe = 0; pe < O; pe++) {
        const J = nn(g, pe);
        let Ye = 0;
        const dt = [],
          mt = [];
        for (const it of o) {
          const _t = it.count || 1,
            ht = it.installment || (_t > 1 && it.price_cash ? Math.round(it.price_cash / _t) : it.price_cash || 0);
          _t > pe && (Ye += ht, dt.push({
            name: it.name,
            installment: ht,
            current: pe + 1,
            total: _t
          })), _t === pe + 1 && mt.push(it.name);
        }
        he.push({
          month: J,
          monthlySum: Ye,
          activeProducts: dt,
          endingProducts: mt
        });
      }
      return {
        totalPix: E,
        totalCard: T,
        diffCashCredit: Y,
        maxInstallments: O,
        monthlySchedule: he
      };
    }, [o, g]),
    A = ne > 0 && ce > 0 ? (ce / ne * 100).toFixed(1) : 0,
    [V, X] = S.useState(() => localStorage.getItem("wallet_cmp_product_name") || "Smartphone Top de Linha (Exemplo)"),
    [D, R] = S.useState(() => {
      try {
        const E = localStorage.getItem("wallet_cmp_offers");
        return E ? JSON.parse(E) : Yo;
      } catch {
        return Yo;
      }
    });
  S.useEffect(() => {
    try {
      localStorage.setItem("wallet_cmp_product_name", V), localStorage.setItem("wallet_cmp_offers", JSON.stringify(D));
    } catch {}
  }, [V, D]);
  const [P, I] = S.useState(""),
    [U, Se] = S.useState(!1),
    [de, se] = S.useState(null),
    Xe = async () => {
      var E, T;
      if (P.trim()) {
        Se(!0);
        try {
          const Y = (await K("/api/product/analyze", {
              url: P.trim()
            })).product || {},
            he = ga(P),
            pe = ((E = Y.installments) == null ? void 0 : E.count) || 1,
            J = ((T = Y.installments) == null ? void 0 : T.value) || (Y.price_cash && pe > 1 ? Math.round(Y.price_cash / pe) : 0);
          se({
            id: `cmp-${Date.now()}`,
            store: he.split(".")[0].toUpperCase() || "Loja",
            url: P.trim(),
            price_pix: Y.price_cash || 0,
            installments_count: pe,
            installment_val: J,
            shipping: 0,
            notes: Y.name ? `Extraído: ${Y.name.slice(0, 45)}...` : ""
          }), s("Dados da loja lidos com sucesso.");
        } catch (O) {
          s(`Aviso: ${O.message}. Preencha os campos manualmente.`), se({
            id: `cmp-${Date.now()}`,
            store: ga(P).split(".")[0].toUpperCase() || "Loja",
            url: P.trim(),
            price_pix: 0,
            installments_count: 1,
            installment_val: 0,
            shipping: 0,
            notes: ""
          });
        }
        Se(!1);
      }
    },
    Kt = E => {
      if (!E.store.trim()) {
        s("Informe o nome da loja ou site.", !0);
        return;
      }
      R(T => {
        const O = T.findIndex(Y => Y.id === E.id);
        if (O >= 0) {
          const Y = [...T];
          return Y[O] = E, Y;
        }
        return [...T, E];
      }), se(null), I(""), s("Oferta cadastrada no comparador.");
    },
    oo = E => {
      R(T => T.filter(O => O.id !== E));
    },
    on = S.useMemo(() => D.map(E => {
      const T = E.shipping || 0,
        O = (E.price_pix || 0) + T,
        Y = E.installments_count || 1,
        he = (Y > 1 && E.installment_val > 0 ? Y * E.installment_val : E.price_pix || 0) + T,
        pe = he - O,
        J = he > 0 ? pe / he * 100 : 0;
      return {
        ...E,
        pixTotal: O,
        cardTotal: he,
        discountPix: pe,
        discountPct: J
      };
    }), [D]),
    {
      bestPixOffer: qe,
      bestCardOffer: Gt,
      bestOverallOffer: ra
    } = S.useMemo(() => {
      if (on.length === 0) return {};
      const E = [...on].sort((pe, J) => pe.pixTotal - J.pixTotal),
        T = [...on].sort((pe, J) => pe.cardTotal - J.cardTotal),
        O = E[0],
        Y = T[0],
        he = O.pixTotal <= Y.cardTotal ? O : Y;
      return {
        bestPixOffer: O,
        bestCardOffer: Y,
        bestOverallOffer: he
      };
    }, [on]),
    rt = S.useMemo(() => {
      if (!qe) return null;
      const E = qe,
        T = E.discountPix,
        O = E.discountPct,
        Y = E.installments_count || 1,
        he = Y / 2 * .85;
      return O >= 4 || O > he ? {
        choice: "pix",
        tone: "pos",
        badge: "Compensa pagar no PIX!",
        title: `Economia de ${x(T)} (${O.toFixed(1)}% de desconto real)`,
        desc: `Pagar à vista no PIX na ${E.store} é muito mais vantajoso! O desconto imediato de ${O.toFixed(1)}% supera qualquer rendimento que esse valor teria na conta durante os ${Y} meses de parcelamento.`,
        tip: `Você economiza ${x(T)} na hora e não compromete o limite do seu cartão de crédito.`
      } : O > 0 && O < 3 && Y >= 6 ? {
        choice: "card",
        tone: "ok",
        badge: "Compensa pagar no Cartão!",
        title: `Parcelamento em ${Y}x de ${x(E.installment_val)} (desconto PIX baixo)`,
        desc: `O desconto no PIX é de apenas ${O.toFixed(1)}% (${x(T)}). Deixando o dinheiro na sua conta ou em uma caixinha rendendo a 100% do CDI, os rendimentos ao longo dos ${Y} meses empatam ou superam esse desconto, e você mantém sua reserva de segurança intacta.`,
        tip: `Mantenha a liquidez na conta e aproveite o parcelamento sem juros da ${E.store}.`
      } : T <= 0 && Y >= 2 ? {
        choice: "card",
        tone: "ok",
        badge: "Compensa pagar no Cartão!",
        title: `Mesmo preço no PIX e Cartão (${Y}x sem juros)`,
        desc: `A ${E.store} não oferece desconto no PIX. Portanto, parcelar em ${Y} vezes sem juros preserva sua liquidez financeira sem nenhum custo adicional.`,
        tip: "Não gaste seu saldo à vista quando a loja não dá nenhum desconto."
      } : {
        choice: "pix",
        tone: "pos",
        badge: "Compensa fechar no PIX!",
        title: `Pague ${x(E.pixTotal)} sem parcelas futuras`,
        desc: "A compra à vista liquida o item imediatamente e evita acúmulo de compromissos para os próximos meses.",
        tip: "Se seu saldo em conta estiver confortável, prefira quitar à vista."
      };
    }, [qe]);
  return n.jsxs("div", {
    className: "stack",
    children: [n.jsx(Me, {
      title: "Simulação de Compras em Lote e Comparador",
      sub: "Simule múltiplos produtos para calcular o total e o impacto mensal das parcelas, ou compare ofertas entre sites e veja se compensa PIX ou Cartão.",
      children: r === "lote" && o.length > 0 && n.jsxs(n.Fragment, {
        children: [n.jsx("button", {
          className: "btn",
          onClick: () => m(!0),
          children: "+ Adicionar manual"
        }), n.jsx("button", {
          className: "btn danger",
          onClick: N,
          children: "Limpar lista"
        })]
      })
    }), n.jsx(Ht, {
      value: r,
      onChange: i,
      items: [{
        value: "lote",
        label: `Compras em lote (${o.length})`
      }, {
        value: "comparador",
        label: `Comparador de preços (${D.length})`
      }]
    }), r === "lote" && n.jsxs("div", {
      className: "stack",
      children: [n.jsxs(M, {
        title: "Leitor de links de produtos em lote",
        children: [n.jsx(z, {
          label: "Cole múltiplos links de páginas de produtos (um por linha):",
          hint: "O Wallet extrai automaticamente nome, preço à vista (PIX), parcelamento e juros para cada item.",
          children: n.jsx("textarea", {
            rows: 4,
            style: {
              width: "100%",
              fontFamily: "monospace",
              fontSize: 13
            },
            placeholder: `https://www.loja1.com.br/produto-a
https://www.loja2.com.br/produto-b
https://www.loja3.com.br/produto-c`,
            value: c,
            onChange: E => d(E.target.value),
            disabled: u
          })
        }), n.jsxs("div", {
          className: "actions",
          style: {
            marginTop: 12
          },
          children: [n.jsx("button", {
            className: "btn primary",
            disabled: u || !c.trim(),
            onClick: k,
            children: u ? "Lendo produtos…" : "Analisar e adicionar produtos à lista"
          }), n.jsx("button", {
            className: "btn",
            disabled: u,
            onClick: () => m(!0),
            children: "+ Adicionar item manual"
          }), o.length === 0 && n.jsx("button", {
            className: "btn ghost",
            disabled: u,
            onClick: C,
            children: "Carregar exemplo demonstrativo"
          })]
        }), u && n.jsxs("div", {
          style: {
            marginTop: 14
          },
          children: [n.jsx("div", {
            className: "progress",
            children: n.jsx("div", {
              style: {
                width: `${p.total ? p.current / p.total * 100 : 0}%`
              }
            })
          }), n.jsxs("p", {
            className: "muted",
            style: {
              marginTop: 6,
              fontSize: 13
            },
            children: ["Lendo ", p.current, " de ", p.total, ": ", n.jsx("strong", {
              children: ga(p.currentUrl)
            }), "..."]
          })]
        })]
      }), o.length > 0 && n.jsxs("div", {
        className: "grid-stats",
        children: [n.jsx($, {
          label: "Total de itens",
          value: o.length,
          sub: "Produtos no carrinho"
        }), n.jsx($, {
          label: "Total no PIX (À vista)",
          value: x(B),
          tone: "pos",
          sub: "Pagamento integral à vista"
        }), n.jsx($, {
          label: "Total no Cartão (Parcelado)",
          value: x(ne),
          sub: `Até ${le}x parcelado`
        }), n.jsx($, {
          label: "Economia no PIX",
          value: ce > 0 ? x(ce) : "Mesmo valor",
          tone: ce > 0 ? "pos" : void 0,
          sub: ce > 0 ? `${A}% de desconto à vista` : "Sem acréscimo a prazo"
        })]
      }), o.length > 0 ? n.jsx(M, {
        title: "Produtos adicionados ao lote",
        action: n.jsxs("span", {
          className: "muted",
          style: {
            fontSize: 12
          },
          children: [o.length, " ", o.length === 1 ? "item" : "itens", " na lista"]
        }),
        children: n.jsx("div", {
          className: "tbl-wrap",
          children: n.jsxs("table", {
            className: "tbl",
            children: [n.jsx("thead", {
              children: n.jsxs("tr", {
                children: [n.jsx("th", {
                  style: {
                    width: 44
                  },
                  children: "Item"
                }), n.jsx("th", {
                  children: "Produto e Loja"
                }), n.jsx("th", {
                  className: "num",
                  children: "Preço no PIX"
                }), n.jsx("th", {
                  className: "num",
                  children: "Parcelamento"
                }), n.jsx("th", {
                  className: "num",
                  children: "Total a Prazo"
                }), n.jsx("th", {
                  children: "Diferença / Juros"
                }), n.jsx("th", {
                  className: "row-actions",
                  children: "Ações"
                })]
              })
            }), n.jsx("tbody", {
              children: o.map((E, T) => {
                var he;
                const O = E.count > 1 && E.installment > 0 ? E.count * E.installment : E.price_cash,
                  Y = O - E.price_cash;
                return n.jsxs("tr", {
                  children: [n.jsx("td", {
                    children: E.image ? n.jsx("img", {
                      src: E.image,
                      alt: "",
                      referrerPolicy: "no-referrer",
                      style: {
                        width: 36,
                        height: 36,
                        objectFit: "contain",
                        borderRadius: 4,
                        border: "1px solid var(--line)"
                      },
                      onError: pe => {
                        pe.currentTarget.style.display = "none";
                      }
                    }) : n.jsxs("div", {
                      style: {
                        width: 36,
                        height: 36,
                        borderRadius: 4,
                        background: "var(--panel)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 11,
                        color: "var(--ink-3)",
                        fontWeight: 600
                      },
                      children: ["#", T + 1]
                    })
                  }), n.jsxs("td", {
                    children: [n.jsx("strong", {
                      children: E.name
                    }), n.jsxs("div", {
                      className: "sub",
                      children: [E.domain && n.jsx("span", {
                        style: {
                          marginRight: 8
                        },
                        children: E.domain
                      }), E.url && n.jsx("a", {
                        href: E.url,
                        target: "_blank",
                        rel: "noreferrer",
                        className: "link",
                        style: {
                          fontSize: 11
                        },
                        children: "Abrir link ↗"
                      })]
                    }), ((he = E.notes) == null ? void 0 : he.length) > 0 && E.status !== "ok" && n.jsx("div", {
                      style: {
                        marginTop: 2
                      },
                      children: n.jsx(q, {
                        tone: "warn",
                        children: E.notes[0]
                      })
                    })]
                  }), n.jsx("td", {
                    className: "num",
                    children: n.jsx("strong", {
                      className: "pos",
                      children: x(E.price_cash)
                    })
                  }), n.jsx("td", {
                    className: "num",
                    children: E.count > 1 && E.installment > 0 ? n.jsxs("span", {
                      children: [E.count, "x de ", n.jsx("strong", {
                        children: x(E.installment)
                      })]
                    }) : n.jsx("span", {
                      className: "muted",
                      children: "1x à vista"
                    })
                  }), n.jsx("td", {
                    className: "num",
                    children: n.jsx("strong", {
                      children: x(O)
                    })
                  }), n.jsx("td", {
                    children: Y > 0 ? n.jsxs(q, {
                      tone: "warn",
                      children: ["+", x(Y), " (", Math.round(Y / E.price_cash * 100), "%)"]
                    }) : Y < 0 ? n.jsx(q, {
                      tone: "ok",
                      children: x(Y)
                    }) : n.jsx(q, {
                      tone: "ok",
                      children: "Sem acréscimo"
                    })
                  }), n.jsxs("td", {
                    className: "row-actions",
                    children: [n.jsx("button", {
                      className: "btn sm",
                      onClick: () => f(E),
                      style: {
                        marginRight: 6
                      },
                      children: "Editar"
                    }), n.jsx("button", {
                      className: "btn sm danger",
                      onClick: () => _(E.id),
                      children: "Excluir"
                    })]
                  })]
                }, E.id);
              })
            }), n.jsx("tfoot", {
              children: n.jsxs("tr", {
                children: [n.jsx("td", {
                  colSpan: 2,
                  children: n.jsxs("strong", {
                    children: ["Total consolidado (", o.length, " itens)"]
                  })
                }), n.jsx("td", {
                  className: "num",
                  children: n.jsx("strong", {
                    className: "pos",
                    children: x(B)
                  })
                }), n.jsxs("td", {
                  className: "num muted",
                  children: ["até ", le, "x"]
                }), n.jsx("td", {
                  className: "num",
                  children: n.jsx("strong", {
                    children: x(ne)
                  })
                }), n.jsx("td", {
                  colSpan: 2,
                  children: ce > 0 ? n.jsxs("strong", {
                    className: "pos",
                    children: ["Economia de ", x(ce), " no PIX"]
                  }) : n.jsx("span", {
                    className: "muted",
                    children: "Sem diferença"
                  })
                })]
              })
            })]
          })
        })
      }) : n.jsx(M, {
        children: n.jsx(ae, {
          action: n.jsx("button", {
            className: "btn primary",
            onClick: C,
            children: "Carregar exemplo demonstrativo"
          }),
          children: "Nenhum produto adicionado à lista. Cole os links acima ou adicione manualmente para simular a compra em lote."
        })
      }), o.length > 0 && n.jsxs(M, {
        title: "Detalhamento do impacto mensal por mês",
        action: n.jsxs("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8
          },
          children: [n.jsx("span", {
            className: "muted",
            style: {
              fontSize: 13
            },
            children: "Primeira parcela em:"
          }), n.jsx("input", {
            type: "month",
            value: g,
            onChange: E => E.target.value && b(E.target.value),
            style: {
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--line-strong)"
            }
          })]
        }),
        children: [n.jsx("p", {
          className: "muted",
          style: {
            marginBottom: 16
          },
          children: "Veja quanto você terá que pagar a cada mês conforme os produtos forem sendo quitados. Quando um produto encerra suas parcelas, o valor da sua fatura mensal diminui."
        }), n.jsx("div", {
          style: {
            marginBottom: 20
          },
          children: n.jsx(an, {
            data: ge.map(E => ({
              label: G(E.month),
              values: [E.monthlySum]
            })),
            series: [{
              name: "Compromisso mensal no cartão",
              color: fe.green
            }],
            height: 180
          })
        }), n.jsx("div", {
          className: "tbl-wrap",
          children: n.jsxs("table", {
            className: "tbl",
            children: [n.jsx("thead", {
              children: n.jsxs("tr", {
                children: [n.jsx("th", {
                  children: "Mês"
                }), n.jsx("th", {
                  className: "num",
                  children: "Valor da Parcela Mensal"
                }), n.jsx("th", {
                  children: "Produtos Ativos no Mês"
                }), n.jsx("th", {
                  className: "num",
                  children: "% do Total"
                }), n.jsx("th", {
                  children: "Alívio no Orçamento"
                })]
              })
            }), n.jsx("tbody", {
              children: ge.map((E, T) => {
                const O = ne > 0 ? (E.monthlySum / ne * 100).toFixed(1) : 0;
                return n.jsxs("tr", {
                  children: [n.jsxs("td", {
                    children: [n.jsx("strong", {
                      children: G(E.month)
                    }), n.jsx("span", {
                      className: "sub",
                      children: E.month
                    })]
                  }), n.jsx("td", {
                    className: "num",
                    children: n.jsx("strong", {
                      style: {
                        fontSize: 15
                      },
                      children: x(E.monthlySum)
                    })
                  }), n.jsx("td", {
                    children: n.jsx("div", {
                      style: {
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4
                      },
                      children: E.activeProducts.map((Y, he) => n.jsxs(q, {
                        children: [Y.name.slice(0, 24), " (", Y.current, "/", Y.total, "x: ", x(Y.installment), ")"]
                      }, he))
                    })
                  }), n.jsxs("td", {
                    className: "num muted",
                    children: [O, "%"]
                  }), n.jsx("td", {
                    children: E.endingProducts.length > 0 ? n.jsxs(q, {
                      tone: "ok",
                      children: ["Quita neste mês: ", E.endingProducts.join(", ").slice(0, 35)]
                    }) : n.jsx("span", {
                      className: "muted",
                      style: {
                        fontSize: 12
                      },
                      children: "—"
                    })
                  })]
                }, E.month);
              })
            }), n.jsx("tfoot", {
              children: n.jsxs("tr", {
                children: [n.jsx("td", {
                  children: n.jsx("strong", {
                    children: "Soma total paga"
                  })
                }), n.jsx("td", {
                  className: "num",
                  children: n.jsx("strong", {
                    children: x(ne)
                  })
                }), n.jsxs("td", {
                  colSpan: 3,
                  className: "muted",
                  children: ["Total distribuído ao longo de ", le, " ", le === 1 ? "mês" : "meses"]
                })]
              })
            })]
          })
        })]
      })]
    }), r === "comparador" && n.jsxs("div", {
      className: "stack",
      children: [n.jsx(M, {
        title: "Produto sendo comparado",
        children: n.jsx("div", {
          className: "filters",
          style: {
            alignItems: "flex-end",
            marginBottom: 0
          },
          children: n.jsx(z, {
            label: "Nome ou modelo do produto",
            className: "full",
            children: n.jsx("input", {
              type: "text",
              value: V,
              onChange: E => X(E.target.value),
              placeholder: "Ex.: Smartphone Samsung Galaxy S24 256GB",
              style: {
                fontWeight: 600,
                fontSize: 15
              }
            })
          })
        })
      }), n.jsxs(M, {
        title: "Adicionar loja / oferta concorrente",
        children: [n.jsx("p", {
          className: "muted",
          style: {
            marginBottom: 10
          },
          children: "Cole o link de uma loja (Amazon, Mercado Livre, Kabum, etc.) para buscar preço e parcelamento automaticamente, ou clique em cadastrar manualmente."
        }), n.jsxs("div", {
          className: "filters",
          style: {
            marginBottom: 12
          },
          children: [n.jsx("input", {
            type: "url",
            style: {
              flex: 1,
              minWidth: 280
            },
            placeholder: "https://www.loja.com.br/produto...",
            value: P,
            onChange: E => I(E.target.value),
            onKeyDown: E => E.key === "Enter" && Xe(),
            disabled: U
          }), n.jsx("button", {
            className: "btn primary",
            disabled: U || !P.trim(),
            onClick: Xe,
            children: U ? "Buscando loja…" : "Buscar dados do link"
          }), n.jsx("button", {
            className: "btn",
            onClick: () => se({
              id: `cmp-${Date.now()}`,
              store: "",
              url: "",
              price_pix: 0,
              installments_count: 1,
              installment_val: 0,
              shipping: 0,
              notes: ""
            }),
            children: "+ Inserir loja manualmente"
          })]
        })]
      }), rt && qe && n.jsx(M, {
        className: "alert-highlight",
        style: {
          borderLeft: `5px solid ${rt.choice === "pix" ? "var(--green)" : "var(--accent)"}`,
          background: rt.choice === "pix" ? "var(--green-bg)" : "#eff6ff"
        },
        children: n.jsxs("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 12
          },
          children: [n.jsxs("div", {
            children: [n.jsx(q, {
              tone: rt.tone,
              style: {
                fontSize: 13,
                padding: "4px 10px",
                marginBottom: 6
              },
              children: rt.badge
            }), n.jsx("h2", {
              style: {
                fontSize: 18,
                marginTop: 4,
                color: "var(--ink)"
              },
              children: rt.title
            }), n.jsx("p", {
              style: {
                marginTop: 6,
                lineHeight: 1.5,
                color: "var(--ink-2)",
                maxWidth: 760
              },
              children: rt.desc
            }), n.jsxs("p", {
              style: {
                marginTop: 6,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-3)"
              },
              children: ["💡 Dica do Wallet: ", rt.tip]
            })]
          }), n.jsxs("div", {
            style: {
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              background: "var(--surface)",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--line)",
              minWidth: 280
            },
            children: [n.jsxs("div", {
              style: {
                borderRight: "1px solid var(--line)",
                paddingRight: 12
              },
              children: [n.jsx("div", {
                className: "stat-label",
                children: "⚡ Pagamento no PIX"
              }), n.jsx("div", {
                style: {
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--green)"
                },
                children: x(qe.pixTotal)
              }), n.jsx("div", {
                className: "stat-sub",
                children: qe.store
              })]
            }), n.jsxs("div", {
              children: [n.jsx("div", {
                className: "stat-label",
                children: "💳 Pagamento Cartão"
              }), n.jsx("div", {
                style: {
                  fontSize: 18,
                  fontWeight: 700
                },
                children: x(qe.cardTotal)
              }), n.jsxs("div", {
                className: "stat-sub",
                children: [qe.installments_count, "x de ", x(qe.installment_val)]
              })]
            })]
          })]
        })
      }), on.length > 0 ? n.jsx(M, {
        title: `Comparativo de Preços (${on.length} alternativas cadastradas)`,
        children: n.jsx("div", {
          className: "tbl-wrap",
          children: n.jsxs("table", {
            className: "tbl",
            children: [n.jsx("thead", {
              children: n.jsxs("tr", {
                children: [n.jsx("th", {
                  style: {
                    width: 40
                  },
                  children: "Rank"
                }), n.jsx("th", {
                  children: "Loja / Site"
                }), n.jsx("th", {
                  className: "num",
                  children: "Preço no PIX"
                }), n.jsx("th", {
                  className: "num",
                  children: "Frete"
                }), n.jsx("th", {
                  className: "num",
                  children: "Total no PIX"
                }), n.jsx("th", {
                  className: "num",
                  children: "Condição no Cartão"
                }), n.jsx("th", {
                  className: "num",
                  children: "Total no Cartão"
                }), n.jsx("th", {
                  children: "Vantagem / Destaque"
                }), n.jsx("th", {
                  className: "row-actions",
                  children: "Ações"
                })]
              })
            }), n.jsx("tbody", {
              children: on.sort((E, T) => E.pixTotal - T.pixTotal).map((E, T) => {
                const O = (qe == null ? void 0 : qe.id) === E.id,
                  Y = (Gt == null ? void 0 : Gt.id) === E.id;
                return n.jsxs("tr", {
                  style: {
                    background: O ? "rgba(21, 128, 61, 0.04)" : void 0
                  },
                  children: [n.jsx("td", {
                    children: n.jsxs("span", {
                      style: {
                        display: "inline-block",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: T === 0 ? "var(--green)" : "var(--panel)",
                        color: T === 0 ? "#fff" : "var(--ink-2)",
                        textAlign: "center",
                        lineHeight: "24px",
                        fontWeight: 700,
                        fontSize: 12
                      },
                      children: [T + 1, "º"]
                    })
                  }), n.jsxs("td", {
                    children: [n.jsx("strong", {
                      children: E.store
                    }), E.url && n.jsx("div", {
                      className: "sub",
                      children: n.jsx("a", {
                        href: E.url,
                        target: "_blank",
                        rel: "noreferrer",
                        className: "link",
                        style: {
                          fontSize: 11
                        },
                        children: "Visitar oferta ↗"
                      })
                    }), E.notes && n.jsx("div", {
                      className: "sub muted",
                      children: E.notes
                    })]
                  }), n.jsx("td", {
                    className: "num",
                    children: x(E.price_pix)
                  }), n.jsx("td", {
                    className: "num",
                    children: E.shipping > 0 ? x(E.shipping) : n.jsx("span", {
                      className: "pos",
                      children: "Grátis"
                    })
                  }), n.jsx("td", {
                    className: "num",
                    children: n.jsx("strong", {
                      className: O ? "pos" : void 0,
                      style: {
                        fontSize: 15
                      },
                      children: x(E.pixTotal)
                    })
                  }), n.jsx("td", {
                    className: "num",
                    children: E.installments_count > 1 ? n.jsxs("span", {
                      children: [E.installments_count, "x de ", x(E.installment_val)]
                    }) : n.jsx("span", {
                      className: "muted",
                      children: "1x à vista"
                    })
                  }), n.jsx("td", {
                    className: "num",
                    children: n.jsx("strong", {
                      className: Y ? "pos" : void 0,
                      children: x(E.cardTotal)
                    })
                  }), n.jsx("td", {
                    children: n.jsxs("div", {
                      style: {
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4
                      },
                      children: [O && n.jsx(q, {
                        tone: "ok",
                        children: "🏆 Menor Preço PIX"
                      }), Y && n.jsx(q, {
                        tone: "neutral",
                        children: "💳 Melhor Parcelado"
                      }), E.discountPix > 0 ? n.jsxs(q, {
                        tone: "ok",
                        children: ["-", E.discountPct.toFixed(0), "% no PIX"]
                      }) : n.jsx(q, {
                        tone: "warn",
                        children: "Sem desc. PIX"
                      })]
                    })
                  }), n.jsxs("td", {
                    className: "row-actions",
                    children: [n.jsx("button", {
                      className: "btn sm",
                      onClick: () => se(E),
                      style: {
                        marginRight: 6
                      },
                      children: "Editar"
                    }), n.jsx("button", {
                      className: "btn sm danger",
                      onClick: () => oo(E.id),
                      children: "Excluir"
                    })]
                  })]
                }, E.id);
              })
            })]
          })
        })
      }) : n.jsx(M, {
        children: n.jsx(ae, {
          action: n.jsx("button", {
            className: "btn primary",
            onClick: () => R(Yo),
            children: "Restaurar ofertas demonstrativas"
          }),
          children: "Nenhuma loja cadastrada para este produto. Insira os links das lojas concorrentes acima para comparar."
        })
      })]
    }), (y || j) && n.jsx(MS, {
      item: y || {
        name: "",
        url: "",
        price_cash: 0,
        count: 1,
        installment: 0,
        interest: ""
      },
      title: y ? "Editar produto do lote" : "Adicionar produto manual",
      onClose: () => {
        f(null), m(!1);
      },
      onSave: E => {
        y ? w(E) : F(E);
      }
    }), de && n.jsx(DS, {
      offer: de,
      onClose: () => se(null),
      onSave: Kt
    })]
  });
}
function MS({
  item: e,
  title: t,
  onClose: s,
  onSave: a
}) {
  const [r, i] = S.useState({
      ...e
    }),
    o = (u, h) => i(p => ({
      ...p,
      [u]: h
    })),
    l = Number(r.count) || 1,
    c = l > 1 && r.installment > 0,
    d = c ? l * r.installment : r.price_cash;
  return n.jsx(sn, {
    title: t,
    onClose: s,
    footer: n.jsxs(n.Fragment, {
      children: [n.jsx("button", {
        className: "btn",
        onClick: s,
        children: "Cancelar"
      }), n.jsx("button", {
        className: "btn primary",
        disabled: !r.name.trim() || !(r.price_cash > 0 || c),
        onClick: () => a(r),
        children: "Salvar produto"
      })]
    }),
    children: n.jsxs("div", {
      className: "grid",
      children: [n.jsx(z, {
        label: "Nome do produto",
        className: "full",
        children: n.jsx("input", {
          value: r.name,
          onChange: u => o("name", u.target.value),
          placeholder: "Ex.: Monitor Ultrawide 29"
        })
      }), n.jsx(z, {
        label: "Link do produto (opcional)",
        className: "full",
        children: n.jsx("input", {
          type: "url",
          value: r.url || "",
          onChange: u => o("url", u.target.value),
          placeholder: "https://..."
        })
      }), n.jsx(z, {
        label: "Preço à vista (PIX)",
        children: n.jsx(_e, {
          value: r.price_cash,
          onChange: u => o("price_cash", u)
        })
      }), n.jsx(z, {
        label: "Quantidade de parcelas",
        children: n.jsx("input", {
          type: "number",
          min: "1",
          max: "48",
          value: r.count,
          onChange: u => o("count", Math.max(1, Number(u.target.value) || 1))
        })
      }), n.jsx(z, {
        label: "Valor de cada parcela",
        hint: l > 1 && !r.installment ? "Se não preencher, assume sem juros" : void 0,
        children: n.jsx(_e, {
          value: r.installment,
          onChange: u => o("installment", u)
        })
      }), n.jsx(z, {
        label: "Total a prazo calculado",
        children: n.jsx("input", {
          readOnly: !0,
          disabled: !0,
          value: x(d),
          style: {
            fontWeight: 600,
            background: "var(--panel)"
          }
        })
      })]
    })
  });
}
function DS({
  offer: e,
  onClose: t,
  onSave: s
}) {
  const [a, r] = S.useState({
      ...e
    }),
    i = (d, u) => r(h => ({
      ...h,
      [d]: u
    })),
    o = Number(a.installments_count) || 1,
    l = (o > 1 && a.installment_val > 0 ? o * a.installment_val : a.price_pix || 0) + (a.shipping || 0),
    c = (a.price_pix || 0) + (a.shipping || 0);
  return n.jsx(sn, {
    title: "Dados da Loja / Oferta Concorrente",
    onClose: t,
    footer: n.jsxs(n.Fragment, {
      children: [n.jsx("button", {
        className: "btn",
        onClick: t,
        children: "Cancelar"
      }), n.jsx("button", {
        className: "btn primary",
        disabled: !a.store.trim() || !(a.price_pix > 0 || a.installment_val > 0),
        onClick: () => s(a),
        children: "Salvar oferta"
      })]
    }),
    children: n.jsxs("div", {
      className: "grid",
      children: [n.jsx(z, {
        label: "Loja ou Site",
        children: n.jsx("input", {
          value: a.store,
          onChange: d => i("store", d.target.value),
          placeholder: "Ex.: Amazon, Magazine Luiza, Kabum"
        })
      }), n.jsx(z, {
        label: "Frete (R$)",
        children: n.jsx(_e, {
          value: a.shipping || 0,
          onChange: d => i("shipping", d)
        })
      }), n.jsx(z, {
        label: "Link da oferta (opcional)",
        className: "full",
        children: n.jsx("input", {
          type: "url",
          value: a.url || "",
          onChange: d => i("url", d.target.value),
          placeholder: "https://..."
        })
      }), n.jsx(z, {
        label: "Preço à vista no PIX",
        children: n.jsx(_e, {
          value: a.price_pix,
          onChange: d => i("price_pix", d)
        })
      }), n.jsx(z, {
        label: "Quantidade de parcelas",
        children: n.jsx("input", {
          type: "number",
          min: "1",
          max: "36",
          value: a.installments_count,
          onChange: d => i("installments_count", Math.max(1, Number(d.target.value) || 1))
        })
      }), n.jsx(z, {
        label: "Valor da parcela",
        children: n.jsx(_e, {
          value: a.installment_val,
          onChange: d => i("installment_val", d)
        })
      }), n.jsx(z, {
        label: "Total consolidado no PIX (com frete)",
        children: n.jsx("input", {
          readOnly: !0,
          disabled: !0,
          value: x(c),
          style: {
            fontWeight: 600,
            background: "var(--panel)"
          }
        })
      }), n.jsx(z, {
        label: "Total consolidado no Cartão (com frete)",
        children: n.jsx("input", {
          readOnly: !0,
          disabled: !0,
          value: x(l),
          style: {
            fontWeight: 600,
            background: "var(--panel)"
          }
        })
      }), n.jsx(z, {
        label: "Observações (opcional)",
        className: "full",
        children: n.jsx("input", {
          value: a.notes || "",
          onChange: d => i("notes", d.target.value),
          placeholder: "Ex.: Cupom de desconto aplicado, garantia estendida..."
        })
      })]
    })
  });
}

export default AS;
