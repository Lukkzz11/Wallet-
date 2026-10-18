# Wallet — guia do projeto

Aplicativo financeiro pessoal, **local e offline**, para Windows. Node.js (sem frameworks de servidor) + SQLite embutido (`node:sqlite`) + React/Vite. Usuário único. O guia de uso para o usuário está em `MANUAL.md`; este arquivo documenta código, regras e estado atual.

## Comandos
```
npm install            # react, react-dom, framer-motion, lucide-react, vite e plugin (servidor sem dependências)
npm run build          # compila a interface em web/dist
npm start              # servidor em 127.0.0.1:47821 (serve web/dist)
npm run dev:api / dev:web
npm test               # node:test, test/*.test.js (75 testes)
npm run build:installer  # gera WalletSetup.exe (precisa do Inno Setup 6)
```
Node 22+ (usa `node:sqlite`; flag `--disable-warning=ExperimentalWarning`). Dados em `%APPDATA%\WalletLucas` (banco `wallet.db`, `backups/`, `wallet-lucas.log`). A pasta mantém o nome antigo de propósito, para não perder dados.

## Arquitetura
```
server/
  index.js        http local 127.0.0.1; valida Host/Origin; token de senha; serve web/dist; backup diário no início
  routes.js       ~96 rotas (/api/...), tabela [método, regex, handler]; handlers podem ser async
  db.js           migrações (array MIGRATIONS, SCHEMA_VERSION = 11), tx(), helpers, backup automático "pre-migracao-vN"
  core/           funções PURAS e testáveis (sem I/O): dates, finance, withdrawal, projection, invest, cards
  services/       operações com o banco: ledger, planning, cards, house, connect, product, backup, auth, system, updater, views
web/src/          App.jsx (navegação), ui.jsx (componentes), charts.jsx (SVG próprio), importers.js (CSV/OFX/PDF), pages/*
launcher/         launcher.js (abre Edge/Chrome em modo app), WalletLucas.vbs, atualizar.js, instalar.ps1, build-installer.js
installer.iss     Inno Setup → WalletSetup.exe (embute runtime/node.exe)
test/             node:test
```
Porta de teste: **47990** (a 47821 pode estar com o app real do usuário aberto — nunca rodar testes/servidores de teste nela e nunca apontar testes para `%APPDATA%\WalletLucas` com escrita sem backup).

## Regras de domínio (invariantes — não quebrar)
- Valores **em centavos (inteiros)**; datas `AAAA-MM-DD`; moeda BRL.
- `entries` = receitas/despesas (`status` pending|paid). Pagar cria **uma** `movements` (índice UNIQUE por `entry_id`) → saldo. Previsto/pendente nunca altera saldo.
- Saldo da conta = saldo inicial + movimentos com data ≥ data de referência. Transferências não são receita/despesa.
- **Reservas** são marcações dentro das contas (não saem da conta); disponível = contas gastáveis − reservado. FGTS/poupança/reserva são contas não gastáveis.
- **Parcelas de cartão = dívidas (`debts.card_id`)** com parcelas em `entries` (`debt_id`, `installment_no`). Edição refaz só as pendentes (`regeneratePending`). Pagas preservadas. Sem tabela paralela → nada conta em duplicidade.
- **Parcela paga antes do cadastro**: `external_id = 'prepaid:<id>'`, sem movimento; fora de "gastos do mês" (`isPrepaid`). `markPrepaid` faz isso sob demanda; `unpay` limpa a marca.
- Compromissos do mês (`monthCommitments`): cada despesa em UM grupo (cartões > assinaturas > casa > outras), só o que **vence no mês**. Assinaturas = entradas registradas + cobranças previstas (`subscriptionCharges`, respeita `end_date`); registrar a cobrança avança `next_date` (não duplica).
- Aluguel do mês (recebido + previsto certo) abate a parcela da casa do mês (`rentToHouse` em `dashboard`): em "Total a Receber no Mês" entra só o que sobra (800 − 700 = 100). Aluguel é identificado por "aluguel" na categoria, descrição ou origem.
- Análise de link (`extractProduct`): ordem do preço = JSON-LD (Product/ProductGroup/AggregateOffer) > metadados > microdados `itemprop` > texto "à vista" > candidatos (JSON embutido e texto; valor mais repetido, marcado `price_confidence: 'estimado'`, com lista `price_candidates` para o usuário escolher). Parcela nunca vira preço; sem candidato o preço fica vazio (nada é inventado). "Compra nova" tem simulação inline (`PurchaseSim`: usa `/api/cards/simulate` e `/api/dashboard`; só leitura).
- Importação (CSV/OFX/PDF): a prévia é só no navegador; nada grava antes da confirmação; duplicidade por `external_id` + comparação data/valor/descrição (`checkImport`).
- Retirada/projeção: receitas incertas nunca entram; cenários conservador/equilibrado/flexível em `core/withdrawal.js`.
- Segurança: só `127.0.0.1`; senha com scrypt; `/api/open/*` exige chave; análise de links (`services/product.js`) bloqueia localhost/redes privadas/DNS desviado/portas estranhas e fixa o IP validado na conexão.
- Migrações **aditivas** (ADD COLUMN / novas tabelas / INSERT OR IGNORE). Nunca DROP em dados do usuário. "Limpar sistema" exige a frase `ZERAR SISTEMA` e faz backup opcional antes.

