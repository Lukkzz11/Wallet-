import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseCsv, parseOfx, parsePdfText, extractPdfText, detectInstallment, parseAmount, parseDate } from '../web/src/importers.js';

test('valores e datas brasileiros e de OFX', () => {
  assert.equal(parseAmount('R$ 1.234,56'), 123456);
  assert.equal(parseAmount('-45,90'), -4590);
  assert.equal(parseAmount('45,90 D'), -4590);
  assert.equal(parseAmount('(10,00)'), -1000);
  assert.equal(parseAmount('1,234.50'), 123450);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseDate('05/10/2026'), '2026-10-05');
  assert.equal(parseDate('20261005120000[-3:BRT]'), '2026-10-05');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('05/10'), null, 'sem ano não adivinha');
  assert.equal(parseDate('05/10', 2026), '2026-10-05');
});

test('parcelas só são detectadas quando o texto traz o padrão (não inventa)', () => {
  assert.deepEqual(detectInstallment('LOJA X PARC 03/10'), { current: 3, total: 10 });
  assert.deepEqual(detectInstallment('Magazine 2 de 6'), { current: 2, total: 6 });
  assert.equal(detectInstallment('Supermercado'), null);
  assert.equal(detectInstallment('Compra 1/1'), null);
  assert.equal(detectInstallment('Ref 13/12'), null);
});

test('CSV: delimitador, cabeçalho, sinais e linhas inválidas', () => {
  const csv = 'Data;Descrição;Valor;Identificador\n05/10/2026;Mercado;-45,90;A1\n06/10/2026;Salário;3.000,00;A2\nxx;ruim;1,00;A3\n';
  const r = parseCsv(csv);
  assert.deepEqual(r.rows, [
    { date: '2026-10-05', description: 'Mercado', amount: -4590, id: 'A1' },
    { date: '2026-10-06', description: 'Salário', amount: 300000, id: 'A2' },
  ]);
  assert.deepEqual(r.bad, [4]);
  assert.equal(parseCsv('2026-10-05,Café,-9.50').rows[0].amount, -950);
});

test('OFX SGML e XML: lê data, valor, FITID, descrição e identifica cartão', () => {
  const sgml = `OFXHEADER:100
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003000000[-3:BRT]<TRNAMT>-150.00<FITID>2026100301<MEMO>LOJA ABC PARC 02/04
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261004<TRNAMT>200.00<FITID>2026100402<NAME>PAGAMENTO FATURA
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const r = parseOfx(sgml);
  assert.equal(r.kind, 'card');
  assert.deepEqual(r.rows.map((x) => [x.date, x.amount, x.id, x.description]), [
    ['2026-10-03', -15000, '2026100301', 'LOJA ABC PARC 02/04'],
    ['2026-10-04', 20000, '2026100402', 'PAGAMENTO FATURA'],
  ]);
  const xml = '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><DTPOSTED>20260110</DTPOSTED><TRNAMT>-12.34</TRNAMT><FITID>X1</FITID><NAME>Padaria</NAME></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const x = parseOfx(xml);
  assert.equal(x.kind, 'bank');
  assert.equal(x.rows[0].amount, -1234);
});

function fakePdf(lines, { compress = true } = {}) {
  const content = `BT\n/F1 10 Tf\n${lines.map((l, i) => `1 0 0 1 40 ${700 - i * 14} Tm\n0 -14 Td\n(${l.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')}\nET`;
  const body = compress ? zlib.deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  return Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'), body, Buffer.from('\nendstream\nendobj\n%%EOF')]);
}
const inflate = async (b) => zlib.inflateSync(Buffer.from(b));

test('PDF com texto: extrai linhas e interpreta datas e valores; ilegível devolve vazio para revisão manual', async () => {
  const pdf = fakePdf(['EXTRATO CONTA', '05/10/2026 MERCADO CENTRAL 45,90 D', '06/10/2026 SALARIO 3.000,00 C', 'Saldo final 100,00']);
  const text = await extractPdfText(pdf, inflate);
  assert.match(text, /MERCADO CENTRAL/);
  const r = parsePdfText(text, 2026);
  assert.deepEqual(r.rows.map((x) => [x.date, x.description, x.amount]), [['2026-10-05', 'MERCADO CENTRAL', -4590], ['2026-10-06', 'SALARIO', 300000]]);
  const plain = await extractPdfText(fakePdf(['10/10 FARMACIA 20,00'], { compress: false }), inflate);
  assert.deepEqual(parsePdfText(plain, 2026).rows[0], { date: '2026-10-10', description: 'FARMACIA', amount: 2000 });
  assert.equal(await extractPdfText(Buffer.from('%PDF-1.4 sem texto'), inflate), '');
  assert.equal(parsePdfText('linha sem data\nsó texto').rows.length, 0);
});
