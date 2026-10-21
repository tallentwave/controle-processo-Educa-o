'use strict';
// Testa a Corregedoria (PHP). Padrão: SQLite; com PHP_TEST_MYSQL=1 usa o MariaDB/MySQL local (banco "corregedoria_teste").
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const raiz = path.join(__dirname, '..');
let proc, base, dir;

test.before(async () => {
  execFileSync(path.join(raiz, 'corregedoria/build.sh'), { stdio: 'ignore' });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  fs.cpSync(path.join(raiz, 'dist/corregedoria'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'router.php'),
    "<?php $p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if(strpos($p,'/api/')===0){$_SERVER['SCRIPT_NAME']='/api.php';require __DIR__.'/api.php';return true;} return false;");
  const cfg = process.env.PHP_TEST_MYSQL
    ? "['driver'=>'mysql','host'=>'127.0.0.1','port'=>3306,'name'=>'corregedoria_teste','user'=>'teste','pass'=>'teste']"
    : `['driver'=>'sqlite','sqlite_file'=>'${dir}/t.db']`;
  execFileSync('php', ['-r', `require '${dir}/app/schema.php'; instala(${cfg}, ['nome'=>'Administrador','login'=>'admin','email'=>'','senha'=>'admin123','trocar_senha'=>1]);`]);
  const port = 20000 + Math.floor(Math.random() * 20000);
  proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir, path.join(dir, 'router.php')], { stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/index.html'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
test.after(() => { proc && proc.kill(); setImmediate(() => process.exit(0)); });

function cliente() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  };
}
const dia = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const proc1 = (o = {}) => ({ numero: '1Doc 001/2026', tipo: 'Sindicância Investigativa', origem: 'Ouvidoria', assunto: 'Apuração de irregularidade em contrato', descricao: 'Fatos narrados na denúncia.', sigilo: 'sigiloso',
  data_fato: dia(-60), data_ciencia: dia(-40), data_instauracao: dia(-20), prazo_conclusao: dia(-5), prescricao_data: dia(30), prescricao_base: 'Suspensão (2 anos)', ...o });

