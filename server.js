'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, hashSenha, confereSenha, getConfig, setConfig, audit } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ipDe = (req) => (TRUST_PROXY && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress);
const PUBLIC = path.join(__dirname, 'public');
const SESSAO_MS = 8 * 60 * 60 * 1000;
const ABERTOS = "('Aberto','Em andamento','Aguardando')";
const STATUS = ['Aberto', 'Em andamento', 'Aguardando', 'Concluído', 'Arquivado'];
const PRIORIDADES = ['Baixa', 'Normal', 'Alta', 'Urgente'];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const dataOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// ---------- sessão ----------
function parseCookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function usuarioDaSessao(req) {
  const tok = parseCookies(req).sid;
  if (!tok) return null;
  const row = db.prepare(`SELECT u.* FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id
    WHERE s.token_hash=? AND s.expira_em>? AND u.ativo=1`).get(sha(tok), Date.now());
  return row || null;
}
function criaSessao(res, uid) {
  const tok = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes(token_hash,usuario_id,expira_em) VALUES(?,?,?)').run(sha(tok), uid, Date.now() + SESSAO_MS);
  res.setHeader('Set-Cookie', `sid=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_MS / 1000}${COOKIE_SECURE}`);
}
const publico = (u) => ({ id: u.id, nome: u.nome, login: u.login, email: u.email, cargo: u.cargo, perfil: u.perfil, trocar_senha: !!u.trocar_senha });

// limitador de tentativas de login (por IP+login)
const tentativas = new Map();
function checaTentativas(chave) {
  const t = tentativas.get(chave);
  if (t && t.n >= 5 && Date.now() < t.ate) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}
function falhou(chave) {
  const t = tentativas.get(chave) || { n: 0 };
  t.n++; t.ate = Date.now() + 5 * 60 * 1000; tentativas.set(chave, t);
}

function validaSenha(s) {
  if (typeof s !== 'string' || s.length < 8) throw bad('A senha deve ter pelo menos 8 caracteres.');
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) throw bad('A senha deve conter letras e números.');
}

// ---------- consultas de processos ----------
const BASE_SELECT = `SELECT p.*, r.nome AS responsavel_nome,
    CAST(julianday(p.prazo) - julianday(@hoje) AS INTEGER) AS dias_restantes
  FROM processos p LEFT JOIN usuarios r ON r.id = p.responsavel_id`;

function situacao(p, diasAlerta) {
  if (!['Aberto', 'Em andamento', 'Aguardando'].includes(p.status)) return 'encerrado';
  if (p.dias_restantes == null) return 'sem_prazo';
  if (p.dias_restantes < 0) return 'vencido';
  if (p.dias_restantes === 0) return 'hoje';
  if (p.dias_restantes <= diasAlerta) return 'proximo';
  return 'no_prazo';
}
function decora(rows, cfg) { return rows.map((p) => ({ ...p, situacao: situacao(p, cfg.dias_alerta) })); }

function listaProcessos(q, user) {
  const cfg = getConfig();
  const where = []; const params = { hoje: hoje() };
  if (q.q) {
    where.push('(p.numero LIKE @q OR p.assunto LIKE @q OR p.interessado LIKE @q OR p.origem LIKE @q)');
    params.q = `%${str(q.q, 100)}%`;
  }
  if (q.status && STATUS.includes(q.status)) { where.push('p.status=@status'); params.status = q.status; }
  if (q.status === 'abertos') where.push(`p.status IN ${ABERTOS}`);
  if (q.tipo) { where.push('p.tipo=@tipo'); params.tipo = q.tipo; }
  if (q.prioridade && PRIORIDADES.includes(q.prioridade)) { where.push('p.prioridade=@prio'); params.prio = q.prioridade; }
  if (q.responsavel === 'meus') { where.push('p.responsavel_id=@uid'); params.uid = user.id; }
  else if (q.responsavel) { where.push('p.responsavel_id=@resp'); params.resp = Number(q.responsavel); }
  const aberto = `p.status IN ${ABERTOS} AND p.prazo IS NOT NULL`;
  if (q.prazo === 'vencidos') where.push(`${aberto} AND p.prazo < @hoje`);
  else if (q.prazo === 'hoje') where.push(`${aberto} AND p.prazo = @hoje`);
  else if (q.prazo === 'alerta') { where.push(`${aberto} AND p.prazo >= @hoje AND p.prazo <= date(@hoje, @mais)`); params.mais = `+${cfg.dias_alerta} days`; }
  else if (q.prazo === 'sem') where.push(`p.status IN ${ABERTOS} AND p.prazo IS NULL`);
  const sql = `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (p.status IN ${ABERTOS}) DESC, p.prazo IS NULL, p.prazo ASC, p.id DESC LIMIT 2000`;
  return decora(db.prepare(sql).all(params), cfg);
}

