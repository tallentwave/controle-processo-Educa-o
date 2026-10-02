'use strict';
const test = require('node:test');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
process.env.ADMIN_PASSWORD = 'admin123';
const { start } = require('../server');
const { cenario } = require('./cenario');

let base, server;
test.before(async () => { server = await start(0); base = `http://localhost:${server.address().port}`; });
test.after(() => { server.close(); setImmediate(() => process.exit(0)); });

test('Node: fluxo completo (admin, usuários, processos e alertas)', () => cenario(base));