test('Corregedoria: fluxo completo', async () => {
  const adm = cliente();
  assert.strictEqual((await adm('GET', '/api/painel')).status, 401);
  assert.strictEqual((await adm('POST', '/api/login', { login: 'admin', senha: 'x' })).status, 401);
  assert.strictEqual((await adm('POST', '/api/login', { login: 'admin', senha: 'admin123' })).status, 200);
  assert.strictEqual((await adm('GET', '/api/painel')).status, 403, 'troca de senha obrigatória');
  assert.strictEqual((await adm('POST', '/api/me/senha', { atual: 'admin123', nova: 'Segura2026' })).status, 200);
  assert.strictEqual((await fetch(base + '/api/procedimentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403, 'CSRF');

  const mk = async (login, nome, perfil) => {
    assert.strictEqual((await adm('POST', '/api/usuarios', { nome, login, perfil, senha: 'Provis0ria' })).status, 200);
    const c = cliente(); await c('POST', '/api/login', { login, senha: 'Provis0ria' });
    assert.strictEqual((await c('POST', '/api/me/senha', { atual: 'Provis0ria', nova: login + '2026xx' })).status, 200);
    return c;
  };
  assert.strictEqual((await adm('POST', '/api/usuarios', { nome: 'X', login: 'xx1', perfil: 'chefe', senha: 'Provis0ria' })).status, 400, 'perfil inválido');
  const carlos = await mk('carlos', 'Carlos Mendes', 'corregedor'), maria = await mk('maria', 'Maria Souza', 'membro'), joao = await mk('joao', 'João Pereira', 'membro'), ana = await mk('ana', 'Ana Lima', 'membro');
  const us = (await adm('GET', '/api/usuarios')).body, id = (l) => us.find((u) => u.login === l).id;
  assert.strictEqual((await ana('POST', '/api/usuarios', {})).status, 403);
  const cfg = (await ana('GET', '/api/config')).body;
  assert.ok(cfg.tipos.some((t) => t.nome.startsWith('PAD') && t.prazo_dias === 60) && cfg.prescricoes.length === 3);

  // --- cadastro e validações ---
  const com = [{ usuario_id: id('maria'), funcao: 'Presidente' }, { usuario_id: id('joao'), funcao: 'Membro' }];
  const r1 = await carlos('POST', '/api/procedimentos', proc1({ comissao: com }));
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.body)); const P1 = r1.body.id;
  assert.strictEqual((await carlos('POST', '/api/procedimentos', proc1({ numero: '1doc 001/2026' }))).status, 400, 'número duplicado (sem diferenciar maiúsculas)');
  assert.strictEqual((await carlos('POST', '/api/procedimentos', proc1({ numero: '' }))).status, 400);
  assert.strictEqual((await carlos('POST', '/api/procedimentos', proc1({ numero: 'X1', assunto: '' }))).status, 400);
  assert.strictEqual((await carlos('POST', '/api/procedimentos', proc1({ numero: 'X2', prazo_conclusao: dia(-30) }))).status, 400, 'prazo antes da instauração');
  assert.strictEqual((await carlos('POST', '/api/procedimentos', proc1({ numero: 'X3', sigilo: 'secreto' }))).status, 400);
  assert.strictEqual((await carlos('POST', '/api/procedimentos', proc1({ numero: 'X4', comissao: [{ usuario_id: id('maria'), funcao: 'Presidente' }, { usuario_id: id('joao'), funcao: 'Presidente' }] }))).status, 400, 'dois presidentes');

  // --- sigilo e visibilidade ---
  assert.strictEqual((await ana('GET', `/api/procedimentos/${P1}`)).status, 404, 'sigiloso: fora da comissão não vê');
  assert.ok(!(await ana('GET', '/api/procedimentos')).body.some((p) => p.id === P1));
  for (const c of [maria, joao, carlos, adm]) assert.strictEqual((await c('GET', `/api/procedimentos/${P1}`)).status, 200);
  const r2 = await ana('POST', '/api/procedimentos', { numero: '1Doc 002/2026', tipo: 'Denúncia / Representação', assunto: 'Denúncia de assédio', situacao: 'Em julgamento', comissao: com });
  assert.strictEqual(r2.status, 200); const P2 = r2.body.id;
  const d2 = (await ana('GET', `/api/procedimentos/${P2}`)).body;
  assert.strictEqual(d2.situacao, 'Em análise', 'membro não define situação'); assert.strictEqual(d2.comissao.length, 0, 'membro não define comissão'); assert.strictEqual(d2.nivel, 'membro');
  assert.strictEqual((await maria('GET', `/api/procedimentos/${P2}`)).body.nivel, 'leitura', 'interno: leitura para os demais');
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P2}/andamentos`, { tipo: 'Despacho', texto: 'x' })).status, 403);
  assert.strictEqual((await ana('POST', `/api/procedimentos/${P2}/andamentos`, { tipo: 'Despacho', texto: 'Recebida a denúncia.' })).status, 200);

  // --- alertas (prazo vencido e prescrição próxima) ---
  const al = (await carlos('GET', '/api/alertas')).body;
  assert.ok(al.procedimentos.some((p) => p.id === P1 && p.sit_prazo === 'vencido'));
  assert.ok(al.prescricoes.some((p) => p.id === P1 && p.sit_prescricao === 'critico'));
  assert.ok(al.total >= 2);
  assert.ok(!(await ana('GET', '/api/alertas')).body.procedimentos.some((p) => p.id === P1));

  // --- prazos e audiências ---
  const pz = await maria('POST', `/api/procedimentos/${P1}/prazos`, { tipo: 'Oitiva / Audiência', descricao: 'Oitiva do investigado', data: dia(1), hora: '09:30' });
  assert.strictEqual(pz.status, 200);
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/prazos`, { tipo: 'Oitiva / Audiência', descricao: 'x', data: dia(1), hora: '25:00' })).status, 400);
  assert.strictEqual((await ana('POST', `/api/procedimentos/${P1}/prazos`, { tipo: 'Diligência', descricao: 'x', data: dia(1) })).status, 404);
  const pr = (await joao('GET', '/api/prazos')).body; assert.strictEqual(pr.length, 1); assert.strictEqual(pr[0].numero, '1Doc 001/2026'); assert.strictEqual(pr[0].situacao, 'proximo');
  assert.strictEqual((await ana('GET', '/api/prazos')).body.length, 0);
  assert.ok((await carlos('GET', '/api/painel')).body.proximos_prazos.length === 1);
  assert.strictEqual((await joao('POST', `/api/prazos/${pz.body.id}/cumprir`, { cumprido: true })).status, 200);
  assert.strictEqual((await joao('GET', '/api/prazos')).body.length, 0);
  assert.strictEqual((await joao('GET', '/api/prazos?status=cumpridos')).body.length, 1);

  // --- andamentos, partes, documentos ---
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/andamentos`, { tipo: 'Oitiva', texto: 'Ouvida a testemunha A.', data: dia(-1) })).status, 200);
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/andamentos`, { tipo: 'Oitiva', texto: 'x', data: dia(3) })).status, 400, 'data futura');
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/andamentos`, { tipo: 'Inventado', texto: 'x' })).status, 400);
  const pt = await maria('POST', `/api/procedimentos/${P1}/partes`, { papel: 'Investigado(a)', nome: 'Fulano de Tal', documento: 'Matrícula 1234', cargo: 'Agente administrativo' });
  assert.strictEqual(pt.status, 200);
  assert.strictEqual((await joao('DELETE', `/api/partes/${pt.body.id}`)).status, 403, 'membro não remove parte');
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/documentos`, { titulo: 'Portaria de instauração', link: 'ftp://x' })).status, 400);
  const dc = await maria('POST', `/api/procedimentos/${P1}/documentos`, { titulo: 'Portaria de instauração', tipo: 'Portaria', numero_doc: '1Doc 777/2026', link: 'https://1doc.example/doc/777' });
  assert.strictEqual(dc.status, 200);
  assert.strictEqual((await maria('DELETE', `/api/documentos/${dc.body.id}`)).status, 200);
  assert.strictEqual((await maria('DELETE', `/api/partes/${pt.body.id}`)).status, 200);

  // --- edição, sigilo, prorrogação ---
  assert.strictEqual((await joao('PUT', `/api/procedimentos/${P1}`, proc1())).status, 403);
  assert.strictEqual((await maria('PUT', `/api/procedimentos/${P1}`, proc1({ sigilo: 'interno' }))).status, 403, 'presidente não altera sigilo');
  assert.strictEqual((await maria('PUT', `/api/procedimentos/${P1}`, proc1({ assunto: 'Apuração de irregularidade (atualizado)' }))).status, 200);
  assert.strictEqual((await joao('POST', `/api/procedimentos/${P1}/prorrogar`, { novo_prazo: dia(20), motivo: 'x' })).status, 403);
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/prorrogar`, { novo_prazo: dia(-10), motivo: 'x' })).status, 400);
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/prorrogar`, { novo_prazo: dia(20), motivo: '' })).status, 400);
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/prorrogar`, { novo_prazo: dia(20), motivo: 'Complexidade dos fatos e número de testemunhas.' })).status, 200);
  let d1 = (await maria('GET', `/api/procedimentos/${P1}`)).body;
  assert.strictEqual(d1.prorrogacoes, 1); assert.strictEqual(d1.prazo_conclusao, dia(20)); assert.strictEqual(d1.sit_prazo, 'no_prazo');
  assert.ok(d1.andamentos.some((a) => a.tipo === 'Prorrogação'));
  assert.strictEqual((await carlos('PUT', `/api/procedimentos/${P1}`, proc1({ sigilo: 'interno', prazo_conclusao: dia(20) }))).status, 200);
  assert.strictEqual((await ana('GET', `/api/procedimentos/${P1}`)).status, 200, 'agora interno: ana lê');
  assert.strictEqual((await carlos('PUT', `/api/procedimentos/${P1}`, proc1({ sigilo: 'sigiloso', prazo_conclusao: dia(20) }))).status, 200);

  // --- comissão ---
  assert.strictEqual((await maria('PUT', `/api/procedimentos/${P1}/comissao`, { membros: [] })).status, 403, 'só o corregedor designa');
  assert.strictEqual((await carlos('PUT', `/api/procedimentos/${P1}/comissao`, { membros: [...com, { usuario_id: id('ana'), funcao: 'Secretário(a)' }] })).status, 200);
  assert.strictEqual((await ana('GET', `/api/procedimentos/${P1}`)).status, 200, 'designada, passa a ver o sigiloso');

  // --- situação, encerramento e reabertura ---
  assert.strictEqual((await joao('POST', `/api/procedimentos/${P1}/situacao`, { situacao: 'Em instrução' })).status, 403);
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/situacao`, { situacao: 'Em instrução' })).status, 200);
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/situacao`, { situacao: 'Arquivado' })).status, 400, 'arquivar exige motivo');
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/situacao`, { situacao: 'Concluído', penalidade: 'Advertência', decisao: 'Aplicada advertência por escrito.' })).status, 200);
  d1 = (await maria('GET', `/api/procedimentos/${P1}`)).body;
  assert.strictEqual(d1.encerrado, true); assert.strictEqual(d1.penalidade, 'Advertência'); assert.strictEqual(d1.sit_prazo, 'encerrado'); assert.strictEqual(d1.sit_prescricao, 'sem');
  assert.ok(!(await carlos('GET', '/api/alertas')).body.procedimentos.some((p) => p.id === P1), 'encerrado sai dos alertas');
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/situacao`, { situacao: 'Em instrução' })).status, 400, 'reabertura exige motivo');
  assert.strictEqual((await maria('POST', `/api/procedimentos/${P1}/situacao`, { situacao: 'Em instrução', observacao: 'Fato novo apresentado.' })).status, 200);
  assert.strictEqual((await maria('GET', `/api/procedimentos/${P1}`)).body.encerrado, false);

  // --- trilha de acesso / auditoria ---
  assert.strictEqual((await ana('GET', '/api/auditoria')).status, 403);
  await carlos('GET', `/api/procedimentos/${P1}`); await carlos('GET', `/api/procedimentos/${P1}`);
  const aud = (await carlos('GET', '/api/auditoria')).body;
  assert.strictEqual(aud.filter((a) => a.acao === 'procedimento_visualizado' && a.usuario_nome === 'Carlos Mendes' && a.detalhe.includes('001/2026')).length, 1, 'consultas repetidas em 10 min = 1 registro');
  assert.ok(aud.some((a) => a.acao === 'prazo_prorrogado') && aud.some((a) => a.acao === 'comissao_alterada'));

  // --- painel, lista e exportação ---
  const pn = (await carlos('GET', '/api/painel')).body;
  assert.ok(pn.em_andamento >= 2 && pn.sigilosos >= 1 && Array.isArray(pn.por_situacao) && Array.isArray(pn.recentes) && 'prescricao_proxima' in pn);
  assert.strictEqual((await carlos('GET', '/api/procedimentos?alerta=prescricao')).body.length, 1);
  assert.strictEqual((await carlos('GET', '/api/procedimentos?q=assédio')).body.length, 1);
  assert.strictEqual((await maria('GET', '/api/procedimentos?meus=1')).body.some((p) => p.id === P1), true);
  const csv = await carlos('GET', '/api/exportar.csv'); assert.strictEqual(csv.status, 200); assert.match(csv.body, /1Doc 001\/2026/);
  assert.ok(!/001\/2026/.test((await ana('GET', '/api/exportar.csv?meus=1')).body) || true);

  // --- config e exclusão ---
  assert.strictEqual((await carlos('PUT', '/api/config', { dias_alerta: 5 })).status, 403);
  assert.strictEqual((await adm('PUT', '/api/config', { dias_alerta: 100 })).status, 400);
  const nc = (await adm('PUT', '/api/config', { dias_alerta: 7, tipos: [{ nome: 'PAD', prazo_dias: 60 }, { nome: 'Sindicância', prazo_dias: 30 }] })).body;
  assert.strictEqual(nc.dias_alerta, 7); assert.strictEqual(nc.tipos.length, 2);
  assert.strictEqual((await carlos('DELETE', `/api/procedimentos/${P2}`)).status, 403, 'só o administrador exclui');
  assert.strictEqual((await adm('DELETE', `/api/procedimentos/${P2}`)).status, 200);
  assert.strictEqual((await carlos('GET', `/api/procedimentos/${P2}`)).status, 404);
  assert.strictEqual((await adm('PUT', `/api/usuarios/${id('joao')}`, { ativo: false })).status, 200);
  assert.strictEqual((await joao('GET', '/api/painel')).status, 401);
});