function podeEditar(user, p) {
  return user.perfil === 'admin' || p.responsavel_id === user.id || p.criado_por === user.id;
}
function addMov(pid, uid, tipo, texto) {
  db.prepare('INSERT INTO movimentacoes(processo_id,usuario_id,tipo,texto) VALUES(?,?,?,?)').run(pid, uid, tipo, texto);
}
function numeroUnico(numero, ignorarId) {
  if (db.prepare('SELECT 1 FROM processos WHERE numero=? COLLATE NOCASE AND id<>?').get(numero, ignorarId || 0)) throw bad(`Já existe um processo cadastrado com o número ${numero}.`);
}

function valida(b, cfg, parcial = false) {
  const d = {};
  if (!parcial || 'numero' in b) { d.numero = str(b.numero, 60); if (!d.numero) throw bad('Informe o número do processo (1Doc).'); }
  if (!parcial || 'assunto' in b) { d.assunto = str(b.assunto, 300); if (!d.assunto) throw bad('Informe o assunto do processo.'); }
  for (const k of ['tipo', 'interessado', 'origem']) if (!parcial || k in b) d[k] = str(b[k], 200) || null;
  if (!parcial || 'descricao' in b) d.descricao = str(b.descricao, 5000) || null;
  if (!parcial || 'prioridade' in b) { d.prioridade = b.prioridade || 'Normal'; if (!PRIORIDADES.includes(d.prioridade)) throw bad('Prioridade inválida.'); }
  if (!parcial || 'data_abertura' in b) { d.data_abertura = b.data_abertura || hoje(); if (!dataOk(d.data_abertura)) throw bad('Data de abertura inválida.'); }
  if (!parcial || 'prazo' in b) {
    d.prazo = b.prazo || null;
    if (d.prazo && !dataOk(d.prazo)) throw bad('Prazo inválido.');
  }
  if ('responsavel_id' in b) {
    d.responsavel_id = b.responsavel_id ? Number(b.responsavel_id) : null;
    if (d.responsavel_id && !db.prepare('SELECT 1 FROM usuarios WHERE id=? AND ativo=1').get(d.responsavel_id)) throw bad('Responsável inválido.');
  }
  return d;
}

// ---------- rotas ----------
const routes = [];
const route = (method, pattern, opts, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, handler });
};
const AUTH = { auth: true }, ADMIN = { auth: true, admin: true }, ANON = {};