## Banco (SQLite, versão 11)
Tabelas: settings, accounts, categories, recurrences, recurrence_skips, cards, debts, subscriptions, entries, movements, reserves, reserve_movements, goals, house_loans, house_loan_updates, audit_log.
Histórico: v1 base · v2 cartões · v3 external_id · v4 card_id em entries (grade antiga) · v5 limite do cartão · v6 financiamento da casa · v7 marca "prepaid" · v8 aparência do cartão · v9 início/fim de assinaturas · v10–v11 categorias padrão adicionais (Life Surf, Aluguel (Casa), Financiamento (Casa), Pessoa Física).
Teste de migração em `test/cards.test.js` simula banco v1 → versão atual: **ao criar migração nova, atualize esse teste** (número da versão e DROP das colunas novas).

## Interface (navegação em `App.jsx`)
Painel completo (inicial, mensal/anual, `Summary.jsx`: 5 cards `Kpi` — Saldo Total Guardado, Total a Receber no Mês, Quanto gastei, Gastos Cartões & Assinaturas, A receber − Cartões & Assinaturas) · Meu dinheiro (saldo e gastos do dia, recebimentos, Casa) · Cartões (Novo cartão, Adicionar parcela, Cartões visuais) · Assinaturas · Compra nova (link de produto) · Compras em lote · Simuladores (Posso investir?, Compra parcelada com planilha mensal) · Conectar (importar arquivo, API local) · Mais ferramentas (hub: calendário, valores a receber, reservas, metas, projeção, análise, receitas, despesas, contas, dívidas, retirada, relatórios) · Configurações (preferências, categorias, senha, backup, atualizações, Limpar sistema).
`Home.jsx` é resquício e não é usado.
Visual: tema escuro "vidro" em `web/src/styles.css` (tokens em `:root`); `lucide-react` (ícones) e `framer-motion` (animações) são dependências de build. Sem tema claro (impressão sai em fundo branco).

## Identidade
Nome do app: **Wallet**. Ícone: `launcher/WalletLucas.ico` (multi-tamanho), `launcher/icone-wallet.png`, `web/public/favicon.png` e `logo.png`. Os nomes internos `WalletLucas.*` e a pasta de dados `%APPDATA%\WalletLucas` são mantidos de propósito (atalhos e dados existentes).

## Atualizar (clique duplo)
`Atualizar Wallet.vbs` → `launcher/atualizar.js`: compila a interface desta pasta (em `web/dist-novo`, só troca se compilar), fecha servidor e janela, faz backup consistente (`VACUUM INTO` → `backups/antes-atualizar_*.db`), copia server, web/dist, launcher, package.json e docs para `%LOCALAPPDATA%\Programs\Wallet` (guarda o antigo em `.antigo` e desfaz se falhar) e reabre. `WALLET_NO_OPEN=1` evita reabrir (testes). Não toca em runtime nem em dados. O VBS chama o Node direto (sem `cmd /c`) por causa do espaço em "Wallet Lucas".

