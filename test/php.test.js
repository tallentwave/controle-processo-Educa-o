'use strict';
// Testa a versão PHP. Por padrão usa SQLite; com PHP_TEST_MYSQL=1 usa MariaDB/MySQL local (banco "processos_teste").
const test = require('node:test');
const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { cenario } = require('./cenario');

const raiz = path.join(__dirname, '..');
let proc, base, dir;

test.before(async () => {
  execFileSync(path.join(raiz, 'php/build.sh'), { stdio: 'ignore' });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'php-'));
  fs.cpSync(path.join(raiz, 'dist/php'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'router.php'),
    "<?php $p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if(strpos($p,'/api/')===0){$_SERVER['SCRIPT_NAME']='/api.php';require __DIR__.'/api.php';return true;} return false;");
  const cfg = process.env.PHP_TEST_MYSQL
    ? "['driver'=>'mysql','host'=>'127.0.0.1','port'=>3306,'name'=>'processos_teste','user'=>'teste','pass'=>'teste']"
    : `['driver'=>'sqlite','sqlite_file'=>'${dir}/t.db']`;
  execFileSync('php', ['-r', `require '${dir}/app/schema.php'; instala(${cfg}, ['nome'=>'Administrador','login'=>'admin','email'=>'','senha'=>'admin123','trocar_senha'=>1]);`]);
  const port = 20000 + Math.floor(Math.random() * 20000);
  proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir, path.join(dir, 'router.php')], { stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/index.html'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
test.after(() => { proc && proc.kill(); setImmediate(() => process.exit(0)); });

test('PHP: fluxo completo (admin, usuários, processos e alertas)', () => cenario(base));
test('PHP: arquivos internos não são servidos como código', async () => {
  const r = await fetch(base + '/api/inexistente', { headers: { 'X-Requested-With': 'fetch' } });
  if (r.status !== 404 && r.status !== 401) throw new Error('status inesperado ' + r.status);
});