route('POST', '/api/login', ANON, ({ body, req, res }) => {
  const login = str(body.login, 80), chave = `${ipDe(req)}|${login.toLowerCase()}`;
  checaTentativas(chave);
  const u = db.prepare('SELECT * FROM usuarios WHERE login=?').get(login);
  // confere sempre um hash para não revelar se o usuário existe pelo tempo de resposta
  const ok = u ? confereSenha(String(body.senha || ''), u.senha_hash) : (confereSenha('x', hashSenha('y')), false);
  if (!ok || !u.ativo) { falhou(chave); audit(null, 'login_falhou', login); throw new HttpError(401, 'Login ou senha incorretos.'); }
  tentativas.delete(chave);
  criaSessao(res, u.id);
  db.prepare("UPDATE usuarios SET ultimo_acesso=datetime('now') WHERE id=?").run(u.id);
  audit(u, 'login');
  return publico(u);
});
route('POST', '/api/logout', ANON, ({ req, res }) => {
  const tok = parseCookies(req).sid;
  if (tok) db.prepare('DELETE FROM sessoes WHERE token_hash=?').run(sha(tok));
  res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE}`);
  return { ok: true };
});
route('GET', '/api/me', AUTH, ({ user }) => ({ ...publico(user), config: getConfig(), hoje: hoje() }));
route('POST', '/api/me/senha', AUTH, ({ user, body, req }) => {
  if (!confereSenha(String(body.atual || ''), user.senha_hash)) throw bad('Senha atual incorreta.');
  validaSenha(body.nova);
  if (body.nova === body.atual) throw bad('A nova senha deve ser diferente da atual.');
  db.prepare('UPDATE usuarios SET senha_hash=?, trocar_senha=0 WHERE id=?').run(hashSenha(body.nova), user.id);
  // encerra as outras sessões
  const tok = sha(parseCookies(req).sid);
  db.prepare('DELETE FROM sessoes WHERE usuario_id=? AND token_hash<>?').run(user.id, tok);
  audit(user, 'senha_alterada');
  return { ok: true };
});

// usuários (admin)
route('GET', '/api/usuarios', AUTH, ({ user }) => {
  const rows = db.prepare(`SELECT id,nome,login,email,cargo,perfil,ativo,trocar_senha,criado_em,ultimo_acesso FROM usuarios ORDER BY ativo DESC, nome`).all();
  // usuários comuns só enxergam o necessário para escolher responsáveis
  return user.perfil === 'admin' ? rows : rows.filter((r) => r.ativo).map((r) => ({ id: r.id, nome: r.nome, cargo: r.cargo }));
});
route('POST', '/api/usuarios', ADMIN, ({ user, body }) => {
  const nome = str(body.nome, 120), login = str(body.login, 40);
  if (!nome) throw bad('Informe o nome.');
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) throw bad('Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).');
  if (!['admin', 'usuario'].includes(body.perfil)) throw bad('Perfil inválido.');
  validaSenha(body.senha);
  if (db.prepare('SELECT 1 FROM usuarios WHERE login=?').get(login)) throw bad('Já existe um usuário com esse login.');
  const r = db.prepare('INSERT INTO usuarios(nome,login,email,cargo,perfil,senha_hash,trocar_senha) VALUES(?,?,?,?,?,?,1)')
    .run(nome, login, str(body.email, 120) || null, str(body.cargo, 120) || null, body.perfil, hashSenha(body.senha));
  audit(user, 'usuario_criado', `${login} (${body.perfil})`);
  return { id: Number(r.lastInsertRowid) };
});
route('PUT', '/api/usuarios/:id', ADMIN, ({ user, body, params }) => {
  const id = Number(params.id), alvo = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id);
  if (!alvo) throw new HttpError(404, 'Usuário não encontrado.');
  const nome = str(body.nome ?? alvo.nome, 120);
  const perfil = body.perfil ?? alvo.perfil, ativo = body.ativo == null ? alvo.ativo : (body.ativo ? 1 : 0);
  if (!nome) throw bad('Informe o nome.');
  if (!['admin', 'usuario'].includes(perfil)) throw bad('Perfil inválido.');
  if (id === user.id && (perfil !== 'admin' || !ativo)) throw bad('Você não pode remover seu próprio acesso de administrador.');
  db.prepare('UPDATE usuarios SET nome=?,email=?,cargo=?,perfil=?,ativo=? WHERE id=?')
    .run(nome, str(body.email ?? alvo.email, 120) || null, str(body.cargo ?? alvo.cargo, 120) || null, perfil, ativo, id);
  if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id=?').run(id);
  audit(user, 'usuario_editado', `${alvo.login}${ativo !== alvo.ativo ? (ativo ? ' (reativado)' : ' (desativado)') : ''}`);
  return { ok: true };
});
route('POST', '/api/usuarios/:id/senha', ADMIN, ({ user, body, params }) => {
  const id = Number(params.id), alvo = db.prepare('SELECT login FROM usuarios WHERE id=?').get(id);
  if (!alvo) throw new HttpError(404, 'Usuário não encontrado.');
  validaSenha(body.senha);
  db.prepare('UPDATE usuarios SET senha_hash=?, trocar_senha=1 WHERE id=?').run(hashSenha(body.senha), id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id=?').run(id);
  audit(user, 'senha_redefinida', alvo.login);
  return { ok: true };
});

// processos
route('GET', '/api/processos', AUTH, ({ user, query }) => listaProcessos(query, user));
route('POST', '/api/processos', AUTH, ({ user, body }) => {
  const cfg = getConfig(), d = valida(body, cfg);
  if (d.prazo && d.prazo < d.data_abertura) throw bad('O prazo não pode ser anterior à data de abertura.');
  if (!('responsavel_id' in d)) d.responsavel_id = user.id;
  numeroUnico(d.numero);
  const r = db.prepare(`INSERT INTO processos(numero,assunto,tipo,interessado,origem,descricao,prioridade,data_abertura,prazo,responsavel_id,criado_por)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(d.numero, d.assunto, d.tipo, d.interessado, d.origem, d.descricao, d.prioridade, d.data_abertura, d.prazo, d.responsavel_id, user.id);
  const id = Number(r.lastInsertRowid), numero = d.numero;
  addMov(id, user.id, 'abertura', 'Processo cadastrado.');
  audit(user, 'processo_criado', numero);
  return { id, numero };
});
route('GET', '/api/processos/:id', AUTH, ({ params }) => {
  const p = db.prepare(`${BASE_SELECT} WHERE p.id=@id`).get({ hoje: hoje(), id: Number(params.id) });
  if (!p) throw new HttpError(404, 'Processo não encontrado.');
  const movs = db.prepare(`SELECT m.*, u.nome AS usuario_nome FROM movimentacoes m LEFT JOIN usuarios u ON u.id=m.usuario_id
    WHERE processo_id=? ORDER BY m.id DESC`).all(p.id);
  return { ...decora([p], getConfig())[0], movimentacoes: movs };
});
route('PUT', '/api/processos/:id', AUTH, ({ user, body, params }) => {
  const atual = db.prepare('SELECT * FROM processos WHERE id=?').get(Number(params.id));
  if (!atual) throw new HttpError(404, 'Processo não encontrado.');
  if (!podeEditar(user, atual)) throw new HttpError(403, 'Apenas o responsável, quem abriu o processo ou um administrador pode editá-lo.');
  const d = valida(body, getConfig(), true);
  const novo = { ...atual, ...d };
  if (novo.prazo && novo.prazo < novo.data_abertura) throw bad('O prazo não pode ser anterior à data de abertura.');
  if (d.numero !== undefined && d.numero !== atual.numero) numeroUnico(d.numero, atual.id);
  const mudancas = [];
  if (d.numero !== undefined && d.numero !== atual.numero) mudancas.push(`Número alterado de ${atual.numero} para ${d.numero}`);
  if (d.prazo !== undefined && d.prazo !== atual.prazo) mudancas.push(`Prazo alterado de ${atual.prazo || 'sem prazo'} para ${d.prazo || 'sem prazo'}`);
  if (d.prioridade && d.prioridade !== atual.prioridade) mudancas.push(`Prioridade: ${atual.prioridade} → ${d.prioridade}`);
  if (d.responsavel_id !== undefined && d.responsavel_id !== atual.responsavel_id) {
    const nome = (id) => (id ? db.prepare('SELECT nome FROM usuarios WHERE id=?').get(id)?.nome : 'ninguém');
    mudancas.push(`Responsável: ${nome(atual.responsavel_id)} → ${nome(d.responsavel_id)}`);
  }
  db.prepare(`UPDATE processos SET numero=?,assunto=?,tipo=?,interessado=?,origem=?,descricao=?,prioridade=?,data_abertura=?,prazo=?,responsavel_id=?,atualizado_em=datetime('now') WHERE id=?`)
    .run(novo.numero, novo.assunto, novo.tipo, novo.interessado, novo.origem, novo.descricao, novo.prioridade, novo.data_abertura, novo.prazo, novo.responsavel_id, atual.id);
  if (mudancas.length) addMov(atual.id, user.id, 'alteracao', mudancas.join('; ') + '.');
  audit(user, 'processo_editado', atual.numero);
  return { ok: true };
});
route('POST', '/api/processos/:id/status', AUTH, ({ user, body, params }) => {
  const p = db.prepare('SELECT * FROM processos WHERE id=?').get(Number(params.id));
  if (!p) throw new HttpError(404, 'Processo não encontrado.');
  if (!podeEditar(user, p)) throw new HttpError(403, 'Sem permissão para alterar a situação deste processo.');
  if (!STATUS.includes(body.status)) throw bad('Situação inválida.');
  const concl = ['Concluído', 'Arquivado'].includes(body.status) ? (p.data_conclusao || hoje()) : null;
  db.prepare("UPDATE processos SET status=?, data_conclusao=?, atualizado_em=datetime('now') WHERE id=?").run(body.status, concl, p.id);
  const obs = str(body.observacao, 2000);
  addMov(p.id, user.id, 'status', `Situação: ${p.status} → ${body.status}.${obs ? ' ' + obs : ''}`);
  audit(user, 'processo_status', `${p.numero}: ${body.status}`);
  return { ok: true };
});
route('POST', '/api/processos/:id/movimentacoes', AUTH, ({ user, body, params }) => {
  const p = db.prepare('SELECT id,numero FROM processos WHERE id=?').get(Number(params.id));
  if (!p) throw new HttpError(404, 'Processo não encontrado.');
  const texto = str(body.texto, 3000);
  if (!texto) throw bad('Escreva o andamento.');
  addMov(p.id, user.id, 'andamento', texto);
  db.prepare("UPDATE processos SET atualizado_em=datetime('now') WHERE id=?").run(p.id);
  return { ok: true };
});
route('DELETE', '/api/processos/:id', ADMIN, ({ user, params }) => {
  const p = db.prepare('SELECT numero FROM processos WHERE id=?').get(Number(params.id));
  if (!p) throw new HttpError(404, 'Processo não encontrado.');
  db.prepare('DELETE FROM processos WHERE id=?').run(Number(params.id));
  audit(user, 'processo_excluido', p.numero);
  return { ok: true };
});