## Versão e entrega (regra do usuário)
TODA mudança sobe a versão, **só em `package.json`** (o App lê `pkg.version`; `build-installer.js` passa `/DMyAppVersion` ao Inno Setup). Depois de `npm test` e `npm run build`, aplicar primeiro pelo **Atualizar Wallet** (`node launcher/atualizar.js "%LOCALAPPDATA%\Programs\Wallet"` com o Wallet fechado, ou o atalho da Área de Trabalho) e só então gerar `WalletSetup.exe`. O atualizador grava `launcher/origem.json` (pasta de origem); o app compara a versão instalada com a da origem (`services/localupdate.js`): faixa verde no topo e cartão em Configurações. O `Atualizar Wallet.vbs` mostra "versão instalada → nova" antes de confirmar.

## Armadilhas já encontradas
- Scripts de edição por linha de comando perdem `\d`/`\s` em regex: aconteceu em `routes.js` (mês de Cartões ignorado). Conferir com grep e ter teste HTTP para parâmetros de rota.
- Handlers `async` precisam de `await` em `server/index.js` (já corrigido).
- `FormModal` tem modo `inline`; `PayModal`/`EntryForm` são exportados de `Entries.jsx` e reutilizados.
- Em PowerShell desta máquina, comandos com `Remove-Item` em caminho com espaço são bloqueados; use Bash ou caminhos curtos.
- Servidor antigo ainda aberto não envia campos novos da API (ex.: `rentToHouse`): a interface precisa tolerar (já tolera) e o usuário deve rodar "Atualizar Wallet".

## Recuperação do código-fonte (17/10/2026)
O disco **E:** (Seagate ST2000DM001) passou a reportar setores defeituosos (evento 7 do Windows) e corrompeu cerca de metade dos arquivos de código do projeto original. O aplicativo instalado em `%LOCALAPPDATA%\Programs\Wallet` e os dados em `%APPDATA%\WalletLucas` (disco C:) ficaram intactos. O código-fonte foi reconstruído e hoje mora em **`C:\Wallet!`** (cópia de trabalho anterior em `C:\Users\Lucas Emanuel\Wallet-recuperado\final`): arquivos íntegros do E:, pasta instalada (server, launcher, dist) e reconstrução pelo histórico da conversa. `Compras em lote` (`BatchShopping.jsx`) foi regenerada a partir do código compilado (nomes internos abreviados; funcional). A comparação de textos da interface com o aplicativo instalado não achou nenhum texto faltando, o CSS compilado é idêntico (mesmo hash) e os 75 testes passam. **Não trabalhar mais no disco E:; manter o projeto em C:.**

## Estado atual
- **75 testes passando**, 0 falhas. Interface compila. Banco do usuário em v11 com backups automáticos de cada migração.
- Funcional e testado: contas, receitas/despesas/recorrências, transferências, assinaturas (início/fim/pausa), cartões visuais e parcelas, simulador com planilha, casa (financiamento) com aluguel abatendo a parcela, retirada, projeções, análises, relatórios, backup/restauração, importação CSV/OFX/PDF, análise de link, Limpar sistema, painel mensal/anual, instalador (`WalletSetup.exe`, com `runtime/node.exe`), atualizador por clique (`Atualizar Wallet`).
- **Itens adicionados por fora e que precisam de decisão do usuário** (não alterados):
  1. **Compras em lote** (`pages/BatchShopping.jsx`): inclui **dados de demonstração** (monitor, cadeira, "Smartphone Top de Linha (Exemplo)") carregáveis/restauráveis e usa **localStorage do navegador**, não o SQLite. Contraria as regras "sem dados fictícios permanentes" e "dados fora do navegador". Os testes de lote/comparador (`test/updates.test.js`) calculam a lógica dentro do próprio teste e não exercitam o código da tela.
  2. **Atualização automática pelo GitHub** (`services/updater.js` + Configurações): baixa sozinha o `WalletSetup.exe` e "Reiniciar e atualizar" o executa. o repositório padrão agora é `Lukkzz11/Wallet` (a conta do usuário no GitHub) e **não há verificação de hash nem de domínio**. Risco de executar código de origem não confiável; contradiz "sem internet". Recomendação: desligar o download automático, exigir confirmação, aceitar só URLs `github.com` do repositório configurado, conferir SHA-256 e não ter repositório padrão.
- **Pendências de teste manual (não verificáveis aqui):** PDFs reais de bancos; lojas reais na análise de link; instalador numa máquina limpa.
- **Limitações conhecidas:** importação de cartão vale para uma fatura por arquivo e não escolhe categoria; saldo devedor da casa é o valor informado (sem amortização calculada); parcelamento em links só é lido quando está no texto da página.
