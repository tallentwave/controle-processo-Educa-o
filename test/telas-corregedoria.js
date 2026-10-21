// Gera capturas da Corregedoria com dados fictícios e percorre os fluxos principais: node test/telas-corregedoria.js docs/corregedoria
const os = require('os'), path = require('path'), fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const raiz = path.join(__dirname, '..'), out = process.argv[2] || 'docs/corregedoria';
const dia = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
globalThis.erros = [];
(async () => { try {
  execFileSync(path.join(raiz, 'corregedoria/build.sh'), { stdio: 'ignore' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgs-')); fs.cpSync(path.join(raiz, 'dist/corregedoria'), dir, { recursive: true });
  fs.writeFileSync(dir + '/router.php', "<?php $p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if(strpos($p,'/api/')===0){$_SERVER['SCRIPT_NAME']='/api.php';require __DIR__.'/api.php';return true;} return false;");
  const cfg = process.env.PHP_TEST_MYSQL ? "['driver'=>'mysql','host'=>'127.0.0.1','port'=>3306,'name'=>'corregedoria_teste','user'=>'teste','pass'=>'teste']" : `['driver'=>'sqlite','sqlite_file'=>'${dir}/t.db']`;
  execFileSync('php', ['-r', `require '${dir}/app/schema.php'; instala(${cfg}, ['nome'=>'Roberto Almeida','login'=>'admin','email'=>'','senha'=>'Segura2026','trocar_senha'=>0]);`]);
  const port = 33600 + Math.floor(Math.random() * 90), srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir, dir + '/router.php'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const base = `http://127.0.0.1:${port}`, jar = {};
  const call = async (w, m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie: jar[w] || '' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) jar[w] = sc.split(';')[0]; return r.json(); };
  await call('a', 'POST', '/api/login', { login: 'admin', senha: 'Segura2026' });
  const ids = {};
  for (const [nome, login, cargo, perfil] of [['Carlos Mendes', 'carlos', 'Corregedor Municipal', 'corregedor'], ['Maria Souza', 'maria', 'Auditora', 'membro'], ['João Pereira', 'joao', 'Analista de Controle', 'membro'], ['Ana Lima', 'ana', 'Assessora Jurídica', 'membro']]) {
    ids[login] = (await call('a', 'POST', '/api/usuarios', { nome, login, cargo, perfil, senha: 'Provis0ria' })).id;
    await call(login, 'POST', '/api/login', { login, senha: 'Provis0ria' }); await call(login, 'POST', '/api/me/senha', { atual: 'Provis0ria', nova: login + '2026xx' });
  }
  const com = [{ usuario_id: ids.maria, funcao: 'Presidente' }, { usuario_id: ids.joao, funcao: 'Membro' }, { usuario_id: ids.ana, funcao: 'Secretário(a)' }];
  const mk = async (o) => { const r = await call('carlos', 'POST', '/api/procedimentos', o); if (!r.id) console.log('ERRO', o.numero, r); return r.id; };
  const P1 = await mk({ numero: '1Doc 1024/2026', tipo: 'PAD – Processo Administrativo Disciplinar', origem: 'Ouvidoria', assunto: 'Apuração de acúmulo ilegal de cargos públicos', descricao: 'Denúncia apresentada na Ouvidoria noticiando possível acúmulo de cargos incompatíveis por servidor da Secretaria de Obras.', sigilo: 'sigiloso', portaria: 'Portaria nº 14/2026', data_fato: dia(-120), data_ciencia: dia(-90), data_instauracao: dia(-45), prazo_conclusao: dia(-3), prescricao_data: dia(40), prescricao_base: 'Demissão (5 anos) a partir da ciência', comissao: com, situacao: 'Em instrução' });
  const P2 = await mk({ numero: '1Doc 1187/2026', tipo: 'Sindicância Investigativa', origem: 'Chefia imediata', assunto: 'Extravio de equipamentos da Secretaria de Saúde', sigilo: 'interno', data_instauracao: dia(-10), prazo_conclusao: dia(6), prescricao_data: dia(400), comissao: [{ usuario_id: ids.joao, funcao: 'Presidente' }], situacao: 'Instaurado' });
  await mk({ numero: '1Doc 1203/2026', tipo: 'Denúncia / Representação', origem: 'Denúncia anônima', assunto: 'Suposta cobrança indevida em atendimento ao público', sigilo: 'sigiloso', data_ciencia: dia(-2) });
  await mk({ numero: '1Doc 0987/2026', tipo: 'Investigação Preliminar', origem: 'Tribunal de Contas', assunto: 'Irregularidades em diárias de viagem', sigilo: 'sigiloso', data_instauracao: dia(-20), prazo_conclusao: dia(25), prescricao_data: dia(-5), prescricao_base: 'Advertência (180 dias) a partir da ciência', situacao: 'Em instrução', comissao: [{ usuario_id: ids.ana, funcao: 'Presidente' }] });
  const P5 = await mk({ numero: '1Doc 0655/2026', tipo: 'Sindicância Acusatória', assunto: 'Atraso reiterado no cumprimento de jornada', sigilo: 'interno', data_instauracao: dia(-100), prazo_conclusao: dia(-40), comissao: [{ usuario_id: ids.maria, funcao: 'Presidente' }] });
  await call('carlos', 'POST', `/api/procedimentos/${P5}/situacao`, { situacao: 'Concluído', penalidade: 'Advertência', decisao: 'Aplicada penalidade de advertência, por escrito.' });
  await call('maria', 'POST', `/api/procedimentos/${P1}/partes`, { papel: 'Investigado(a)', nome: 'José Antônio da Silva', documento: 'Matrícula 20451', cargo: 'Agente administrativo — Sec. de Obras' });
  await call('maria', 'POST', `/api/procedimentos/${P1}/partes`, { papel: 'Testemunha', nome: 'Márcia Ribeiro', cargo: 'Chefe de setor' });
  await call('maria', 'POST', `/api/procedimentos/${P1}/documentos`, { titulo: 'Portaria de instauração do PAD', tipo: 'Portaria', numero_doc: '1Doc 3321/2026', data: dia(-45), link: 'https://1doc.exemplo.gov.br/doc/3321' });
  await call('maria', 'POST', `/api/procedimentos/${P1}/prazos`, { tipo: 'Oitiva / Audiência', descricao: 'Oitiva da testemunha Márcia Ribeiro', data: dia(1), hora: '09:30' });
  await call('maria', 'POST', `/api/procedimentos/${P1}/prazos`, { tipo: 'Prazo de defesa', descricao: 'Defesa escrita do investigado', data: dia(7) });
  await call('maria', 'POST', `/api/procedimentos/${P1}/andamentos`, { tipo: 'Intimação', texto: 'Expedida intimação ao investigado para acompanhar a instrução e apresentar defesa.', data: dia(-8) });
  await call('maria', 'POST', `/api/procedimentos/${P1}/andamentos`, { tipo: 'Oitiva', texto: 'Realizada a oitiva do denunciante, reduzida a termo.', data: dia(-4) });
  await call('joao', 'POST', `/api/procedimentos/${P2}/prazos`, { tipo: 'Diligência', descricao: 'Inventário dos equipamentos no almoxarifado', data: dia(3) });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 1360, height: 860 } });
  pg.on('pageerror', (e) => globalThis.erros.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/status of (401|409|503)/.test(m.text()) && globalThis.erros.push(m.text()));
  globalThis.pg = pg;
  const shot = async (n) => { await pg.waitForTimeout(450); await pg.screenshot({ path: `${out}/${n}.png` }); };
  await pg.goto(base); await pg.waitForSelector('#f'); await shot('1-login');
  await pg.fill('#l', 'admin'); await pg.fill('#s', 'Segura2026'); await pg.click('button.btn.pri'); await pg.waitForSelector('.stat'); await shot('2-painel');
  await pg.goto(`${base}/#/procedimentos`); await pg.waitForSelector('tr.row'); console.log('abertos listados:', await pg.locator('tr.row').count()); await shot('3-procedimentos');
  await pg.locator('tr.row', { hasText: '1024/2026' }).click(); await pg.waitForSelector('.timeline'); await shot('4-detalhe');
  // andamento pela tela
  await pg.fill('#fand textarea', 'Juntado o termo de depoimento da testemunha.'); await pg.click('#fand button'); await pg.waitForTimeout(800);
  console.log('andamentos na linha do tempo:', await pg.locator('.timeline li').count());
  // prorrogação pela tela
  await pg.click('#bpro'); await pg.waitForSelector('#np'); await pg.fill('#mo', 'Complexidade dos fatos e necessidade de novas oitivas.'); await shot('5-prorrogar'); await pg.click('[data-s]'); await pg.waitForTimeout(900);
  console.log('após prorrogar, deadline:', (await pg.locator('.alertas-proc .deadline').first().innerText()).replace(/\n/g, ' '));
  // situação: encerrar
  await pg.click('#bsit'); await pg.waitForSelector('#ns'); await pg.selectOption('#ns', 'Concluído'); await pg.waitForSelector('#pen'); await pg.selectOption('#pen', 'Suspensão'); await pg.fill('#dec', 'Aplicada suspensão de 30 dias.'); await shot('6-encerrar');
  await pg.click('[data-s]'); await pg.waitForTimeout(900); console.log('encerrado:', (await pg.locator('.alertas-proc .deadline').first().innerText()).replace(/\n/g, ' '));
  await pg.click('#bsit'); await pg.selectOption('#ns', 'Em instrução'); await pg.click('[data-s]'); await pg.waitForTimeout(500); console.log('reabrir sem motivo →', (await pg.locator('#err').innerText()));
  await pg.fill('#ob', 'Fato novo apresentado pela defesa.'); await pg.click('[data-s]'); await pg.waitForTimeout(900);
  // comissão
  await pg.click('#bcom'); await pg.waitForSelector('#lista'); await shot('7-comissao'); await pg.click('[data-n]');
  // novo procedimento com cálculo automático
  await pg.goto(`${base}/#/procedimentos/novo`); await pg.waitForSelector('[name=numero]');
  await pg.fill('[name=numero]', '1Doc 2001/2026'); await pg.selectOption('[name=tipo]', { label: 'Sindicância Investigativa' }); await pg.fill('[name=assunto]', 'Apuração de conduta de servidor em atendimento');
  await pg.fill('[name=data_ciencia]', dia(-5)); await pg.fill('[name=data_instauracao]', dia(0)); await pg.dispatchEvent('[name=data_instauracao]', 'change');
  console.log('prazo sugerido:', await pg.inputValue('[name=prazo_conclusao]'), '(esperado', dia(30) + ')');
  await pg.selectOption('#pre-t', { index: 2 }); await pg.click('#pre-c'); console.log('prescrição calculada:', await pg.inputValue('[name=prescricao_data]'), '|', await pg.inputValue('[name=prescricao_base]'));
  await pg.locator('#com select[data-u]').first().selectOption({ label: 'João Pereira — Analista de Controle' }); await shot('8-novo');
  await pg.click('form#f button.btn.pri'); await pg.waitForSelector('.alertas-proc'); console.log('cadastrado:', await pg.locator('h1').innerText());
  for (const [r, n] of [['prazos', '9-prazos'], ['alertas', '10-alertas'], ['usuarios', '11-usuarios'], ['config', '12-config'], ['auditoria', '13-trilha']]) { await pg.goto(`${base}/#/${r}`); await pg.waitForTimeout(600); await shot(n); }
  // membro sem acesso ao sigiloso
  const m = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  m.on('pageerror', (e) => globalThis.erros.push('mobile: ' + e.message));
  await m.goto(base); await m.fill('#l', 'ana'); await m.fill('#s', 'ana2026xx'); await m.click('button.btn.pri'); await m.waitForSelector('.stat'); await m.waitForTimeout(500);
  await m.goto(`${base}/#/procedimentos`); await m.waitForSelector('tr.row'); const verAna = await m.locator('tr.row').allInnerTexts(); console.log('Ana vê', verAna.length, 'procedimentos; sigiloso 1203 (sem designação) oculto:', !verAna.some((t) => t.includes('1203/2026')));
  await m.screenshot({ path: `${out}/14-celular.png` });
  console.log('erros JS:', globalThis.erros); await b.close(); srv.kill(); process.exit(0);
} catch (e) { try { console.log('URL:', globalThis.pg.url()); await globalThis.pg.screenshot({ path: out + '/falha.png' }); } catch {} console.log('FALHOU:', e.message.split('\n').slice(0, 3).join(' | '), '| erros JS:', globalThis.erros); process.exit(1); } })();