// painel e alertas
route('GET', '/api/alertas', AUTH, ({ user }) => {
  const cfg = getConfig();
  const rows = decora(db.prepare(`${BASE_SELECT} WHERE p.status IN ${ABERTOS} AND p.prazo IS NOT NULL
      AND p.prazo <= date(@hoje, @mais) AND (@todos=1 OR p.responsavel_id=@uid) ORDER BY p.prazo ASC LIMIT 200`)
    .all({ hoje: hoje(), mais: `+${cfg.dias_alerta} days`, uid: user.id, todos: user.perfil === 'admin' ? 1 : 0 }), cfg);
  return { dias_alerta: cfg.dias_alerta, itens: rows };
});
route('GET', '/api/painel', AUTH, ({ user }) => {
  const cfg = getConfig(), h = hoje(), mais = `+${cfg.dias_alerta} days`;
  const one = (sql, p = {}) => {
    const all = { hoje: h, mais, uid: user.id, ...p }; // o SQLite rejeita parâmetros nomeados não usados
    return db.prepare(sql).get(Object.fromEntries(Object.entries(all).filter(([k]) => sql.includes('@' + k)))).c;
  };
  const ab = `status IN ${ABERTOS}`;
  const por = (col) => db.prepare(`SELECT COALESCE(${col},'—') AS nome, COUNT(*) AS total FROM processos WHERE ${ab} GROUP BY 1 ORDER BY 2 DESC`).all();
  const ano = h.slice(0, 4);
  return {
    dias_alerta: cfg.dias_alerta,
    total_abertos: one(`SELECT COUNT(*) c FROM processos WHERE ${ab}`),
    vencidos: one(`SELECT COUNT(*) c FROM processos WHERE ${ab} AND prazo < @hoje`),
    hoje: one(`SELECT COUNT(*) c FROM processos WHERE ${ab} AND prazo = @hoje`),
    proximos: one(`SELECT COUNT(*) c FROM processos WHERE ${ab} AND prazo > @hoje AND prazo <= date(@hoje,@mais)`),
    sem_prazo: one(`SELECT COUNT(*) c FROM processos WHERE ${ab} AND prazo IS NULL`),
    meus_abertos: one(`SELECT COUNT(*) c FROM processos WHERE ${ab} AND responsavel_id=@uid`),
    concluidos_ano: one(`SELECT COUNT(*) c FROM processos WHERE status='Concluído' AND substr(data_conclusao,1,4)=@ano`, { ano }),
    por_status: db.prepare('SELECT status AS nome, COUNT(*) AS total FROM processos GROUP BY status').all(),
    por_tipo: por('tipo'),
    por_responsavel: db.prepare(`SELECT COALESCE(u.nome,'Sem responsável') AS nome, COUNT(*) AS total,
        SUM(CASE WHEN p.prazo < @hoje THEN 1 ELSE 0 END) AS vencidos
      FROM processos p LEFT JOIN usuarios u ON u.id=p.responsavel_id WHERE p.${ab} GROUP BY p.responsavel_id ORDER BY total DESC LIMIT 10`).all({ hoje: h }),
    recentes: db.prepare(`SELECT m.criado_em, m.tipo, m.texto, p.id AS processo_id, p.numero, u.nome AS usuario_nome
      FROM movimentacoes m JOIN processos p ON p.id=m.processo_id LEFT JOIN usuarios u ON u.id=m.usuario_id ORDER BY m.id DESC LIMIT 8`).all(),
  };
});

