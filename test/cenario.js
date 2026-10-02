'use strict';
const assert = require('node:assert');

function cliente(base) {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
}
const dia = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

async function cenario(base) {
  const adm = cliente(base);
  assert.strictEqual((await adm('GET', '/api/processos')).status, 401);
  assert.strictEqual((await adm('POST', '/api/login', { login: 'admin', senha: 'errada' })).status, 401);
  assert.strictEqual((await adm('POST', '/api/login', { login: 'admin', senha: 'admin123' })).status, 200);
  // troca de senha obrigatória
  assert.strictEqual((await adm('GET', '/api/processos')).status, 403);
  assert.strictEqual((await adm('POST', '/api/me/senha', { atual: 'admin123', nova: 'curta' })).status, 400);
  assert.strictEqual((await adm('POST', '/api/me/senha', { atual: 'admin123', nova: 'Segura2026' })).status, 200);

  // CSRF: sem cabeçalho é rejeitado
  const r = await fetch(base + '/api/processos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(r.status, 403);

  const c = await adm('POST', '/api/usuarios', { nome: 'Maria Souza', login: 'maria', perfil: 'usuario', senha: 'Provis0ria' });
  assert.strictEqual(c.status, 200);
  assert.strictEqual((await adm('POST', '/api/usuarios', { nome: 'X', login: 'maria', perfil: 'usuario', senha: 'Provis0ria' })).status, 400);

  const maria = cliente(base);
  assert.strictEqual((await maria('POST', '/api/login', { login: 'maria', senha: 'Provis0ria' })).status, 200);
  assert.strictEqual((await maria('POST', '/api/me/senha', { atual: 'Provis0ria', nova: 'Maria2026x' })).status, 200);
  assert.strictEqual((await maria('GET', '/api/auditoria')).status, 403);
  assert.strictEqual((await maria('POST', '/api/usuarios', {})).status, 403);

  const p1 = await maria('POST', '/api/processos', { numero: '1DOC-0001', assunto: 'Transporte escolar', tipo: 'Transporte escolar', data_abertura: dia(-10), prazo: dia(-3) });
  const p2 = await maria('POST', '/api/processos', { numero: '1DOC-0002', assunto: 'Merenda', prazo: dia(0) });
  const p3 = await maria('POST', '/api/processos', { numero: '1DOC-0003', assunto: 'Reforma', prazo: dia(3) });
  const p4 = await maria('POST', '/api/processos', { numero: '1DOC-0004', assunto: 'Longe', prazo: dia(30) });
  assert.strictEqual(p1.body.numero, '1DOC-0001');
  assert.strictEqual((await maria('POST', '/api/processos', { numero: '1doc-0001', assunto: 'Duplicado' })).status, 400);
  assert.strictEqual((await maria('POST', '/api/processos', { assunto: 'Sem número' })).status, 400);
  assert.strictEqual((await maria('POST', '/api/processos', { numero: 'X1', assunto: '' })).status, 400);
  assert.strictEqual((await maria('POST', '/api/processos', { numero: 'X2', assunto: 'x', prazo: '2000-01-01' })).status, 400);

  const lista = (await maria('GET', '/api/processos')).body;
  const sit = Object.fromEntries(lista.map((p) => [p.assunto, p.situacao]));
  assert.deepStrictEqual(sit, { 'Transporte escolar': 'vencido', Merenda: 'hoje', Reforma: 'proximo', Longe: 'no_prazo' });
  assert.strictEqual((await maria('GET', '/api/processos?prazo=vencidos')).body.length, 1);
  assert.strictEqual((await maria('GET', '/api/processos?prazo=alerta')).body.length, 2);
  assert.strictEqual((await maria('GET', '/api/alertas')).body.itens.length, 3);
  const painel = (await maria('GET', '/api/painel')).body;
  assert.strictEqual(painel.vencidos, 1); assert.strictEqual(painel.hoje, 1); assert.strictEqual(painel.proximos, 1);

  // concluir tira dos alertas
  assert.strictEqual((await maria('POST', `/api/processos/${p1.body.id}/status`, { status: 'Concluído' })).status, 200);
  assert.strictEqual((await maria('GET', '/api/alertas')).body.itens.length, 2);
  const det = (await maria('GET', `/api/processos/${p1.body.id}`)).body;
  assert.strictEqual(det.situacao, 'encerrado'); assert.ok(det.movimentacoes.length >= 2);

  // permissões: outro usuário não edita processo alheio; só admin exclui
  await adm('POST', '/api/usuarios', { nome: 'João', login: 'joao', perfil: 'usuario', senha: 'Provis0ria' });
  const joao = cliente(base); await joao('POST', '/api/login', { login: 'joao', senha: 'Provis0ria' }); await joao('POST', '/api/me/senha', { atual: 'Provis0ria', nova: 'Joao2026xx' });
  assert.strictEqual((await joao('PUT', `/api/processos/${p4.body.id}`, { assunto: 'Hack' })).status, 403);
  assert.strictEqual((await joao('POST', `/api/processos/${p4.body.id}/movimentacoes`, { texto: 'Comentário' })).status, 200);
  assert.strictEqual((await maria('DELETE', `/api/processos/${p4.body.id}`)).status, 403);
  assert.strictEqual((await adm('DELETE', `/api/processos/${p4.body.id}`)).status, 200);

  // desativar usuário derruba a sessão
  const uid = (await adm('GET', '/api/usuarios')).body.find((u) => u.login === 'joao').id;
  assert.strictEqual((await adm('PUT', `/api/usuarios/${uid}`, { ativo: false })).status, 200);
  assert.strictEqual((await joao('GET', '/api/processos')).status, 401);
  assert.strictEqual((await adm('GET', '/api/exportar.csv')).status, 200);
  assert.ok((await adm('GET', '/api/auditoria')).body.length > 5);
}

module.exports = { cenario };
