// Análise de link de produto: busca a página e extrai nome, imagem e preços. Só usa o que a página realmente informa.
// Segurança: só http/https; bloqueia localhost e redes privadas (inclusive por DNS e a cada redirecionamento);
// a conexão usa o IP já validado (evita troca de DNS). Sem APIs pagas.
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { bad } from '../util.js';

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
    if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return isPrivateAddress([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.')); }
    const h = parseInt(x.split(':')[0] || '0', 16);
    return (h & 0xfe00) === 0xfc00 || (h & 0xffc0) === 0xfe80 || (h & 0xff00) === 0xff00;
  }
  return true; // formato desconhecido: bloqueia
}

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
export async function assertPublicUrl(raw, { lookup = dns.lookup, allowPrivate = false } = {}) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { throw bad('Link inválido. Cole o endereço completo, começando com https://'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw bad('Use um link http:// ou https://.');
  if (u.username || u.password) throw bad('Links com usuário e senha não são aceitos.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowPrivate) {
    if (!ALLOWED_PORTS.has(u.port)) throw bad('Porta não permitida nesta análise.');
    if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || (!host.includes('.') && !net.isIP(host))) throw bad('Endereços locais ou privados não são permitidos.');
  }
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIPv4(host) ? 4 : 6 }];
  else {
    try { addrs = await lookup(host, { all: true }); } catch { throw bad('Não consegui encontrar o endereço deste site.'); }
  }
  if (!addrs?.length) throw bad('Não consegui encontrar o endereço deste site.');
  if (!allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) throw bad('Este endereço aponta para uma rede local ou privada e foi bloqueado por segurança.');
  return { url: u, address: addrs[0].address, family: addrs[0].family };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
function request({ url, address, family }, { timeout = 10000, maxBytes = 3e6 } = {}) {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, method: 'GET', timeout,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5', 'Accept-Encoding': 'gzip, deflate, br' },
      lookup: (_h, o, cb) => (o && o.all ? cb(null, [{ address, family }]) : cb(null, address, family)), // conecta só no IP validado
    }, (res) => {
      const chunks = []; let size = 0; let truncated = false;
      res.on('data', (d) => { size += d.length; if (size > maxBytes) { truncated = true; req.destroy(); } else chunks.push(d); });
      const done = () => {
        let body = Buffer.concat(chunks);
        try {
          const enc = (res.headers['content-encoding'] || '').toLowerCase();
          if (enc === 'gzip') body = zlib.gunzipSync(body, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
          else if (enc === 'br') body = zlib.brotliDecompressSync(body);
          else if (enc === 'deflate') body = zlib.inflateSync(body);
        } catch { /* corpo parcial: usa o que houver */ }
        resolve({ status: res.statusCode, headers: res.headers, body, truncated });
      };
      res.on('end', done); res.on('close', done);
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao acessar o site.')));
    req.on('error', (e) => reject(bad(`Não foi possível acessar o site: ${e.message}`)));
    req.end();
  });
}

/* ---------- extração ---------- */
const ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decode = (s) => String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).trim();

export function toCents(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (ld >= 0 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const metaContent = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[:.]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  if (!tag) return null;
  return decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '') || null;
};

function jsonLdNodes(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { out.push(n); if (n['@graph']) walk(n['@graph']); } };
    walk(data);
  }
  return out;
}
const isType = (n, t) => [].concat(n['@type'] ?? []).some((x) => String(x).toLowerCase() === t);
const firstImage = (img) => (Array.isArray(img) ? firstImage(img[0]) : typeof img === 'object' && img ? img.url || img.contentUrl : img) || null;

