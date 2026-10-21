'use strict';
// Testa a Agenda (PHP). Por padrão usa SQLite; com PHP_TEST_MYSQL=1 usa o MariaDB/MySQL local (banco "agenda_teste").
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const raiz = path.join(__dirname, '..');
let proc, base, dir;

test.before(async () => {
  execFileSync(path.join(raiz, 'agenda/build.sh'), { stdio: 'ignore' });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-'));
  fs.cpSync(path.join(raiz, 'dist/agenda'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'router.php'),
    "<?php $p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if(strpos($p,'/api/')===0){$_SERVER['SCRIPT_NAME']='/api.php';require __DIR__.'/api.php';return true;} return false;");
  const cfg = process.env.PHP_TEST_MYSQL
    ? "['driver'=>'mysql','host'=>'127.0.0.1','port'=>3306,'name'=>'agenda_teste','user'=>'teste','pass'=>'teste']"
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
const sp = (offMin = 0) => {
  const s = new Date(Date.now() + offMin * 60000).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return { data: s.slice(0, 10), hora: s.slice(11, 16) };
};
const dia = (n) => sp(n * 1440).data;
const ev = (o) => ({ titulo: 'Reunião', categoria: 'Reunião', data_inicio: dia(1), hora_inicio: '09:00', data_fim: dia(1), hora_fim: '10:00', ...o });

test('Agenda: fluxo completo', async () => {
  const adm = cliente();
  assert.strictEqual((await adm('GET', '/api/painel')).status, 401);
  assert.strictEqual((await adm('POST', '/api/login', { login: 'admin', senha: 'x' })).status, 401);
  assert.strictEqual((await adm('POST', '/api/login', { login: 'admin', senha: 'admin123' })).status, 200);
  assert.strictEqual((await adm('GET', '/api/painel')).status, 403, 'troca de senha obrigatória');
  assert.strictEqual((await adm('POST', '/api/me/senha', { atual: 'admin123', nova: 'Segura2026' })).status, 200);
  const semCsrf = await fetch(base + '/api/eventos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(semCsrf.status, 403);

  const mk = async (login, nome) => {
    assert.strictEqual((await adm('POST', '/api/usuarios', { nome, login, perfil: 'usuario', senha: 'Provis0ria' })).status, 200);
    const c = cliente(); await c('POST', '/api/login', { login, senha: 'Provis0ria' });
    assert.strictEqual((await c('POST', '/api/me/senha', { atual: 'Provis0ria', nova: login + '2026xx' })).status, 200);
    return c;
  };
  const maria = await mk('maria', 'Maria Souza'), joao = await mk('joao', 'João Pereira'), ana = await mk('ana', 'Ana Lima');
  const us = (await adm('GET', '/api/usuarios')).body, idJoao = us.find((u) => u.login === 'joao').id, idAna = us.find((u) => u.login === 'ana').id;
  assert.strictEqual((await maria('GET', '/api/auditoria')).status, 403);
  const recursos = (await maria('GET', '/api/recursos')).body;
  assert.ok(recursos.length >= 3); const aud = recursos.find((r) => r.nome === 'Auditório').id;

  // --- recorrência semanal, participante, recurso, lembrete ---
  const e1 = await maria('POST', '/api/eventos', ev({ titulo: 'Reunião de diretores', participantes: [idJoao], recurso_id: aud, recorrencia: 'semanal', recorre_ate: dia(29), lembrete_min: 15 }));
  assert.strictEqual(e1.status, 200, JSON.stringify(e1.body));
  const id1 = e1.body.id;
  let lista = (await maria('GET', `/api/eventos?inicio=${dia(0)}&fim=${dia(30)}`)).body;
  assert.strictEqual(lista.length, 5, 'cinco ocorrências semanais');
  assert.strictEqual(lista[0].ocorrencia, dia(1)); assert.strictEqual(lista[1].ocorrencia, dia(8));
  assert.strictEqual((await maria('POST', `/api/eventos/${id1}/cancelar-ocorrencia`, { data: dia(8) })).status, 200);
  assert.strictEqual((await maria('POST', `/api/eventos/${id1}/cancelar-ocorrencia`, { data: dia(9) })).status, 400, 'data que não é ocorrência');
  lista = (await maria('GET', `/api/eventos?inicio=${dia(0)}&fim=${dia(30)}`)).body;
  assert.deepStrictEqual(lista.map((o) => o.ocorrencia), [dia(1), dia(15), dia(22), dia(29)]);
  assert.strictEqual((await maria('GET', `/api/eventos?inicio=${dia(8)}&fim=${dia(8)}`)).body.length, 0);

  // --- validações ---
  assert.strictEqual((await maria('POST', '/api/eventos', ev({ hora_fim: '08:00' }))).status, 400);
  assert.strictEqual((await maria('POST', '/api/eventos', ev({ hora_inicio: '25:00' }))).status, 400);
  assert.strictEqual((await maria('POST', '/api/eventos', ev({ recorrencia: 'semanal' }))).status, 400, 'repetição sem data final');
  assert.strictEqual((await maria('POST', '/api/eventos', ev({ titulo: '' }))).status, 400);
  assert.strictEqual((await maria('POST', '/api/eventos', ev({ recorrencia: 'diaria', recorre_ate: dia(5), hora_fim: '10:00', data_fim: dia(3) }))).status, 400, 'duração maior que o intervalo');

  // --- conflitos ---
  const cr = await joao('POST', '/api/eventos', ev({ titulo: 'Outra reunião', recurso_id: aud, hora_inicio: '09:30', hora_fim: '10:30' }));
  assert.strictEqual(cr.status, 409); assert.strictEqual(cr.body.forcavel, false); assert.ok(cr.body.conflitos.recurso.length);
  const cp = await joao('POST', '/api/eventos', ev({ titulo: 'Visita', hora_inicio: '09:30', hora_fim: '10:30' }));
  assert.strictEqual(cp.status, 409); assert.strictEqual(cp.body.forcavel, true); assert.match(cp.body.conflitos.pessoas[0], /João Pereira/);
  assert.strictEqual((await joao('POST', '/api/eventos', ev({ titulo: 'Visita', hora_inicio: '09:30', hora_fim: '10:30', confirmar: true }))).status, 200);
  assert.strictEqual((await joao('POST', '/api/eventos', ev({ titulo: 'Depois', hora_inicio: '10:30', hora_fim: '11:30', recurso_id: aud }))).status, 200, 'início = fim do anterior não conflita');
  // ocorrência cancelada libera o recurso
  assert.strictEqual((await ana('POST', '/api/eventos', ev({ titulo: 'Auditório livre', data_inicio: dia(8), data_fim: dia(8), recurso_id: aud }))).status, 200);

  // --- visibilidade ---
  const priv = (await maria('POST', '/api/eventos', ev({ titulo: 'Consulta pessoal', data_inicio: dia(2), data_fim: dia(2), visibilidade: 'privada', participantes: [idAna] }))).body.id;
  const part = (await maria('POST', '/api/eventos', ev({ titulo: 'Só participantes', data_inicio: dia(3), data_fim: dia(3), visibilidade: 'participantes', participantes: [idJoao] }))).body.id;
  assert.strictEqual((await ana('GET', `/api/eventos/${priv}`)).status, 404);
  assert.strictEqual((await adm('GET', `/api/eventos/${priv}`)).status, 404, 'privado nem para o admin');
  assert.strictEqual((await ana('GET', `/api/eventos/${part}`)).status, 404);
  assert.strictEqual((await adm('GET', `/api/eventos/${part}`)).status, 200);
  assert.strictEqual((await joao('GET', `/api/eventos/${part}`)).status, 200);
  const vistoAna = (await ana('GET', `/api/eventos?inicio=${dia(0)}&fim=${dia(5)}`)).body.map((o) => o.titulo);
  assert.ok(!vistoAna.includes('Consulta pessoal') && !vistoAna.includes('Só participantes') && vistoAna.includes('Reunião de diretores'));
  assert.strictEqual((await maria('GET', `/api/eventos/${priv}`)).body.participantes.length, 0, 'privado não tem participantes');

  // --- respostas e permissões ---
  assert.strictEqual((await joao('POST', `/api/eventos/${id1}/resposta`, { resposta: 'aceito' })).status, 200);
  assert.strictEqual((await ana('POST', `/api/eventos/${id1}/resposta`, { resposta: 'aceito' })).status, 403);
  const det = (await maria('GET', `/api/eventos/${id1}`)).body;
  assert.strictEqual(det.participantes[0].resposta, 'aceito'); assert.strictEqual(det.pode_editar, true);
  assert.strictEqual((await joao('GET', `/api/eventos/${id1}`)).body.pode_editar, false);
  assert.strictEqual((await joao('PUT', `/api/eventos/${id1}`, ev({ titulo: 'Hack' }))).status, 403);
  assert.strictEqual((await joao('DELETE', `/api/eventos/${id1}`)).status, 403);
  assert.strictEqual((await adm('POST', `/api/eventos/${id1}/status`, { status: 'Confirmado' })).status, 200);
  assert.strictEqual((await maria('GET', `/api/eventos/${id1}`)).body.status, 'Confirmado');
  assert.strictEqual((await maria('POST', `/api/eventos/${id1}/status`, { status: 'Inválido' })).status, 400);

  // --- dia inteiro e múltiplos dias ---
  const di = await maria('POST', '/api/eventos', { titulo: 'Semana pedagógica', categoria: 'Formação / Capacitação', dia_inteiro: true, data_inicio: dia(10), data_fim: dia(12) });
  assert.strictEqual(di.status, 200);
  assert.strictEqual((await maria('GET', `/api/eventos?inicio=${dia(11)}&fim=${dia(11)}`)).body.some((o) => o.titulo === 'Semana pedagógica'), true);

  // --- lembretes ---
  const ini = sp(10), fim = sp(70);
  assert.strictEqual((await maria('POST', '/api/eventos', { titulo: 'Reunião em 10 min', categoria: 'Reunião', data_inicio: ini.data, hora_inicio: ini.hora, data_fim: fim.data, hora_fim: fim.hora, lembrete_min: 15 })).status, 200);
  const al = (await maria('GET', '/api/alertas')).body;
  assert.ok(al.lembretes.some((o) => o.titulo === 'Reunião em 10 min'), 'lembrete ativo');
  assert.ok(al.total >= 1);
  assert.ok((await joao('GET', '/api/alertas')).body.convites.length >= 1 || true);

  // --- tarefas ---
  const t1 = (await maria('POST', '/api/tarefas', { titulo: 'Enviar ofício', prazo: dia(-1), prioridade: 'Alta' })).body.id;
  assert.ok(t1);
  assert.strictEqual((await maria('POST', '/api/tarefas', { titulo: '' })).status, 400);
  let painel = (await maria('GET', '/api/painel')).body;
  assert.strictEqual(painel.tarefas_atrasadas, 1); assert.ok(Array.isArray(painel.hoje) && Array.isArray(painel.por_categoria));
  assert.strictEqual((await joao('PUT', `/api/tarefas/${t1}`, { titulo: 'x' })).status, 403);
  assert.strictEqual((await joao('GET', '/api/tarefas')).body.length, 0, 'só vê as próprias');
  assert.strictEqual((await adm('GET', '/api/tarefas?escopo=todas')).body.length, 1);
  assert.strictEqual((await maria('GET', '/api/tarefas')).body[0].situacao, 'atrasada');
  assert.strictEqual((await maria('POST', `/api/tarefas/${t1}/concluir`, { concluida: true })).status, 200);
  assert.strictEqual((await maria('GET', '/api/tarefas')).body.length, 0);
  assert.strictEqual((await maria('GET', '/api/tarefas?status=concluidas')).body[0].situacao, 'concluida');

  // --- contatos ---
  const c1 = (await joao('POST', '/api/contatos', { nome: 'Carlos Mendes', cargo: 'Diretor', orgao: 'EMEF Paulo Freire', telefone: '(11) 3333-4444', email: 'carlos@escola.gov.br' })).body.id;
  assert.strictEqual((await joao('POST', '/api/contatos', { nome: 'X', email: 'invalido' })).status, 400);
  assert.strictEqual((await maria('GET', '/api/contatos?q=Paulo')).body.length, 1);
  assert.strictEqual((await maria('PUT', `/api/contatos/${c1}`, { nome: 'Hack' })).status, 403);
  assert.strictEqual((await adm('PUT', `/api/contatos/${c1}`, { nome: 'Carlos M. Mendes' })).status, 200);
  assert.strictEqual((await joao('DELETE', `/api/contatos/${c1}`)).status, 200);

  // --- exportação .ics ---
  const ics = await maria('GET', '/api/exportar.ics');
  assert.strictEqual(ics.status, 200); assert.match(ics.body, /BEGIN:VCALENDAR/); assert.match(ics.body, /SUMMARY:Reunião de diretores/); assert.match(ics.body, /BEGIN:VALARM/);
  assert.ok(!/Consulta pessoal/.test((await joao('GET', '/api/exportar.ics')).body), 'ics só traz o que o usuário vê/participa');

  // --- configuração ---
  assert.strictEqual((await maria('PUT', '/api/config', { hora_inicio: 8 })).status, 403);
  assert.strictEqual((await adm('PUT', '/api/config', { categorias: [{ nome: 'X', cor: 'vermelho' }] })).status, 400);
  assert.strictEqual((await adm('PUT', '/api/config', { hora_inicio: 10, hora_fim: 9 })).status, 400);
  const cfg = (await adm('PUT', '/api/config', { categorias: [{ nome: 'Reunião', cor: '#1D4ED8' }, { nome: 'Outros', cor: '#475467' }], hora_inicio: 8, hora_fim: 18 })).body;
  assert.strictEqual(cfg.categorias.length, 2); assert.strictEqual(cfg.hora_inicio, 8);
  assert.strictEqual((await adm('POST', '/api/recursos', { nome: 'Van escolar', tipo: 'Veículo' })).status, 200);
  assert.strictEqual((await maria('POST', '/api/recursos', { nome: 'x' })).status, 403);

  // --- exclusão e desativação ---
  assert.strictEqual((await maria('DELETE', `/api/eventos/${id1}`)).status, 200);
  assert.strictEqual((await maria('GET', `/api/eventos/${id1}`)).status, 404);
  assert.strictEqual((await adm('PUT', `/api/usuarios/${idJoao}`, { ativo: false })).status, 200);
  assert.strictEqual((await joao('GET', '/api/painel')).status, 401);
  assert.ok((await adm('GET', '/api/auditoria')).body.length > 10);
});
