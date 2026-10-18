import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { isPrivateAddress, assertPublicUrl, extractProduct, analyzeProduct, toCents } from '../server/services/product.js';

test('endereços privados e locais são reconhecidos', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.5.1', '172.31.255.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('links inseguros são recusados antes de qualquer acesso', async () => {
  const pub = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(assertPublicUrl('not a url'), /inválido/);
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /http/);
  await assert.rejects(assertPublicUrl('ftp://loja.com/x'), /http/);
  await assert.rejects(assertPublicUrl('http://user:pw@loja.com/'), /usuário/);
  await assert.rejects(assertPublicUrl('http://localhost/'), /locais/);
  await assert.rejects(assertPublicUrl('http://app.localhost/'), /locais/);
  await assert.rejects(assertPublicUrl('http://intranet/'), /locais/);
  await assert.rejects(assertPublicUrl('http://servidor.local/'), /locais/);
  await assert.rejects(assertPublicUrl('http://127.0.0.1:47821/api/accounts'), /Porta|privada/);
  await assert.rejects(assertPublicUrl('http://127.0.0.1/'), /privada/);
  await assert.rejects(assertPublicUrl('http://[::1]/'), /privada/);
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'), /privada/);
  await assert.rejects(assertPublicUrl('http://10.0.0.8/'), /privada/);
  await assert.rejects(assertPublicUrl('https://loja.com:22/'), /Porta/);
  // nome público que resolve para endereço privado (DNS apontando para dentro de casa)
  await assert.rejects(assertPublicUrl('https://evil.example.com/', { lookup: async () => [{ address: '192.168.0.5', family: 4 }] }), /privada/);
  await assert.rejects(assertPublicUrl('https://misto.example.com/', { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }] }), /privada/);
  const ok = await assertPublicUrl('https://loja.com/produto', { lookup: pub });
  assert.equal(ok.address, '93.184.216.34');
});

test('preços: formatos brasileiros e internacionais', () => {
  assert.equal(toCents('1299.90'), 129990);
  assert.equal(toCents('1.299,90'), 129990);
  assert.equal(toCents('R$ 99,90'), 9990);
  assert.equal(toCents(2599), 259900);
  assert.equal(toCents('1,299.50'), 129950);
  assert.equal(toCents('1.299'), 129900);
  assert.equal(toCents(''), null);
  assert.equal(toCents('abc'), null);
  assert.equal(toCents(0), null);
});

const PAGE = `<html><head><title>Loja X - Notebook</title>
<meta property="og:title" content="Notebook Pro 14&quot;"><meta property="og:image" content="/img/nb.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Notebook Pro 14\\" 16GB","image":["https://cdn.loja.com/nb1.jpg"],"offers":{"@type":"Offer","price":"4299.90","priceCurrency":"BRL","availability":"https://schema.org/InStock"}}]}</script>
</head><body><h1>Notebook</h1><p>R$ 4.299,90 à vista</p><p>ou em até 10x de R$ 459,90 com juros</p><p>3x de R$ 1.433,30 sem juros</p></body></html>`;

test('extrai nome, imagem, preço à vista e parcelamento sem inventar o que não existe', () => {
  const p = extractProduct(PAGE, 'https://loja.com/p/1');
  assert.equal(p.name, 'Notebook Pro 14" 16GB');
  assert.equal(p.image, 'https://cdn.loja.com/nb1.jpg');
  assert.equal(p.price_cash, 429990);
  assert.equal(p.currency, 'BRL');
  assert.equal(p.availability, 'InStock');
  assert.deepEqual([p.installments.count, p.installments.value, p.installments.interest], [10, 45990, 'com juros']);
  assert.equal(p.installments.extra_total, 10 * 45990 - 429990, 'diferença derivada dos números (não é taxa)');
  assert.equal(p.sources.price_cash, 'dados estruturados (JSON-LD)');
  // sem dados estruturados: usa metadados e texto
  const og = extractProduct('<head><meta property="og:title" content="Fone"><meta property="og:image" content="/f.png"><meta property="product:price:amount" content="199.90"></head><body>6x de R$ 33,32 sem juros</body>', 'https://loja.com/a/b');
  assert.deepEqual([og.name, og.image, og.price_cash, og.installments.interest], ['Fone', 'https://loja.com/f.png', 19990, 'sem juros']);
  assert.equal(og.installments.extra_total, undefined, 'diferença de arredondamento (R$ 0,02) não é tratada como juros');
  // página sem nada útil
  const vazio = extractProduct('<html><body>Olá</body></html>', 'https://loja.com');
  assert.deepEqual([vazio.name, vazio.price_cash, vazio.installments, vazio.image], [null, null, null, null]);
});

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('busca a página (com redirecionamento e gzip), trata bloqueios e conteúdo que não é página', async () => {
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/curto') { res.writeHead(302, { Location: '/produto' }); return res.end(); }
    if (req.url === '/produto') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' }); return res.end(zlib.gzipSync(PAGE)); }
    if (req.url === '/bloqueado') { res.writeHead(403, { 'Content-Type': 'text/html' }); return res.end('Access Denied'); }
    if (req.url === '/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF'); }
    if (req.url === '/captcha') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body>Please complete the captcha to continue</body></html>'); }
    if (req.url === '/sem-preco') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><head><title>Loja</title></head><body>carregando…</body></html>'); }
    res.writeHead(404); return res.end();
  });
  try {
    const ok = await analyzeProduct(`${base}/curto`, { allowPrivate: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.final_url, `${base}/produto`);
    assert.equal(ok.product.price_cash, 429990);
    const blocked = await analyzeProduct(`${base}/bloqueado`, { allowPrivate: true });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, true);
    assert.match(blocked.notes.join(' '), /bloqueia|403/);
    assert.equal(blocked.product.price_cash, null);
    assert.match((await analyzeProduct(`${base}/pdf`, { allowPrivate: true })).notes.join(' '), /não é uma página/);
    const cap = await analyzeProduct(`${base}/captcha`, { allowPrivate: true });
    assert.equal(cap.blocked, true);
    const semPreco = await analyzeProduct(`${base}/sem-preco`, { allowPrivate: true });
    assert.equal(semPreco.product.price_cash, null);
    assert.match(semPreco.notes.join(' '), /Não encontrei o preço à vista/);
    assert.match(semPreco.notes.join(' '), /JavaScript/);
    // navegador local (injetado no teste): usado só quando pedido e quando falta o preço
    let called = 0;
    const viaBrowser = await analyzeProduct(`${base}/sem-preco`, { allowPrivate: true, browser: true, fetchRendered: async () => { called++; return '<html><head><title>Loja</title></head><body>R$ 50,00 à vista</body></html>'; } });
    assert.equal(called, 1);
    assert.equal(viaBrowser.product.price_cash, 5000);
    assert.equal(viaBrowser.used_browser, true);
    await analyzeProduct(`${base}/produto`, { allowPrivate: true, browser: true, fetchRendered: async () => { called++; return ''; } });
    assert.equal(called, 1, 'não usa o navegador quando a página já trouxe o preço');
  } finally { srv.close(); }
});

