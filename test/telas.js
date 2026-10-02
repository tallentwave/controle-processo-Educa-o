// Gera capturas de tela com dados fictícios: node test/telas.js docs/telas
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'telas-'));
const { start } = require('../server');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const out = process.argv[2] || 'docs/telas';
const d = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
(async () => {
  const srv = await start(0), base = `http://localhost:${srv.address().port}`;
  const jar = {};
  const call = async (who, m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie: jar[who] || '' }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0]; return r.json(); };
  await call('a', 'POST', '/api/login', { login: 'admin', senha: 'admin123' });
  await call('a', 'POST', '/api/me/senha', { atual: 'admin123', nova: 'Segura2026' });
  const us = [['Maria Souza', 'maria', 'Coordenadora de Transporte'], ['João Pereira', 'joao', 'Setor de Merenda'], ['Ana Lima', 'ana', 'Recursos Humanos']];
  const ids = {};
  for (const [nome, login, cargo] of us) ids[login] = (await call('a', 'POST', '/api/usuarios', { nome, login, cargo, perfil: 'usuario', senha: 'Provis0ria' })).id;
  const P = [
    ['Solicitação de transporte escolar – Comunidade Rio Claro', 'Transporte escolar', 'Associação de Moradores Rio Claro', 'Gabinete', 'Urgente', -12, -3, 'maria'],
    ['Aquisição de gêneros alimentícios – 2º bimestre', 'Merenda escolar', 'Setor de Merenda', 'Compras', 'Alta', -8, 0, 'joao'],
    ['Reforma do telhado – EMEF Monteiro Lobato', 'Infraestrutura / Reforma', 'Direção da EMEF Monteiro Lobato', 'EMEF Monteiro Lobato', 'Alta', -5, 3, 'maria'],
    ['Transferência de aluno para outro município', 'Matrícula / Transferência', 'Responsável: Carlos Mendes', 'EMEI Pequeno Príncipe', 'Normal', -3, 5, 'ana'],
    ['Licença-prêmio – professora Helena Costa', 'Recursos humanos', 'Helena Costa', 'EMEF Paulo Freire', 'Normal', -2, 12, 'ana'],
    ['Contrato de manutenção de ar-condicionado', 'Convênio / Contrato', 'Empresa FrioTec Ltda.', 'Compras', 'Baixa', -1, 25, 'joao'],
    ['Entrega de livros didáticos – PNLD', 'Material didático', 'FNDE', 'Almoxarifado', 'Normal', -20, 30, 'maria'],
    ['Denúncia de falta de professor – turma 5º B', 'Denúncia / Ouvidoria', 'Ouvidoria Municipal', 'Ouvidoria', 'Urgente', -1, 1, 'ana'],
  ];
  const pid = [];
  let seq = 100230; for (const [assunto, tipo, interessado, origem, prioridade, ab, pr, resp] of P) {
    const r = await call('a', 'POST', '/api/processos', { numero: `1Doc ${seq++}/2026`, assunto, tipo, interessado, origem, prioridade, data_abertura: d(ab), prazo: d(pr), responsavel_id: ids[resp], descricao: 'Processo encaminhado para análise e providências conforme documentação anexa ao protocolo.' });
    pid.push(r.id);
  }
  await call('a', 'POST', `/api/processos/${pid[0]}/movimentacoes`, { texto: 'Solicitada vistoria da rota ao setor de frotas.' });
  await call('a', 'POST', `/api/processos/${pid[0]}/status`, { status: 'Em andamento', observacao: 'Aguardando parecer técnico.' });
  await call('a', 'POST', `/api/processos/${pid[6]}/status`, { status: 'Concluído', observacao: 'Livros entregues.' });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const shot = async (pg, name) => { await pg.waitForTimeout(400); await pg.screenshot({ path: `${out}/${name}.png` }); };
  const pg = await b.newPage({ viewport: { width: 1360, height: 860 } });
  await pg.goto(base); await shot(pg, '1-login');
  await pg.fill('#l', 'admin'); await pg.fill('#s', 'Segura2026'); await pg.click('button.btn.pri'); await pg.waitForSelector('.stat');
  await pg.waitForTimeout(4500); await shot(pg, '2-painel');
  await pg.goto(base + '/#/processos'); await pg.waitForSelector('tr.row'); await shot(pg, '3-processos');
  await pg.goto(base + '/#/alertas'); await pg.waitForSelector('tr.row'); await shot(pg, '4-alertas');
  await pg.goto(base + `/#/processos/${pid[0]}`); await pg.waitForSelector('.timeline'); await shot(pg, '5-detalhe');
  await pg.goto(base + '/#/processos/novo'); await pg.waitForSelector('input[name=assunto]'); await shot(pg, '6-novo-processo');
  await pg.goto(base + '/#/usuarios'); await pg.waitForSelector('table'); await shot(pg, '7-usuarios');
  await pg.click('#novo'); await shot(pg, '8-novo-usuario');
  const m = await b.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  await m.goto(base); await m.fill('#l', 'maria'); await m.fill('#s', 'Provis0ria'); await m.click('button.btn.pri');
  await m.fill('#a', 'Provis0ria'); await m.fill('#n', 'Maria2026x'); await m.fill('#n2', 'Maria2026x'); await m.click('button.btn.pri'); await m.waitForSelector('.stat');
  await m.waitForTimeout(4500); await m.screenshot({ path: `${out}/9-celular.png` });
  await b.close(); srv.close(); process.exit(0);
})();