export function extractProduct(html, baseUrl) {
  const src = {};
  let name = null, image = null, price = null, currency = null, availability = null, exact = false;
  const nodes = jsonLdNodes(html);
  let prod = nodes.find((n) => isType(n, 'product'));
  if (!prod) { const g = nodes.find((n) => isType(n, 'productgroup')); if (g) prod = { ...g, offers: g.offers ?? [].concat(g.hasVariant ?? []).flatMap((v) => [].concat(v?.offers ?? [])) }; }
  if (prod) {
    if (prod.name) { name = decode(prod.name); src.name = 'dados estruturados (JSON-LD)'; }
    const im = firstImage(prod.image);
    if (im) { image = im; src.image = 'dados estruturados (JSON-LD)'; }
    const offers = [].concat(prod.offers ?? []).flatMap((o) => (o && o.offers ? [].concat(o.offers) : [o])).filter(Boolean);
    const specPrice = (o) => [].concat(o.priceSpecification ?? []).map((x) => toCents(x?.price)).find(Boolean);
    const withPrice = offers.map((o) => ({ o, p: toCents(o.price) ?? toCents(o.lowPrice) ?? specPrice(o) })).filter((x) => x.p);
    const best = withPrice.find((x) => /instock/i.test(String(x.o.availability))) || withPrice[0];
    if (best) { price = best.p; currency = best.o.priceCurrency || [].concat(best.o.priceSpecification ?? [])[0]?.priceCurrency || null; availability = best.o.availability ? String(best.o.availability).split('/').pop() : null; src.price_cash = 'dados estruturados (JSON-LD)'; exact = true; }
  }
  if (!name) { const v = metaContent(html, 'og:title') || metaContent(html, 'twitter:title'); if (v) { name = v; src.name = 'metadados da página (og:title)'; } }
  if (!name) { const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]; if (t) { name = decode(t); src.name = 'título da página'; } }
  if (!image) { const v = metaContent(html, 'og:image') || metaContent(html, 'twitter:image'); if (v) { image = v; src.image = 'metadados da página (og:image)'; } }
  if (!price) {
    const v = metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount') || metaContent(html, 'price');
    if (toCents(v)) { price = toCents(v); currency = currency || metaContent(html, 'product:price:currency') || metaContent(html, 'og:price:currency'); src.price_cash = 'metadados da página'; exact = true; }
  }
  if (!price) { // microdata: <span itemprop="price" content="1299.90">
    const tag = /<[a-z0-9]+[^>]+itemprop=["']price["'][^>]*>/i.exec(html)?.[0];
    const v = tag && /content=["']([^"']+)["']/i.exec(tag)?.[1];
    if (toCents(v)) { price = toCents(v); src.price_cash = 'microdados da página (itemprop)'; exact = true; }
  }
  const text = decode(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  if (!price) {
    const m = /R\$\s*([\d.]+,\d{2})\s*(?:à vista|a vista|no pix|no boleto)/i.exec(text) || /(?:à vista|a vista|no pix|no boleto)[^R\d]{0,12}R\$\s*([\d.]+,\d{2})/i.exec(text);
    if (m && toCents(m[1])) { price = toCents(m[1]); src.price_cash = 'texto da página (preço à vista)'; exact = true; }
  }
  // candidatos: outros valores que a página mostra (ajudam quando o preço exato não está nos metadados)
  const cand = new Map();
  const addCand = (v, source) => { if (v && v >= 100 && v < 5e8) { const c = cand.get(v); if (c) c.n++; else cand.set(v, { value: v, source, n: 1 }); } };
  for (const m of html.matchAll(/<script(?![^>]*ld\+json)[^>]*>([\s\S]{0,1500000}?)<\/script>/gi)) {
    for (const k of m[1].matchAll(/["'](?:salePrice|bestPrice|sellingPrice|priceValue|currentPrice|finalPrice|spotPrice|cashPrice|price)["']\s*:\s*["']?(\d{1,3}(?:\.\d{3})*,\d{1,2}|\d{1,6}\.\d{1,2}|\d{2,6})["']?/gi)) {
      if (!/[.,]\d{1,2}$/.test(k[1]) && Number(k[1]) >= 100000) continue; // inteiro grande: pode estar em centavos
      addCand(toCents(k[1]), 'dados embutidos na página');
    }
  }
  for (const m of text.slice(0, 60000).matchAll(/R\$\s*([\d.]+,\d{2})/g)) addCand(toCents(m[1]), 'texto da página');
  // parcelamento anunciado no texto: "10x de R$ 99,90 sem juros" (usa a maior quantidade encontrada)
  let installments = null;
  for (const m of text.matchAll(/(\d{1,2})\s*[xX]\s*(?:(sem|com)\s+juros\s+)?(?:de\s+)?R\$\s*([\d.]+,\d{2})(\s*(sem|com)\s+juros)?/gi)) {
    const count = Number(m[1]), value = toCents(m[3]);
    const j = (m[5] || m[2] || '').toLowerCase();
    if (count >= 2 && count <= 36 && value && (!installments || count > installments.count)) installments = { count, value, interest: j ? (j === 'sem' ? 'sem juros' : 'com juros') : null };
  }
  if (installments) {
    src.installments = 'texto da página';
    const total = installments.count * installments.value;
    // diferença entre as parcelas e o preço à vista (derivada dos números da página; não é taxa de juros)
    if (price && total > price * 1.005) installments.extra_total = total - price;
  }
  // sem preço exato: usa o valor mais repetido entre os candidatos e marca como estimado
  let confidence = price ? (exact ? 'exato' : 'estimado') : null;
  const instValues = new Set(installments ? [installments.value] : []);
  const candidates = [...cand.values()].filter((c) => !instValues.has(c.value)).sort((a, b) => b.n - a.n).slice(0, 5).map(({ value, source }) => ({ value, source }));
  if (!price && candidates.length) { price = candidates[0].value; src.price_cash = `${candidates[0].source} (estimado)`; confidence = 'estimado'; }
  if (installments) {
    const total = installments.count * installments.value;
    if (price && total > price * 1.005) installments.extra_total = total - price; else delete installments.extra_total;
  }
  let imageUrl = image;
  try { if (image) imageUrl = new URL(image, baseUrl).toString(); } catch { imageUrl = null; }
  return { name: name || null, image: imageUrl && /^https?:/i.test(imageUrl) ? imageUrl : null, currency, price_cash: price, price_confidence: confidence, price_candidates: candidates, availability, installments, sources: src };
}

function notesFor(p, status) {
  const n = [];
  if (!p.name) n.push('Não encontrei o nome do produto.');
  if (!p.price_cash) n.push('Não encontrei o preço à vista. Informe manualmente.');
  else if (p.price_confidence === 'estimado') n.push('O preço não estava nos dados estruturados da página; usei o valor que mais aparece nela. Confira com a loja ou escolha outro valor encontrado.');
  if (p.currency && p.currency !== 'BRL') n.push(`A página informa moeda ${p.currency}, não reais.`);
  if (!p.installments) n.push('Não encontrei o parcelamento (quantidade e valor da parcela). Informe manualmente, se for parcelar.');
  else if (!p.installments.interest) n.push('A página não diz se o parcelamento tem juros.');
  else if (p.installments.interest === 'com juros') n.push('O parcelamento tem juros, mas a taxa não está na página: a diferença mostrada vem só dos valores informados.');
  if (!p.image) n.push('Não encontrei uma imagem.');
  if (status) n.unshift(status);
  return n;
}

const BLOCK_HINT = /captcha|access denied|acesso negado|are you a robot|cf-chl|verifying you are human|unusual traffic|bot detection/i;

function findBrowser() {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const r of ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']) for (const b of bases) { const p = path.join(b, r); if (fs.existsSync(p)) return p; }
  return null;
}
// Opcional (pedido pelo usuário): carrega a página num navegador sem janela, local, para lojas que montam o preço com JavaScript.
export function renderWithBrowser(url, { timeout = 30000, maxBytes = 5e6 } = {}) {
  const exe = findBrowser();
  if (!exe) return Promise.reject(bad('Não encontrei o Edge ou o Chrome para a leitura avançada.'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-browser-'));
  return new Promise((resolve) => {
    const child = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${dir}`, '--virtual-time-budget=10000', '--dump-dom', url], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks = []; let size = 0;
    const finish = (v) => { clearTimeout(t); try { child.kill(); } catch { /* já encerrado */ } fs.rm(dir, { recursive: true, force: true }, () => {}); resolve(v); };
    const t = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), timeout);
    child.stdout.on('data', (d) => { size += d.length; if (size < maxBytes) chunks.push(d); });
    child.on('close', () => finish(Buffer.concat(chunks).toString('utf8')));
    child.on('error', () => finish(''));
  });
}

export async function analyzeProduct(rawUrl, { browser = false, allowPrivate = false, lookup = dns.lookup, fetchRendered = renderWithBrowser } = {}) {
  let target = String(rawUrl ?? '').trim();
  let res = null, finalUrl = null;
  for (let hop = 0; hop < 6; hop++) {
    const pub = await assertPublicUrl(target, { lookup, allowPrivate }); // valida o link e CADA redirecionamento
    res = await request(pub);
    finalUrl = pub.url.toString();
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) { target = new URL(res.headers.location, pub.url).toString(); continue; }
    break;
  }
  if (res && [301, 302, 303, 307, 308].includes(res.status)) throw bad('Redirecionamentos demais ao acessar o link.');
  const empty = { name: null, image: null, currency: null, price_cash: null, price_confidence: null, price_candidates: [], availability: null, installments: null, sources: {} };
  const ctype = String(res.headers['content-type'] || '');
  if (res.status >= 400) {
    return { url: rawUrl, final_url: finalUrl, ok: false, blocked: [401, 403, 429, 503].includes(res.status), status: res.status, product: empty,
      notes: notesFor(empty, `A loja respondeu ${res.status}${[401, 403, 429, 503].includes(res.status) ? ' e provavelmente bloqueia leitura automática' : ''}. Preencha os campos manualmente.`) };
  }
  if (!/html|xml/i.test(ctype) && ctype) return { url: rawUrl, final_url: finalUrl, ok: false, blocked: false, status: res.status, product: empty, notes: notesFor(empty, `O link não é uma página (tipo ${ctype.split(';')[0]}). Preencha manualmente.`) };
  const charset = /charset=([\w-]+)/i.exec(ctype)?.[1] || /<meta[^>]+charset=["']?([\w-]+)/i.exec(res.body.subarray(0, 4096).toString('latin1'))?.[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(charset).decode(res.body); } catch { html = res.body.toString('utf8'); }
  let product = extractProduct(html, finalUrl);
  let usedBrowser = false;
  if (!product.price_cash && browser) {
    const dom = await fetchRendered(finalUrl);
    if (dom) { usedBrowser = true; const p2 = extractProduct(dom, finalUrl); product = { ...product, ...Object.fromEntries(Object.entries(p2).filter(([k, v]) => k !== 'sources' && v != null && product[k] == null)), sources: { ...product.sources, ...p2.sources } }; }
  }
  const blocked = !product.price_cash && !product.name && BLOCK_HINT.test(html.slice(0, 20000));
  const status = blocked ? 'A página parece pedir verificação (captcha/bloqueio de robôs). Preencha manualmente.'
    : !product.price_cash && !browser ? 'Se o preço não aparece, a loja pode carregá-lo por JavaScript: use "Tentar com navegador local" ou preencha manualmente.' : null;
  return { url: rawUrl, final_url: finalUrl, ok: !!(product.name || product.price_cash), blocked, status: res.status, used_browser: usedBrowser, truncated: res.truncated, product, notes: notesFor(product, status) };
}