// administração
route('GET', '/api/config', AUTH, () => getConfig());
route('PUT', '/api/config', ADMIN, ({ user, body }) => {
  if (body.dias_alerta != null) {
    const n = Number(body.dias_alerta);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw bad('Dias de alerta deve ser entre 1 e 60.');
    setConfig('dias_alerta', n);
  }
  if (body.tipos != null) {
    if (!Array.isArray(body.tipos)) throw bad('Lista de tipos inválida.');
    const tipos = [...new Set(body.tipos.map((t) => str(t, 80)).filter(Boolean))];
    if (!tipos.length) throw bad('Informe pelo menos um tipo de processo.');
    setConfig('tipos', tipos);
  }
  audit(user, 'config_alterada');
  return getConfig();
});
route('GET', '/api/auditoria', ADMIN, ({ query }) => {
  const q = query.q ? `%${str(query.q, 80)}%` : '%';
  return db.prepare(`SELECT * FROM auditoria WHERE (usuario_nome LIKE @q OR acao LIKE @q OR detalhe LIKE @q) ORDER BY id DESC LIMIT 300`).all({ q });
});
route('GET', '/api/exportar.csv', AUTH, ({ user, query, res }) => {
  const rows = listaProcessos(query, user);
  const cols = [['numero', 'Número'], ['assunto', 'Assunto'], ['tipo', 'Tipo'], ['interessado', 'Interessado'], ['origem', 'Origem'], ['prioridade', 'Prioridade'],
    ['status', 'Situação'], ['data_abertura', 'Abertura'], ['prazo', 'Prazo'], ['dias_restantes', 'Dias restantes'], ['responsavel_nome', 'Responsável']];
  // evita injeção de fórmulas ao abrir no Excel
  const cel = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const csv = '﻿' + [cols.map((c) => cel(c[1])).join(';'), ...rows.map((r) => cols.map((c) => cel(r[c[0]])).join(';'))].join('\r\n');
  audit(user, 'exportacao', `${rows.length} processos`);
  return { raw: csv, type: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="processos-${hoje()}.csv"` } };
});

// ---------- servidor ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > 1e6) { reject(new HttpError(413, 'Requisição muito grande.')); req.destroy(); } else parts.push(c); });
    req.on('end', () => {
      if (!parts.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { reject(bad('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

async function handler(req, res) {
  for (const [k, v] of Object.entries(SEC)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://x');
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname.startsWith('/api/')) {
      const rt = routes.map((r) => { const m = r.re.exec(url.pathname); return m && r.method === req.method ? { r, m } : null; }).find(Boolean);
      if (!rt) throw new HttpError(404, 'Rota não encontrada.');
      // proteção CSRF: mutações exigem cabeçalho customizado (inviável em formulário cross-site)
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Requisição inválida.');
      const user = usuarioDaSessao(req);
      if (rt.r.opts.auth && !user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
      if (rt.r.opts.admin && user.perfil !== 'admin') throw new HttpError(403, 'Acesso restrito ao administrador.');
      if (user && user.trocar_senha && !['/api/me', '/api/me/senha', '/api/logout'].includes(url.pathname)) throw new HttpError(403, 'Troque sua senha para continuar.');
      const params = {}; rt.r.keys.forEach((k, i) => { params[k] = decodeURIComponent(rt.m[i + 1]); });
      const body = req.method === 'GET' ? {} : await lerCorpo(req);
      const out = await rt.r.handler({ req, res, user, body, params, query: Object.fromEntries(url.searchParams) });
      if (out && out.raw != null) { res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'no-store', ...out.headers }); return res.end(out.raw); }
      return send(200, out);
    }
    // arquivos estáticos
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) throw new HttpError(404, 'Não encontrado.');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { erro: e instanceof HttpError ? e.message : 'Erro interno do servidor.' });
  }
}

function start(port = PORT) {
  const server = http.createServer(handler);
  setInterval(() => db.prepare('DELETE FROM sessoes WHERE expira_em<?').run(Date.now()), 3600e3).unref();
  return new Promise((resolve) => server.listen(port, HOST, () => { console.log(`Sistema em http://localhost:${server.address().port}`); resolve(server); }));
}
if (require.main === module) start();
module.exports = { start };