test('sem allowPrivate, o servidor local de teste é bloqueado (SSRF)', async () => {
  const { srv, base } = await serve((req, res) => res.end('segredo'));
  try {
    await assert.rejects(analyzeProduct(`${base}/`), /Porta|privada|locais/);
  } finally { srv.close(); }
});

test('preço em mais formatos de página: microdados, grupo de variantes, JSON embutido (estimado) e candidatos', () => {
  // microdados
  const micro = extractProduct('<html><body><h1>Cadeira</h1><span itemprop="price" content="899.90">R$ 899,90</span></body></html>', 'https://loja.com/c');
  assert.deepEqual([micro.price_cash, micro.price_confidence], [89990, 'exato']);
  assert.equal(micro.sources.price_cash, 'microdados da página (itemprop)');
  // grupo de variantes com preço mínimo
  const grupo = extractProduct('<script type="application/ld+json">{"@type":"ProductGroup","name":"Tênis","hasVariant":[{"@type":"Product","offers":{"@type":"Offer","price":"349.00","priceCurrency":"BRL"}}]}</script>', 'https://loja.com/t');
  assert.deepEqual([grupo.name, grupo.price_cash, grupo.price_confidence], ['Tênis', 34900, 'exato']);
  const agg = extractProduct('<script type="application/ld+json">{"@type":"Product","name":"Mesa","offers":{"@type":"AggregateOffer","lowPrice":"1200.00","highPrice":"1500.00"}}</script>', 'https://loja.com/m');
  assert.equal(agg.price_cash, 120000);
  // preço à vista escrito antes do valor
  const rev = extractProduct('<body>À vista: R$ 2.500,00 ou 10x de R$ 280,00</body>', 'https://loja.com/r');
  assert.deepEqual([rev.price_cash, rev.price_confidence, rev.installments.count], [250000, 'exato', 10]);
  // sem metadados: usa o valor mais repetido e marca como estimado, listando os outros
  const emb = extractProduct('<html><body><script>window.__S={"product":{"price":1999.9},"related":[{"price":59.9}],"cur":{"salePrice":1999.9}}</script><p>Por R$ 1.999,90</p><p>6x de R$ 333,32 sem juros</p></body></html>', 'https://loja.com/e');
  assert.equal(emb.price_cash, 199990);
  assert.equal(emb.price_confidence, 'estimado');
  assert.ok(emb.sources.price_cash.includes('estimado'));
  assert.deepEqual(emb.price_candidates.map((c) => c.value), [199990, 5990]);
  // valor da parcela nunca vira candidato a preço
  assert.ok(!emb.price_candidates.some((c) => c.value === 33332));
  // nada de inventar: só parcela, sem preço
  const so = extractProduct('<body>12x de R$ 83,25 sem juros</body>', 'https://loja.com/s');
  assert.deepEqual([so.price_cash, so.price_confidence, so.price_candidates], [null, null, []]);
  // formato "10x sem juros de R$ ..."
  const f = extractProduct('<body>R$ 999,00 à vista. Em 10x sem juros de R$ 99,90</body>', 'https://loja.com/f');
  assert.deepEqual([f.installments.count, f.installments.value, f.installments.interest], [10, 9990, 'sem juros']);
});
