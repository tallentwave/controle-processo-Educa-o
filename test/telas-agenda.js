// Gera capturas da Agenda com dados fictícios: node test/telas-agenda.js docs/agenda
const os = require('os'), path = require('path'), fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const raiz = path.join(__dirname, '..'), out = process.argv[2] || 'docs/agenda';
const sp = (m = 0) => new Date(Date.now() + m * 60000).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (n) => sp(n * 1440).slice(0, 10);
(async () => { try {
  execFileSync(path.join(raiz, 'agenda/build.sh'), { stdio: 'ignore' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-')); fs.cpSync(path.join(raiz, 'dist/agenda'), dir, { recursive: true });
  fs.writeFileSync(dir + '/router.php', "<?php $p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if(strpos($p,'/api/')===0){$_SERVER['SCRIPT_NAME']='/api.php';require __DIR__.'/api.php';return true;} return false;");
  const cfg = process.env.PHP_TEST_MYSQL ? "['driver'=>'mysql','host'=>'127.0.0.1','port'=>3306,'name'=>'agenda_teste','user'=>'teste','pass'=>'teste']" : `['driver'=>'sqlite','sqlite_file'=>'${dir}/t.db']`;
  execFileSync('php', ['-r', `require '${dir}/app/schema.php'; instala(${cfg}, ['nome'=>'Maria Souza','login'=>'admin','email'=>'','senha'=>'Segura2026','trocar_senha'=>0]);`]);
  const port = 33900 + Math.floor(Math.random() * 90), srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir, dir + '/router.php'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const base = `http://127.0.0.1:${port}`, jar = {};
  const call = async (w, m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie: jar[w] || '' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) jar[w] = sc.split(';')[0]; return r.json(); };
  await call('a', 'POST', '/api/login', { login: 'admin', senha: 'Segura2026' });
  const ids = {};
  for (const [nome, login, cargo] of [['João Pereira', 'joao', 'Coordenador de Transporte'], ['Ana Lima', 'ana', 'Coordenadora Pedagógica'], ['Carlos Mendes', 'carlos', 'Diretor de Ensino']]) {
    ids[login] = (await call('a', 'POST', '/api/usuarios', { nome, login, cargo, perfil: 'usuario', senha: 'Provis0ria' })).id;
    await call(login, 'POST', '/api/login', { login, senha: 'Provis0ria' }); await call(login, 'POST', '/api/me/senha', { atual: 'Provis0ria', nova: login + '2026xx' });
  }
  const adminId = (await call('a', 'GET', '/api/usuarios')).find((u) => u.login === 'admin').id;
  const rec = Object.fromEntries((await call('a', 'GET', '/api/recursos')).map((r) => [r.nome, r.id]));
  const ev = async (w, o) => { const r = await call(w, 'POST', '/api/eventos', { confirmar: true, ...o }); if (!r.id) console.log('ERRO evento', o.titulo, r); return r; };
  const seg = (() => { let d = dia(-14); while (new Date(d + 'T12:00').getDay() !== 1) d = dia(-14 + (1 + 7 - new Date(d + 'T12:00').getDay()) % 7 + 0); return d; })();
  const hoje = dia(0);
  await ev('a', { titulo: 'Reunião semanal da equipe gestora', categoria: 'Reunião', data_inicio: seg, data_fim: seg, hora_inicio: '08:30', hora_fim: '09:30', recorrencia: 'semanal', recorre_ate: dia(90), recurso_id: rec['Sala de reuniões'], lembrete_min: 15, participantes: [ids.ana, ids.carlos] });
  await ev('a', { titulo: 'Planejamento pedagógico do 2º semestre', categoria: 'Reunião', data_inicio: hoje, data_fim: hoje, hora_inicio: '10:00', hora_fim: '11:30', local: 'Sala de reuniões', participantes: [ids.joao, ids.ana], lembrete_min: 30 });
  await ev('a', { titulo: 'Visita técnica – EMEF Monteiro Lobato', categoria: 'Visita a escola', data_inicio: hoje, data_fim: hoje, hora_inicio: '14:00', hora_fim: '16:00', local: 'EMEF Monteiro Lobato', recurso_id: rec['Veículo oficial'], participantes: [ids.joao] });
  await ev('ana', { titulo: 'Formação de professores – Alfabetização', categoria: 'Formação / Capacitação', data_inicio: dia(1), data_fim: dia(1), hora_inicio: '08:00', hora_fim: '12:00', recurso_id: rec['Auditório'], participantes: [ids.carlos], descricao: 'Formação continuada para professores do 1º ao 3º ano.\nLevar material de apoio.' });
  await ev('carlos', { titulo: 'Reunião com a Secretária de Educação', categoria: 'Reunião', data_inicio: dia(1), data_fim: dia(1), hora_inicio: '15:00', hora_fim: '16:00', participantes: [adminId] });
  await ev('joao', { titulo: 'Atendimento a pais – EMEI Pequeno Príncipe', categoria: 'Atendimento / Audiência', data_inicio: dia(2), data_fim: dia(2), hora_inicio: '10:00', hora_fim: '11:00', local: 'EMEI Pequeno Príncipe' });
  await ev('a', { titulo: 'Entrega do relatório SIOPE', categoria: 'Prazo / Entrega', dia_inteiro: true, data_inicio: dia(3), data_fim: dia(3) });
  await ev('a', { titulo: 'Cerimônia de entrega de uniformes', categoria: 'Evento / Cerimônia', data_inicio: dia(5), data_fim: dia(5), hora_inicio: '18:00', hora_fim: '20:00', recurso_id: rec['Auditório'], local: 'Auditório da Secretaria' });
  await ev('ana', { titulo: 'Semana pedagógica', categoria: 'Formação / Capacitação', dia_inteiro: true, data_inicio: dia(9), data_fim: dia(11) });
  await ev('carlos', { titulo: 'Conselho Municipal de Educação', categoria: 'Reunião', data_inicio: dia(7), data_fim: dia(7), hora_inicio: '14:00', hora_fim: '17:00', recorrencia: 'mensal', recorre_ate: dia(200) });
  for (const [t, p, who, pr] of [['Enviar ofício ao FNDE', -2, 'a', 'Alta'], ['Revisar calendário escolar 2027', 3, 'a', 'Normal'], ['Conferir rota do transporte escolar', 0, 'a', 'Urgente'], ['Agendar visita à EMEF Paulo Freire', 8, 'a', 'Baixa']])
    await call(who, 'POST', '/api/tarefas', { titulo: t, prazo: dia(p), prioridade: pr });
  for (const c of [['Helena Costa', 'Diretora', 'EMEF Paulo Freire', '(11) 3333-4455', '(11) 98888-1122', 'helena@escola.gov.br'], ['Roberto Alves', 'Secretário', 'EMEI Pequeno Príncipe', '(11) 3333-9090', '', 'roberto@escola.gov.br'], ['Patrícia Nunes', 'Coordenadora', 'EMEF Monteiro Lobato', '(11) 3333-7788', '(11) 97777-3344', '']])
    await call('a', 'POST', '/api/contatos', { nome: c[0], cargo: c[1], orgao: c[2], telefone: c[3], celular: c[4], email: c[5] });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 1360, height: 860 } });
  globalThis.erros = []; const erros = globalThis.erros; globalThis.pg = pg; pg.on('pageerror', (e) => erros.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/status of (401|503)/.test(m.text()) && erros.push(m.text()));
  const shot = async (n) => { await pg.waitForTimeout(450); await pg.screenshot({ path: `${out}/${n}.png` }); };
  await pg.goto(base); await pg.waitForSelector('#f'); await shot('1-login');
  await pg.fill('#l', 'admin'); await pg.fill('#s', 'Segura2026'); await pg.click('button.btn.pri'); await pg.waitForSelector('.stat'); await pg.waitForTimeout(3000); await shot('2-painel');
  for (const [v, n] of [['mes', '3-agenda-mes'], ['semana', '4-agenda-semana'], ['dia', '5-agenda-dia'], ['lista', '6-agenda-lista']]) { await pg.goto(`${base}/#/agenda?v=${v}&d=${hoje}`); await pg.waitForTimeout(900); if (!(await pg.locator('#cal').count())) console.log('MAIN:', v, (await pg.locator('#main').innerText()).slice(0, 300)); await shot(n); }
  console.log('chips no mês:', await (async () => { await pg.goto(`${base}/#/agenda?v=mes&d=${hoje}`); await pg.waitForTimeout(900); console.log('MAIN2:', (await pg.locator('#main').innerText()).slice(0, 200)); return pg.locator('.chip-ev').count(); })());
  await pg.goto(`${base}/#/agenda?v=lista&d=${hoje}`); await pg.waitForSelector('.lin-ev'); await pg.locator('.lin-ev', { hasText: 'Formação de professores' }).first().click(); await pg.waitForSelector('.ev-topo'); await shot('7-compromisso');
  await pg.keyboard.press('Escape');
  await pg.click('#novo'); await pg.waitForSelector('#f'); await pg.fill('[name=titulo]', 'Reunião de teste'); await pg.selectOption('[name=recurso_id]', { label: 'Auditório (Auditório)' });
  await pg.fill('[name=data_inicio]', dia(1)); await pg.fill('[name=data_fim]', dia(1)); await pg.fill('[name=hora_inicio]', '09:00'); await pg.fill('[name=hora_fim]', '10:00');
  await pg.click('[data-s]'); await pg.waitForSelector('#err:not(.hide)'); console.log('conflito de reserva:', (await pg.locator('#err').innerText()).split('\n')[0]); await shot('8-conflito-reserva');
    await pg.selectOption('[name=recurso_id]', ''); await pg.fill('[name=hora_inicio]', '15:00'); await pg.fill('[name=hora_fim]', '15:30'); await pg.locator('.lista-part input').first().check();
  await pg.click('[data-s]'); await pg.waitForTimeout(700);
  const aviso = await pg.locator('.conflito').count(); console.log('aviso de conflito de pessoa/salvou:', aviso);
  if (aviso) { await shot('9-conflito-pessoas'); await pg.locator('.overlay').last().locator('[data-s]').click(); await pg.waitForTimeout(700); }
  await pg.goto(base + '/#/agenda?v=mes'); await pg.waitForSelector('.mes-dia');
  await pg.click('#novo'); await pg.waitForSelector('#f'); await shot('10-novo-compromisso'); await pg.keyboard.press('Escape');
  for (const [r, n] of [['tarefas', '11-tarefas'], ['contatos', '12-contatos'], ['alertas', '13-alertas'], ['usuarios', '14-usuarios'], ['config', '15-config']]) { await pg.goto(`${base}/#/${r}`); await pg.waitForTimeout(500); await shot(n); }
  const m = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  await m.goto(base); await m.fill('#l', 'ana'); await m.fill('#s', 'ana2026xx'); await m.click('button.btn.pri'); await m.waitForSelector('.stat'); await m.waitForTimeout(500);
  await m.goto(`${base}/#/agenda?v=mes&d=${hoje}`); await m.waitForSelector('.mes-dia'); await m.waitForTimeout(500); await m.screenshot({ path: `${out}/16-celular-mes.png` });
  await m.goto(`${base}/#/agenda?v=lista&d=${hoje}`); await m.waitForSelector('.lin-ev'); await m.screenshot({ path: `${out}/17-celular-lista.png` });
  console.log('erros JS:', erros); await b.close(); srv.kill(); process.exit(0);
} catch (e) { try { console.log('URL:', globalThis.pg.url(), '| MAIN:', (await globalThis.pg.locator('body').innerText()).slice(0, 400).replace(/\n/g, ' / ')); await globalThis.pg.screenshot({ path: out + '/falha.png' }); } catch {} console.log('FALHOU:', e.message.split('\n')[0], '| erros JS:', globalThis.erros); process.exit(1); } })();
