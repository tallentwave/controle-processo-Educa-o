'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'processos.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT,
  cargo TEXT,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','usuario')),
  senha_hash TEXT NOT NULL,
  trocar_senha INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_acesso TEXT
);
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS processos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  assunto TEXT NOT NULL,
  tipo TEXT,
  interessado TEXT,
  origem TEXT,
  descricao TEXT,
  prioridade TEXT NOT NULL DEFAULT 'Normal' CHECK (prioridade IN ('Baixa','Normal','Alta','Urgente')),
  status TEXT NOT NULL DEFAULT 'Aberto' CHECK (status IN ('Aberto','Em andamento','Aguardando','Concluído','Arquivado')),
  data_abertura TEXT NOT NULL,
  prazo TEXT,
  data_conclusao TEXT,
  responsavel_id INTEGER REFERENCES usuarios(id),
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proc_prazo ON processos(prazo);
CREATE INDEX IF NOT EXISTS idx_proc_status ON processos(status);
CREATE TABLE IF NOT EXISTS movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id),
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_proc ON movimentacoes(processo_id);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  usuario_nome TEXT,
  acao TEXT NOT NULL,
  detalhe TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
`);

// ---------- senhas ----------
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function confereSenha(senha, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hashHex, 'hex'));
}

// ---------- config ----------
const CONFIG_PADRAO = {
  dias_alerta: 5,
  tipos: ['Transporte escolar', 'Merenda escolar', 'Matrícula / Transferência', 'Recursos humanos', 'Infraestrutura / Reforma', 'Material didático', 'Convênio / Contrato', 'Denúncia / Ouvidoria', 'Outros'],
};
function getConfig() {
  const cfg = { ...CONFIG_PADRAO };
  for (const r of db.prepare('SELECT chave, valor FROM config').all()) cfg[r.chave] = JSON.parse(r.valor);
  return cfg;
}
function setConfig(chave, valor) {
  db.prepare('INSERT INTO config(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor').run(chave, JSON.stringify(valor));
}

// ---------- seed do administrador ----------
function seedAdmin() {
  const n = db.prepare("SELECT COUNT(*) c FROM usuarios WHERE perfil='admin'").get().c;
  if (n === 0) {
    const senha = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare("INSERT INTO usuarios(nome,login,perfil,senha_hash,trocar_senha,cargo) VALUES('Administrador','admin','admin',?,1,'Administrador do sistema')")
      .run(hashSenha(senha));
    console.log('Usuário administrador criado: login "admin" (será exigida a troca de senha no primeiro acesso).');
  }
}
seedAdmin();

function audit(user, acao, detalhe) {
  db.prepare('INSERT INTO auditoria(usuario_id,usuario_nome,acao,detalhe) VALUES(?,?,?,?)')
    .run(user ? user.id : null, user ? user.nome : null, acao, detalhe || null);
}

module.exports = { db, hashSenha, confereSenha, getConfig, setConfig, audit };
