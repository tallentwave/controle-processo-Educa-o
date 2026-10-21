'use strict';
/* ====== utilitários ====== */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// template com escape automático; use raw() para HTML já seguro
const h = (strs, ...vals) => new Safe(strs.reduce((o, s, i) => {
  let v = vals[i - 1];
  v = Array.isArray(v) ? v.map((x) => (x instanceof Safe ? x.s : esc(x))).join('') : v instanceof Safe ? v.s : esc(v);
  return o + v + s;
}));
const raw = (s) => new Safe(s);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.instalar) { location.href = 'install.php'; return new Promise(() => {}); }
    if (r.status === 401 && state.user) { state.user = null; render(); }
    const e = new Error(data.erro || 'Erro inesperado.'); e.status = r.status; e.data = data; throw e;
  }
  return data;
}
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), err ? 6000 : 4500);
}
function modal(content, { onMount, largo, fixo } = {}) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal${largo ? ' largo' : ''}" role="dialog" aria-modal="true">${content}</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', k); };
  const k = (e) => { if (e.key === 'Escape') close(); };
  if (!fixo) ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); }); // formulários não fecham por clique fora (evita perder o que foi digitado)
  document.addEventListener('keydown', k);
  document.body.append(ov);
  onMount && onMount(ov.firstElementChild, close);
  const f = $('input:not([type=checkbox]),select,textarea', ov); f && f.focus();
  return close;
}
const confirma = (msg, label = 'Confirmar', perigo = true) => new Promise((res) => {
  modal(h`<h2>${msg}</h2><div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn ${perigo ? 'dng' : 'pri'}" data-s>${label}</button></div>`.s, {
    onMount: (m, close) => { $('[data-n]', m).onclick = () => { close(); res(false); }; $('[data-s]', m).onclick = () => { close(); res(true); }; },
  });
});
async function tentar(fn, errBox) {
  try { return await fn(); } catch (e) { if (errBox) { errBox.textContent = e.message; errBox.classList.remove('hide'); } else toast(e.message, true); }
}
const guarda = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
const le = (k, pad) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : pad; } catch { return pad; } };

/* ====== datas (horário de Brasília) ====== */
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const dow = (s) => pd(s).getDay();
const iniSemana = (s) => addD(s, -dow(s));
const addMes = (s, n) => iso(new Date(pd(s).getFullYear(), pd(s).getMonth() + n, 1));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DIAS_L = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const fmtData = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtCurto = (s) => `${DIAS[dow(s)]}, ${fmtData(s).slice(0, 5)}`;
const hhmm = (s) => s.slice(11, 16);
const fmtMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const mins = (s) => +s.slice(11, 13) * 60 + +s.slice(14, 16);
const agoraSP = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const hojeSP = () => agoraSP().slice(0, 10);
const fmtDT = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }); };


/* ====== estado ====== */
const state = { user: null, config: null, usuarios: [], alertas: { total: 0 }, ready: false };
const SITUACOES = ['Em análise', 'Instaurado', 'Em instrução', 'Aguardando defesa', 'Em relatório', 'Em julgamento', 'Em recurso', 'Suspenso', 'Concluído', 'Arquivado'];
const ENCERRADAS = ['Concluído', 'Arquivado'];
const FUNCOES = ['Presidente', 'Membro', 'Secretário(a)'];
const PAPEIS = ['Investigado(a)', 'Denunciante', 'Testemunha', 'Vítima', 'Defensor(a)', 'Interessado(a)', 'Outro'];
const TIPOS_AND = ['Despacho', 'Portaria', 'Intimação', 'Oitiva', 'Diligência', 'Juntada', 'Defesa', 'Relatório', 'Decisão', 'Recurso', 'Observação'];
const TIPOS_PRAZO = ['Prazo de defesa', 'Oitiva / Audiência', 'Diligência', 'Relatório', 'Recurso', 'Prorrogação', 'Outro'];
const TIPOS_DOC = ['Portaria', 'Denúncia / Representação', 'Ofício', 'Intimação', 'Termo de depoimento', 'Defesa', 'Relatório', 'Decisão', 'Parecer', 'Outro'];
const PERFIL = { admin: 'Administrador', corregedor: 'Corregedor(a)', membro: 'Membro / Servidor' };
const eGestor = () => ['admin', 'corregedor'].includes(state.user.perfil);
const ICONE = '<svg width="22" height="22" viewBox="0 0 32 32"><path d="M16 5l9 3.5v7.5c0 5.2-3.8 9-9 10.5-5.2-1.5-9-5.3-9-10.5V8.5z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M12 16l3 3 5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const stBadge = (s) => h`<span class="badge ${{ 'Em análise': 'b-gry', Instaurado: 'b-blu', 'Em instrução': 'b-blu', 'Aguardando defesa': 'b-amb', 'Em relatório': 'b-pur', 'Em julgamento': 'b-pur', 'Em recurso': 'b-amb', Suspenso: 'b-gry', 'Concluído': 'b-grn', Arquivado: 'b-gry' }[s] || 'b-gry'}">${s}</span>`;
const sigBadge = (p) => (p.sigilo === 'sigiloso' ? h`<span class="badge b-dark" title="Visível apenas à comissão e à Corregedoria">🔒 Sigiloso</span>` : '');
function prazoBadge(p) {
  const d = p.dias_prazo;
  const [c, t] = { vencido: ['b-red', `${plural(-d, 'dia', 'dias')} em atraso`], hoje: ['b-amb', 'Vence hoje'], proximo: ['b-amb', d === 1 ? 'Vence amanhã' : `Faltam ${d} dias`], no_prazo: ['b-grn', 'No prazo'], sem_prazo: ['b-gry', 'Sem prazo'], encerrado: ['b-gry', 'Encerrado'] }[p.sit_prazo];
  return h`<span class="badge ${c}">${t}</span>`;
}
function prescBadge(p) {
  const d = p.dias_prescricao;
  if (p.sit_prescricao === 'sem') return p.encerrado || !p.prescricao_data ? h`<span class="badge b-gry">—</span>` : '';
  const [c, t] = { prescrito: ['b-red', `⚠ Prescrito há ${plural(-d, 'dia', 'dias')}`], critico: ['b-red', d === 0 ? '⚠ Prescreve hoje' : `⚠ Prescreve em ${plural(d, 'dia', 'dias')}`], ok: ['b-gry', 'Dentro do prazo'] }[p.sit_prescricao];
  return h`<span class="badge ${c}">${t}</span>`;
}
function prazoItemBadge(r) {
  const [c, t] = { cumprido: ['b-grn', 'Cumprido'], vencido: ['b-red', `${plural(-r.dias, 'dia', 'dias')} em atraso`], hoje: ['b-amb', 'Hoje'], proximo: ['b-amb', r.dias === 1 ? 'Amanhã' : `Em ${r.dias} dias`], no_prazo: ['b-gry', `Em ${r.dias} dias`] }[r.situacao];
  return h`<span class="badge ${c}">${t}</span>`;
}

/* ====== inicialização ====== */
async function boot() {
  try { const me = await api('GET', 'api/me'); state.user = me; state.config = me.config; } catch { state.user = null; }
  state.ready = true; render();
}
async function carregaContexto() {
  const [al, us, cf] = await Promise.all([api('GET', 'api/alertas'), api('GET', 'api/usuarios'), api('GET', 'api/config')]);
  state.alertas = al; state.usuarios = us.filter((u) => u.ativo !== 0); state.config = cf;
}
window.addEventListener('hashchange', () => { if (state.user && !state.user.trocar_senha && $('#main')) renderPagina(); });
function render() {
  const app = $('#app');
  if (!state.ready) return;
  if (!state.user) return telaLogin(app);
  if (state.user.trocar_senha) return telaTrocaSenha(app);
  app.innerHTML = '';
  carregaContexto().then(() => { montaShell(app); renderPagina(); iniciaAlertas(); }).catch((e) => toast(e.message, true));
}
function montaShell(app) {
  const u = state.user, adm = u.perfil === 'admin', n = state.alertas.total;
  app.innerHTML = h`<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="logo">${raw(ICONE)}</div><div>Corregedoria<small>Controle de procedimentos</small></div></div>
      <nav class="nav">
        <a href="#/painel" data-r="painel">📊 Painel</a>
        <a href="#/procedimentos" data-r="procedimentos">⚖️ Procedimentos</a>
        <a href="#/prazos" data-r="prazos">🗓 Prazos e audiências</a>
        <a href="#/alertas" data-r="alertas">🔔 Alertas <span class="badge ${n ? '' : 'zero'}" id="nbadge">${n}</span></a>
        ${eGestor() ? h`<div class="nav-sep">Administração</div>
          ${adm ? h`<a href="#/usuarios" data-r="usuarios">👥 Usuários</a><a href="#/config" data-r="config">⚙️ Configurações</a>` : ''}
          <a href="#/auditoria" data-r="auditoria">🧾 Trilha de acesso</a>` : ''}
      </nav>
      <div class="me"><b>${u.nome}</b>${PERFIL[u.perfil]}
        <button id="conta">Minha conta</button><button id="sair">Sair</button></div>
    </aside>
    <main class="main" id="main"></main></div>`.s;
  $('#sair').onclick = async () => { await api('POST', 'api/logout'); state.user = null; location.hash = ''; render(); };
  $('#conta').onclick = () => { location.hash = '#/conta'; };
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
}
const atualizaBadge = () => { const b = $('#nbadge'); if (b) { b.textContent = state.alertas.total; b.classList.toggle('zero', !state.alertas.total); } };
let _al = null;
function iniciaAlertas() {
  if (_al) return;
  _al = setInterval(async () => { if (!state.user || state.user.trocar_senha) return; try { state.alertas = await api('GET', 'api/alertas'); atualizaBadge(); } catch { /* ignora */ } }, 300000);
}
async function atualizaAlertas() { try { state.alertas = await api('GET', 'api/alertas'); atualizaBadge(); } catch { /* ignora */ } }

const PAGINAS = { painel: pgPainel, procedimentos: pgLista, prazos: pgPrazos, alertas: pgAlertas, usuarios: pgUsuarios, config: pgConfig, auditoria: pgAuditoria, conta: pgConta };
async function renderPagina() {
  const main = $('#main'); if (!main) return;
  const [rota = 'painel', a, b] = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'painel').split('/');
  let fn = PAGINAS[rota], arg = null;
  if (rota === 'procedimentos' && a === 'novo') fn = pgForm;
  else if (rota === 'procedimentos' && a && b === 'editar') { fn = pgForm; arg = a; }
  else if (rota === 'procedimentos' && a) { fn = pgDetalhe; arg = a; }
  if (!fn || (rota === 'auditoria' && !eGestor()) || (['usuarios', 'config'].includes(rota) && state.user.perfil !== 'admin')) { location.hash = '#/painel'; return; }
  $$('.nav a').forEach((x) => x.classList.toggle('on', x.dataset.r === rota));
  main.innerHTML = '<div class="empty">Carregando…</div>';
  try { await fn(main, arg); } catch (e) { console.error(e.stack || e); main.innerHTML = h`<div class="card empty">${e.message}</div>`.s; }
  window.scrollTo(0, 0);
}
const topo = (titulo, extra = '') => h`<div class="top"><button class="btn menu-btn" onclick="document.getElementById('side').classList.toggle('open')">☰</button><h1>${titulo}</h1><div class="sp"></div>${raw(extra)}</div>`.s;
const lerQuery = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const recarrega = () => renderPagina();
const irProc = (id) => { location.hash = '#/procedimentos/' + id; };
const bars = (arr, cor = 'var(--pri)') => { const max = Math.max(1, ...arr.map((x) => x.total)); return arr.length ? h`<div class="bars">${arr.map((x) => h`<div class="row"><span title="${x.nome}">${x.nome}</span><div class="bar"><i style="width:${(x.total / max) * 100}%;background:${cor}"></i></div><b>${x.total}</b></div>`)}</div>` : h`<div class="empty">Sem dados.</div>`; };

/* ====== login ====== */
function telaLogin(app) {
  app.innerHTML = h`<div class="login"><form class="card" id="f">
    <div class="logo">${raw(ICONE)}</div><h1>Corregedoria Municipal</h1><p class="s">Controle de procedimentos disciplinares</p>
    <div class="aviso">🔒 Acesso restrito a servidores autorizados. Todas as consultas e ações ficam registradas.</div>
    <div class="err-msg hide" id="err"></div>
    <div class="f"><label for="l">Usuário</label><input id="l" autocomplete="username" required autofocus></div>
    <div class="f"><label for="s">Senha</label><input id="s" type="password" autocomplete="current-password" required></div>
    <button class="btn pri" style="width:100%;justify-content:center">Entrar</button>
    <p class="hint" style="text-align:center;margin-top:14px">Não tem acesso? Solicite ao administrador do sistema.</p>
    <p class="hint" style="text-align:center;margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">Desenvolvido por <a href="https://sistemas360.online" target="_blank" rel="noopener" style="font-weight:700;text-decoration:none">Sistemas360.online</a></p></form></div>`.s;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    await tentar(async () => {
      await api('POST', 'api/login', { login: $('#l').value, senha: $('#s').value });
      const me = await api('GET', 'api/me'); state.user = me; state.config = me.config;
      location.hash = '#/painel'; render();
    }, $('#err'));
  };
}
function telaTrocaSenha(app) {
  app.innerHTML = h`<div class="login"><form class="card" id="f">
    <h1>Defina uma nova senha</h1><p class="s">Olá, ${state.user.nome}. Por segurança, crie uma senha pessoal para continuar.</p>
    <div class="err-msg hide" id="err"></div>
    <div class="f"><label>Senha atual</label><input id="a" type="password" autocomplete="current-password" required></div>
    <div class="f"><label>Nova senha</label><input id="n" type="password" autocomplete="new-password" minlength="8" required><div class="hint">Mínimo de 8 caracteres, com letras e números.</div></div>
    <div class="f"><label>Repita a nova senha</label><input id="n2" type="password" autocomplete="new-password" required></div>
    <button class="btn pri" style="width:100%;justify-content:center">Salvar e entrar</button>
    <button type="button" class="btn" id="sair" style="width:100%;justify-content:center;margin-top:8px">Sair</button></form></div>`.s;
  $('#sair').onclick = async () => { await api('POST', 'api/logout'); state.user = null; render(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#n').value !== $('#n2').value) { $('#err').textContent = 'As senhas não conferem.'; $('#err').classList.remove('hide'); return; }
    await tentar(async () => {
      await api('POST', 'api/me/senha', { atual: $('#a').value, nova: $('#n').value });
      state.user.trocar_senha = false; toast('Senha alterada com sucesso.'); location.hash = '#/painel'; render();
    }, $('#err'));
  };
}

/* ====== painel ====== */
async function pgPainel(main) {
  const p = await api('GET', 'api/painel');
  const urg = p.prazo_vencido + p.prescrito, atenc = p.prazo_proximo + p.prescricao_proxima;
  const partes = [p.prescrito && plural(p.prescrito, 'procedimento com prescrição vencida', 'procedimentos com prescrição vencida'), p.prazo_vencido && plural(p.prazo_vencido, 'com prazo de conclusão vencido', 'com prazo de conclusão vencido')].filter(Boolean).join(' e ');
  main.innerHTML = topo(`Olá, ${state.user.nome.split(' ')[0]}!`, '<a class="btn pri" href="#/procedimentos/novo">＋ Novo procedimento</a>') + h`
    ${urg ? h`<div class="alert-banner"><span style="font-size:1.4rem">⚠️</span><div><b>${partes}.</b><br>Priorize esses procedimentos para evitar nulidades e perda do prazo prescricional.</div><a href="#/alertas">Ver alertas →</a></div>`
      : atenc ? h`<div class="alert-banner amb"><span style="font-size:1.4rem">⏰</span><div><b>${p.prazo_proximo ? plural(p.prazo_proximo, 'prazo vence', 'prazos vencem') + ` em até ${p.dias_alerta} dias` : ''}${p.prazo_proximo && p.prescricao_proxima ? ' · ' : ''}${p.prescricao_proxima ? plural(p.prescricao_proxima, 'prescrição se aproxima', 'prescrições se aproximam') : ''}.</b></div><a href="#/alertas">Ver alertas →</a></div>`
      : h`<div class="alert-banner" style="background:var(--grn-l);border-color:#bbf7d0;color:#14532d">✅ <b>Nenhum prazo vencido e nenhuma prescrição próxima.</b></div>`}
    <div class="grid g4" style="margin-bottom:14px">
      <a class="card stat blu" href="#/procedimentos?situacao=abertos"><div class="n">${p.em_andamento}</div><div class="l">Procedimentos em andamento</div></a>
      <a class="card stat" href="#/procedimentos?situacao=abertos&sigilo=sigiloso"><div class="n">${p.sigilosos}</div><div class="l">🔒 Sigilosos em andamento</div></a>
      <a class="card stat red" href="#/procedimentos?alerta=prazo_vencido"><div class="n">${p.prazo_vencido}</div><div class="l">Prazos de conclusão vencidos</div></a>
      <a class="card stat amb" href="#/procedimentos?alerta=prazo_proximo"><div class="n">${p.prazo_proximo}</div><div class="l">Vencem em até ${p.dias_alerta} dias</div></a>
      <a class="card stat red" href="#/procedimentos?alerta=prescricao"><div class="n">${p.prescrito}</div><div class="l">⚖️ Prescrição vencida</div></a>
      <a class="card stat amb" href="#/procedimentos?alerta=prescricao"><div class="n">${p.prescricao_proxima}</div><div class="l">Prescrevem em até ${p.dias_alerta_prescricao} dias</div></a>
      <a class="card stat" href="#/procedimentos?alerta=sem_prazo"><div class="n">${p.sem_prazo}</div><div class="l">Em andamento sem prazo definido</div></a>
      <a class="card stat grn" href="#/procedimentos?situacao=encerrados"><div class="n">${p.encerrados_ano}</div><div class="l">Encerrados em ${hojeSP().slice(0, 4)}</div></a>
    </div>
    <div class="grid2c">
      <div class="card"><h2>Próximos prazos e audiências</h2>${p.proximos_prazos.length ? p.proximos_prazos.map((r) => h`<div class="lista-i clicavel" data-p="${r.procedimento_id}"><div class="dt">${fmtData(r.data)}${r.hora ? h`<div class="sub">${r.hora}</div>` : ''}</div><div class="x"><b>${r.descricao}</b><span class="sub">${r.numero}${r.sigilo === 'sigiloso' ? ' 🔒' : ''} · ${r.tipo}</span></div>${prazoItemBadge(r)}</div>`) : h`<div class="empty">Nenhum prazo nos próximos 14 dias.</div>`}</div>
      <div class="card"><h2>Atenção: prescrição</h2>${p.prescricoes.length ? p.prescricoes.map((r) => h`<div class="lista-i clicavel" data-p="${r.id}"><div class="x"><b>${r.numero} ${r.sigilo === 'sigiloso' ? '🔒' : ''}</b><span class="sub">${r.assunto}</span><span class="sub">Prescrição em ${fmtData(r.prescricao_data)}${r.prescricao_base ? ' · ' + r.prescricao_base : ''}</span></div>${prescBadge(r)}</div>`) : h`<div class="empty">Nenhuma prescrição próxima.</div>`}</div>
      <div class="card"><h2>Por situação</h2>${bars(p.por_situacao)}</div>
      <div class="card"><h2>Em andamento por tipo</h2>${bars(p.por_tipo)}</div>
      <div class="card"><h2>Carga por membro</h2>${bars(p.por_membro)}</div>
      <div class="card"><h2>Últimos andamentos</h2>${p.recentes.length ? h`<ul class="timeline">${p.recentes.map((m) => h`<li class="${m.tipo}"><a href="#/procedimentos/${m.procedimento_id}"><b>${m.numero}</b></a> ${m.sigilo === 'sigiloso' ? '🔒 ' : ''}<span class="tp">${m.tipo}</span><div class="tx">${m.texto.slice(0, 140)}${m.texto.length > 140 ? '…' : ''}</div><div class="who">${m.usuario_nome || 'Sistema'} · ${fmtDT(m.criado_em)}</div></li>`)}</ul>` : h`<div class="empty">Nenhum andamento ainda.</div>`}</div>
    </div>`.s;
  $$('[data-p]', main).forEach((el) => { el.onclick = () => irProc(el.dataset.p); });
}

/* ====== lista ====== */
const FILTRO = { situacao: 'abertos', tipo: '', sigilo: '', alerta: '', meus: '', q: '' };
function linhasProc(lista) {
  if (!lista.length) return h`<div class="empty">Nenhum procedimento encontrado.</div>`;
  return h`<div class="tbl-wrap"><table class="cards-m"><thead><tr><th>Número</th><th>Assunto</th><th>Presidente</th><th>Situação</th><th>Prazo de conclusão</th><th>Prescrição</th></tr></thead><tbody>
    ${lista.map((p) => h`<tr class="row s-${p.sit_prazo} p-${p.sit_prescricao} ${p.encerrado ? 'encerrado' : ''}" data-id="${p.id}">
      <td class="num"><span class="nw">${p.numero}</span><div class="sub">${p.tipo}</div></td>
      <td class="assunto"><b>${p.sigilo === 'sigiloso' ? '🔒 ' : ''}${p.assunto}</b><div class="sub">${p.origem || ''}</div></td>
      <td>${p.presidente_nome || '—'}</td><td>${stBadge(p.situacao)}</td>
      <td>${p.prazo_conclusao ? fmtData(p.prazo_conclusao) : '—'}<div>${prazoBadge(p)}</div></td>
      <td>${p.prescricao_data ? fmtData(p.prescricao_data) : '—'}<div>${prescBadge(p)}</div></td></tr>`)}</tbody></table></div>`;
}
const ligaLinhas = (root) => $$('tr.row', root).forEach((tr) => { tr.onclick = () => irProc(tr.dataset.id); });
async function pgLista(main) {
  const q = lerQuery();
  if (Object.keys(q).length) Object.assign(FILTRO, { situacao: '', tipo: '', sigilo: '', alerta: '', meus: '', q: '' }, q);
  const qs = new URLSearchParams(Object.entries(FILTRO).filter(([, v]) => v)).toString();
  const lista = await api('GET', 'api/procedimentos' + (qs ? '?' + qs : ''));
  const set = (k, v) => { FILTRO[k] = v; if (location.hash.includes('?')) location.hash = '#/procedimentos'; else recarrega(); };
  const opt = (arr, cur) => arr.map((x) => h`<option ${x === cur ? raw('selected') : ''}>${x}</option>`);
  main.innerHTML = topo('Procedimentos', `<a class="btn" href="api/exportar.csv${qs ? '?' + qs : ''}">⬇ Exportar CSV</a><button class="btn" onclick="print()">🖨 Imprimir</button><a class="btn pri" href="#/procedimentos/novo">＋ Novo procedimento</a>`) + h`
    <div class="card">
      <div class="chips">${[['', 'Todos os alertas'], ['prazo_vencido', 'Prazo vencido'], ['prazo_proximo', 'Prazo próximo'], ['prescricao', 'Prescrição'], ['sem_prazo', 'Sem prazo']].map(([v, l]) => h`<button class="chip ${FILTRO.alerta === v ? 'on' : ''}" data-alerta="${v}">${l}</button>`)}</div>
      <div class="filters">
        <input type="search" id="busca" placeholder="Buscar por número, assunto, portaria ou nome de envolvido…" value="${FILTRO.q}">
        <select id="fsit"><option value="">Todas as situações</option><option value="abertos" ${FILTRO.situacao === 'abertos' ? raw('selected') : ''}>Somente em andamento</option><option value="encerrados" ${FILTRO.situacao === 'encerrados' ? raw('selected') : ''}>Somente encerrados</option>${opt(SITUACOES, FILTRO.situacao)}</select>
        <select id="ftipo"><option value="">Todos os tipos</option>${opt(state.config.tipos.map((t) => t.nome), FILTRO.tipo)}</select>
        <select id="fsig"><option value="">Qualquer sigilo</option><option value="sigiloso" ${FILTRO.sigilo === 'sigiloso' ? raw('selected') : ''}>🔒 Sigilosos</option><option value="interno" ${FILTRO.sigilo === 'interno' ? raw('selected') : ''}>Internos</option></select>
        <label class="chk" style="display:flex;gap:6px;align-items:center;font-weight:600;margin:0;white-space:nowrap"><input type="checkbox" id="fmeus" style="width:auto" ${FILTRO.meus ? raw('checked') : ''}> Somente os meus</label>
      </div>
      <div class="hint" style="margin-bottom:8px">${plural(lista.length, 'procedimento', 'procedimentos')}</div>${linhasProc(lista)}</div>`.s;
  $$('[data-alerta]', main).forEach((c) => { c.onclick = () => set('alerta', c.dataset.alerta); });
  let t; $('#busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => set('q', e.target.value.trim()), 400); };
  $('#busca').onfocus = (e) => e.target.setSelectionRange(1e4, 1e4);
  $('#fsit').onchange = (e) => set('situacao', e.target.value); $('#ftipo').onchange = (e) => set('tipo', e.target.value); $('#fsig').onchange = (e) => set('sigilo', e.target.value);
  $('#fmeus').onchange = (e) => set('meus', e.target.checked ? '1' : '');
  ligaLinhas(main);
}

/* ====== formulário de procedimento ====== */
async function pgForm(main, id) {
  const p = id ? await api('GET', 'api/procedimentos/' + id) : { sigilo: 'interno', situacao: 'Em análise', tipo: '', comissao: [] };
  if (id && !p.pode_gerir) throw new Error('Você não tem permissão para editar este procedimento.');
  const gestor = eGestor(), tipos = state.config.tipos, pres = state.config.prescricoes;
  const tiposOpt = tipos.map((t) => t.nome); if (p.tipo && !tiposOpt.includes(p.tipo)) tiposOpt.push(p.tipo);
  const origens = state.config.origens.slice(); if (p.origem && !origens.includes(p.origem)) origens.push(p.origem);
  const linhaCom = (m = { usuario_id: '', funcao: 'Membro' }) => h`<div class="rowx"><select data-u><option value="">Selecione o servidor…</option>${state.usuarios.map((u) => h`<option value="${u.id}" ${u.id === m.usuario_id ? raw('selected') : ''}>${u.nome}${u.cargo ? ' — ' + u.cargo : ''}</option>`)}</select><select data-f class="f">${FUNCOES.map((f) => h`<option ${f === m.funcao ? raw('selected') : ''}>${f}</option>`)}</select><button type="button" class="btn sm dng" data-rm>✕</button></div>`;
  main.innerHTML = topo(id ? `Editar procedimento ${p.numero}` : 'Novo procedimento') + h`<form class="card" id="f"><div class="err-msg hide" id="err"></div>
    <div class="sec">Identificação</div><div class="form">
      <div><label>Número do procedimento (1Doc) <span class="req">*</span></label><input name="numero" value="${p.numero || ''}" maxlength="60" required placeholder="Número gerado no 1Doc"></div>
      <div><label>Tipo <span class="req">*</span></label><select name="tipo" required><option value="">Selecione…</option>${tiposOpt.map((t) => h`<option ${t === p.tipo ? raw('selected') : ''}>${t}</option>`)}</select></div>
      <div class="full"><label>Assunto resumido <span class="req">*</span></label><input name="assunto" value="${p.assunto || ''}" maxlength="300" required placeholder="Ex.: Apuração de irregularidade em processo de contratação"></div>
      <div><label>Origem</label><select name="origem"><option value="">—</option>${origens.map((o) => h`<option ${o === p.origem ? raw('selected') : ''}>${o}</option>`)}</select></div>
      <div><label>Portaria de instauração</label><input name="portaria" value="${p.portaria || ''}" maxlength="80" placeholder="Ex.: Portaria nº 12/2026"></div>
      <div><label>Nível de sigilo</label><select name="sigilo" ${id && !p.gestor ? raw('disabled') : ''}><option value="interno" ${p.sigilo === 'interno' ? raw('selected') : ''}>Interno — visível a todos os usuários da Corregedoria</option><option value="sigiloso" ${p.sigilo === 'sigiloso' ? raw('selected') : ''}>🔒 Sigiloso — somente comissão e Corregedoria</option></select></div>
      ${!id && gestor ? h`<div><label>Situação inicial</label><select name="situacao">${SITUACOES.slice(0, 8).map((s) => h`<option ${s === 'Em análise' ? raw('selected') : ''}>${s}</option>`)}</select></div>` : ''}
    </div>
    <div class="sec">Fatos</div><div class="form">
      <div><label>Data do fato</label><input type="date" name="data_fato" value="${p.data_fato || ''}"></div>
      <div><label>Data da ciência pela Administração</label><input type="date" name="data_ciencia" value="${p.data_ciencia || ''}"></div>
      <div class="full"><label>Descrição dos fatos</label><textarea name="descricao" maxlength="8000" style="min-height:120px">${p.descricao || ''}</textarea></div>
    </div>
    <div class="sec">Instauração e prazos</div><div class="form">
      <div><label>Data de instauração</label><input type="date" name="data_instauracao" value="${p.data_instauracao || ''}"></div>
      <div><label>Prazo de conclusão</label><input type="date" name="prazo_conclusao" value="${p.prazo_conclusao || ''}"><div class="hint" id="hprazo">Calculado pelo tipo do procedimento a partir da instauração (você pode alterar).</div></div>
      <div class="full"><label>Prescrição</label>
        <div class="sel-pre"><div><select id="pre-t"><option value="">Penalidade provável (opcional)…</option>${pres.map((x) => h`<option value="${x.dias}" data-nome="${x.nome}">${x.nome} — ${x.dias} dias</option>`)}</select></div>
        <div><select id="pre-b"><option value="data_ciencia">contados da ciência</option><option value="data_fato">contados do fato</option><option value="data_instauracao">contados da instauração</option></select></div>
        <button type="button" class="btn" id="pre-c">Calcular</button></div></div>
      <div><label>Data da prescrição</label><input type="date" name="prescricao_data" value="${p.prescricao_data || ''}"></div>
      <div><label>Base do cálculo</label><input name="prescricao_base" value="${p.prescricao_base || ''}" maxlength="120" placeholder="Ex.: Suspensão (2 anos) a partir da ciência"></div>
      <div class="full hint">O prazo prescricional depende do Estatuto do Servidor do município e de causas de interrupção ou suspensão. Confira a data calculada com a assessoria jurídica.</div>
    </div>
    ${!id && gestor ? h`<div class="sec">Comissão / equipe responsável <span class="hint">(opcional agora; pode ser definida depois)</span></div><div id="com">${linhaCom()}</div><button type="button" class="btn sm" id="addm">＋ Adicionar membro</button>` : ''}
    <div style="display:flex;gap:8px;margin-top:22px"><button class="btn pri">${id ? 'Salvar alterações' : 'Cadastrar procedimento'}</button><a class="btn" href="#/procedimentos${id ? '/' + id : ''}">Cancelar</a></div></form>`.s;
  const f = $('#f'); let prazoManual = !!p.prazo_conclusao;
  const calcPrazo = () => {
    const t = tipos.find((x) => x.nome === f.tipo.value), ini = f.data_instauracao.value;
    if (prazoManual || !t || !t.prazo_dias || !ini) return;
    f.prazo_conclusao.value = addD(ini, t.prazo_dias); $('#hprazo').textContent = `Sugestão: ${t.prazo_dias} dias a partir da instauração.`;
  };
  f.prazo_conclusao.oninput = () => { prazoManual = true; };
  f.tipo.onchange = calcPrazo; f.data_instauracao.onchange = calcPrazo;
  $('#pre-c').onclick = () => {
    const sel = $('#pre-t'), dias = +sel.value, campo = $('#pre-b').value, base = f[campo].value;
    if (!dias) return toast('Escolha a penalidade provável.', true);
    if (!base) return toast('Preencha a data usada como início da contagem.', true);
    f.prescricao_data.value = addD(base, dias);
    f.prescricao_base.value = `${sel.selectedOptions[0].dataset.nome} (${dias} dias) ${{ data_ciencia: 'a partir da ciência', data_fato: 'a partir do fato', data_instauracao: 'a partir da instauração' }[campo]}`;
  };
  const com = $('#com'); if (com) {
    const liga = () => $$('[data-rm]', com).forEach((b) => { b.onclick = () => b.parentElement.remove(); });
    liga(); $('#addm').onclick = () => { const d = document.createElement('div'); d.innerHTML = linhaCom().s; com.append(d.firstElementChild); liga(); };
  }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(f).entries());
    if (id && !p.gestor) b.sigilo = p.sigilo;
    if (com) b.comissao = $$('.rowx', com).map((r) => ({ usuario_id: +$('[data-u]', r).value, funcao: $('[data-f]', r).value })).filter((m) => m.usuario_id);
    await tentar(async () => {
      const r = id ? await api('PUT', 'api/procedimentos/' + id, b) : await api('POST', 'api/procedimentos', b);
      toast(id ? 'Procedimento atualizado.' : `Procedimento ${r.numero} cadastrado.`); await atualizaAlertas(); location.hash = '#/procedimentos/' + (id || r.id);
    }, $('#err'));
  };
}

/* ====== detalhe do procedimento ====== */
const boxPrazo = (p) => {
  if (p.encerrado) return h`<div class="deadline encerrado">Procedimento ${p.situacao.toLowerCase()}${p.data_encerramento ? ' em ' + fmtData(p.data_encerramento) : ''}</div>`;
  const d = p.dias_prazo;
  const msg = { vencido: `⛔ Prazo de conclusão vencido há ${plural(-d, 'dia', 'dias')} (${fmtData(p.prazo_conclusao)})`, hoje: `⚠️ O prazo de conclusão vence hoje (${fmtData(p.prazo_conclusao)})`, proximo: `⏰ Prazo de conclusão em ${fmtData(p.prazo_conclusao)} — faltam ${plural(d, 'dia', 'dias')}`, no_prazo: `✅ Prazo de conclusão em ${fmtData(p.prazo_conclusao)} — faltam ${plural(d, 'dia', 'dias')}`, sem_prazo: 'Prazo de conclusão não definido' }[p.sit_prazo];
  return h`<div class="deadline ${p.sit_prazo}">${msg}</div>`;
};
const boxPresc = (p) => {
  if (p.encerrado || !p.prescricao_data) return '';
  const d = p.dias_prescricao;
  const [cl, msg] = { prescrito: ['vencido', `⚖️ Prescrição vencida há ${plural(-d, 'dia', 'dias')} (${fmtData(p.prescricao_data)})`], critico: ['hoje', `⚖️ Prescrição em ${fmtData(p.prescricao_data)} — ${d === 0 ? 'é hoje' : 'faltam ' + plural(d, 'dia', 'dias')}`], ok: ['no_prazo', `⚖️ Prescrição em ${fmtData(p.prescricao_data)} — faltam ${plural(d, 'dia', 'dias')}`] }[p.sit_prescricao];
  return h`<div class="deadline ${cl}">${msg}</div>`;
};
async function pgDetalhe(main, id) {
  const p = await api('GET', 'api/procedimentos/' + id);
  const at = p.pode_atuar, ger = p.pode_gerir, adm = state.user.perfil === 'admin';
  const kv = (k, v) => (v ? h`<dt>${k}</dt><dd>${v}</dd>` : '');
  main.innerHTML = topo(`Procedimento ${p.numero}`,
    `<a class="btn" href="#/procedimentos">← Voltar</a><button class="btn" onclick="print()">🖨 Imprimir ficha</button>` +
    (ger ? `<a class="btn" href="#/procedimentos/${p.id}/editar">✏️ Editar</a>` : '') + (adm ? '<button class="btn dng" id="del">Excluir</button>' : '')) + h`
    <div class="so-print"><h2>Corregedoria Municipal — Ficha do procedimento ${p.numero}</h2><div class="hint">Emitida por ${state.user.nome} em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${p.sigilo === 'sigiloso' ? ' · DOCUMENTO SIGILOSO' : ''}</div></div>
    ${p.sigilo === 'sigiloso' ? h`<div class="aviso-sigilo">🔒 <div><b>Procedimento sigiloso.</b> Visível apenas à comissão designada e à Corregedoria. Seu acesso a esta página foi registrado.</div></div>` : ''}
    <div class="alertas-proc">${boxPrazo(p)}${boxPresc(p)}</div>
    <div class="cols"><div>
      <div class="card"><h2>${p.assunto}</h2><dl class="kv">
        <dt>Situação</dt><dd>${stBadge(p.situacao)} ${sigBadge(p)} ${ger ? h`<button class="btn sm" id="bsit">Alterar situação</button>` : ''}</dd>
        ${kv('Tipo', p.tipo)}${kv('Origem', p.origem)}${kv('Portaria', p.portaria)}
        ${kv('Data do fato', p.data_fato && fmtData(p.data_fato))}${kv('Ciência', p.data_ciencia && fmtData(p.data_ciencia))}${kv('Instauração', p.data_instauracao && fmtData(p.data_instauracao))}
        <dt>Prazo de conclusão</dt><dd>${p.prazo_conclusao ? fmtData(p.prazo_conclusao) : '—'} ${p.prorrogacoes ? h`<span class="badge b-gry">${plural(p.prorrogacoes, 'prorrogação', 'prorrogações')}</span>` : ''} ${ger && !p.encerrado ? h`<button class="btn sm" id="bpro">Prorrogar prazo</button>` : ''}</dd>
        ${p.prescricao_data ? h`<dt>Prescrição</dt><dd>${fmtData(p.prescricao_data)} ${prescBadge(p)}${p.prescricao_base ? h`<div class="sub hint">${p.prescricao_base}</div>` : ''}</dd>` : ''}
        <dt>Comissão</dt><dd>${p.comissao.length ? p.comissao.map((m) => h`<div>${m.nome} <span class="badge ${m.funcao === 'Presidente' ? 'b-blu' : 'b-gry'}">${m.funcao}</span></div>`) : '<span class="hint">Nenhum membro designado.</span>'} ${p.gestor ? h`<button class="btn sm" id="bcom" style="margin-top:6px">Definir comissão</button>` : ''}</dd>
        ${kv('Cadastrado por', p.criador_nome)}</dl>
        ${p.descricao ? h`<h3 style="margin-top:16px">Descrição dos fatos</h3><p style="white-space:pre-wrap;margin:0">${p.descricao}</p>` : ''}
        ${p.encerrado ? h`<h3 style="margin-top:16px">Decisão</h3><dl class="kv">${kv('Resultado', p.penalidade)}${kv('Data da decisão', p.data_decisao && fmtData(p.data_decisao))}${kv('Encerrado em', p.data_encerramento && fmtData(p.data_encerramento))}</dl>${p.decisao ? h`<p style="white-space:pre-wrap;margin:8px 0 0">${p.decisao}</p>` : ''}` : ''}</div>
      <div class="card"><h2>Envolvidos ${at ? h`<button class="btn sm acao" id="bpar">＋ Adicionar</button>` : ''}</h2>
        ${p.partes.length ? p.partes.map((x) => h`<div class="lista-i"><div class="x"><b>${x.nome}</b><span class="sub">${[x.papel, x.documento, x.cargo].filter(Boolean).join(' · ')}</span>${x.contato ? h`<span class="sub">${x.contato}</span>` : ''}${x.observacao ? h`<span class="sub">${x.observacao}</span>` : ''}</div>${at ? h`<button class="btn sm" data-par="${x.id}">Editar</button>` : ''}</div>`) : h`<div class="empty">Nenhum envolvido registrado.</div>`}</div>
      <div class="card"><h2>Documentos (registro) ${at ? h`<button class="btn sm acao" id="bdoc">＋ Registrar</button>` : ''}</h2>
        ${p.documentos.length ? p.documentos.map((x) => h`<div class="lista-i"><div class="x"><b>${x.link ? h`<a href="${x.link}" target="_blank" rel="noopener noreferrer">${x.titulo} ↗</a>` : x.titulo}</b><span class="sub">${[x.tipo, x.numero_doc && 'nº ' + x.numero_doc, x.data && fmtData(x.data)].filter(Boolean).join(' · ')}</span>${x.observacao ? h`<span class="sub">${x.observacao}</span>` : ''}</div>${at ? h`<button class="btn sm" data-doc="${x.id}">Editar</button>` : ''}</div>`) : h`<div class="empty">Nenhum documento registrado. Os arquivos ficam no 1Doc; aqui você registra o número e o link.</div>`}</div>
    </div><div>
      <div class="card"><h2>Prazos e audiências ${at ? h`<button class="btn sm acao" id="bpra">＋ Novo prazo</button>` : ''}</h2>
        ${p.prazos.length ? p.prazos.map((x) => h`<div class="lista-i ${x.cumprido ? 'feito' : ''}">${at ? h`<input type="checkbox" data-cum="${x.id}" ${x.cumprido ? raw('checked') : ''} aria-label="Cumprido">` : ''}<div class="dt">${fmtData(x.data)}${x.hora ? h`<div class="sub">${x.hora}</div>` : ''}</div><div class="x"><b>${x.descricao}</b><span class="sub">${x.tipo}</span></div>${prazoItemBadge(x)} ${at ? h`<button class="btn sm" data-pra="${x.id}">Editar</button>` : ''}</div>`) : h`<div class="empty">Nenhum prazo ou audiência agendado.</div>`}</div>
      <div class="card"><h2>Andamentos</h2>
        ${at ? h`<form id="fand" style="margin-bottom:16px"><div class="form" style="grid-template-columns:1fr 150px"><div><label>Tipo de ato</label><select name="tipo">${TIPOS_AND.map((t) => h`<option>${t}</option>`)}</select></div><div><label>Data</label><input type="date" name="data" value="${hojeSP()}" max="${hojeSP()}"></div></div>
          <textarea name="texto" placeholder="Descreva o ato, despacho ou providência…" maxlength="6000" required style="min-height:80px;margin-top:8px"></textarea><button class="btn pri sm" style="margin-top:8px">Registrar andamento</button></form>` : ''}
        <ul class="timeline">${p.andamentos.map((m) => h`<li class="${m.tipo}"><span class="tp">${m.tipo}</span> <span class="hint">· ${fmtData(m.data)}</span><div class="tx">${m.texto}</div><div class="who">${m.usuario_nome || 'Sistema'} · registrado em ${fmtDT(m.criado_em)}</div></li>`)}</ul>
        <div class="hint">Os andamentos não podem ser editados nem excluídos, para preservar a integridade do histórico.</div></div>
    </div></div>`.s;

  const via = (sel, fn) => { const el = $(sel, main); if (el) el.onclick = fn; };
  via('#del', async () => { if (await confirma(`Excluir definitivamente o procedimento ${p.numero} e todo o seu histórico? Esta ação não pode ser desfeita.`, 'Excluir')) tentar(async () => { await api('DELETE', 'api/procedimentos/' + p.id); toast('Procedimento excluído.'); await atualizaAlertas(); location.hash = '#/procedimentos'; }); });
  via('#bsit', () => modalSituacao(p)); via('#bpro', () => modalProrrogar(p)); via('#bcom', () => modalComissao(p));
  via('#bpar', () => modalParte(p, null)); via('#bdoc', () => modalDoc(p, null)); via('#bpra', () => modalPrazo(p, null));
  $$('[data-par]', main).forEach((b) => { b.onclick = () => modalParte(p, p.partes.find((x) => x.id === +b.dataset.par)); });
  $$('[data-doc]', main).forEach((b) => { b.onclick = () => modalDoc(p, p.documentos.find((x) => x.id === +b.dataset.doc)); });
  $$('[data-pra]', main).forEach((b) => { b.onclick = () => modalPrazo(p, p.prazos.find((x) => x.id === +b.dataset.pra)); });
  $$('[data-cum]', main).forEach((c) => { c.onchange = () => tentar(async () => { await api('POST', `api/prazos/${c.dataset.cum}/cumprir`, { cumprido: c.checked }); await atualizaAlertas(); recarrega(); }); });
  const fa = $('#fand'); if (fa) fa.onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('POST', `api/procedimentos/${p.id}/andamentos`, Object.fromEntries(new FormData(fa).entries())); toast('Andamento registrado.'); recarrega(); }); };
}
const ctl = (m, close) => ({ cancel: () => { $('[data-n]', m).onclick = close; } });
function modalSituacao(p) {
  const outras = SITUACOES.filter((s) => s !== p.situacao);
  modal(h`<h2>Alterar situação</h2><div class="err-msg hide" id="err"></div>
    <label>Nova situação</label><select id="ns">${outras.map((s) => h`<option>${s}</option>`)}</select>
    <div id="fech" class="hide"><div class="form" style="margin-top:12px"><div><label>Resultado / penalidade</label><select id="pen"><option value="">—</option>${state.config.penalidades.map((x) => h`<option>${x}</option>`)}</select></div><div><label>Data da decisão</label><input type="date" id="dd" value="${hojeSP()}"></div>
      <div class="full"><label>Decisão (resumo)</label><textarea id="dec" maxlength="8000" style="min-height:90px"></textarea></div></div></div>
    <label style="margin-top:12px" id="lobs">Observação (opcional)</label><textarea id="ob" maxlength="3000" style="min-height:70px"></textarea>
    <div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s, {
    fixo: true,
    onMount: (m, close) => {
      const sync = () => {
        const v = $('#ns', m).value, fech = ENCERRADAS.includes(v), reab = p.encerrado && !fech;
        $('#fech', m).classList.toggle('hide', !fech);
        $('#lobs', m).textContent = reab ? 'Motivo da reabertura (obrigatório)' : v === 'Arquivado' ? 'Motivo do arquivamento (obrigatório)' : 'Observação (opcional)';
      };
      $('#ns', m).onchange = sync; sync(); $('[data-n]', m).onclick = close;
      $('[data-s]', m).onclick = () => tentar(async () => {
        await api('POST', `api/procedimentos/${p.id}/situacao`, { situacao: $('#ns', m).value, observacao: $('#ob', m).value, penalidade: $('#pen', m).value, decisao: $('#dec', m).value, data_decisao: $('#dd', m).value });
        close(); toast('Situação atualizada.'); await atualizaAlertas(); recarrega();
      }, $('#err', m));
    },
  });
}
function modalProrrogar(p) {
  const min = addD(p.prazo_conclusao && p.prazo_conclusao > hojeSP() ? p.prazo_conclusao : hojeSP(), 1);
  modal(h`<h2>Prorrogar prazo de conclusão</h2><div class="err-msg hide" id="err"></div>
    <p class="hint">Prazo atual: <b>${p.prazo_conclusao ? fmtData(p.prazo_conclusao) : 'não definido'}</b> ${p.prorrogacoes ? '· ' + plural(p.prorrogacoes, 'prorrogação anterior', 'prorrogações anteriores') : ''}</p>
    <label>Nova data limite</label><input type="date" id="np" min="${min}" value="${addD(min, 29)}">
    <label style="margin-top:12px">Justificativa (obrigatória)</label><textarea id="mo" maxlength="3000" style="min-height:90px" placeholder="Motivo da prorrogação, conforme a portaria ou o estatuto aplicável"></textarea>
    <div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Prorrogar</button></div>`.s, {
    fixo: true,
    onMount: (m, close) => { $('[data-n]', m).onclick = close; $('[data-s]', m).onclick = () => tentar(async () => { await api('POST', `api/procedimentos/${p.id}/prorrogar`, { novo_prazo: $('#np', m).value, motivo: $('#mo', m).value }); close(); toast('Prazo prorrogado.'); await atualizaAlertas(); recarrega(); }, $('#err', m)); },
  });
}
function modalComissao(p) {
  const linha = (m = { usuario_id: '', funcao: 'Membro' }) => h`<div class="rowx"><select data-u><option value="">Selecione o servidor…</option>${state.usuarios.map((u) => h`<option value="${u.id}" ${u.id === m.usuario_id ? raw('selected') : ''}>${u.nome}${u.cargo ? ' — ' + u.cargo : ''}</option>`)}</select><select data-f class="f">${FUNCOES.map((f) => h`<option ${f === m.funcao ? raw('selected') : ''}>${f}</option>`)}</select><button type="button" class="btn sm dng" data-rm>✕</button></div>`;
  modal(h`<h2>Comissão / equipe responsável</h2><div class="err-msg hide" id="err"></div>
    <p class="hint">Os membros designados passam a ter acesso a este procedimento, mesmo que sigiloso. Apenas um(a) Presidente.</p>
    <div id="lista">${p.comissao.length ? p.comissao.map(linha) : linha()}</div><button type="button" class="btn sm" id="add">＋ Adicionar membro</button>
    <div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s, {
    fixo: true, largo: true,
    onMount: (m, close) => {
      const lista = $('#lista', m), liga = () => $$('[data-rm]', lista).forEach((b) => { b.onclick = () => b.parentElement.remove(); });
      liga(); $('#add', m).onclick = () => { const d = document.createElement('div'); d.innerHTML = linha().s; lista.append(d.firstElementChild); liga(); };
      $('[data-n]', m).onclick = close;
      $('[data-s]', m).onclick = () => tentar(async () => {
        const membros = $$('.rowx', lista).map((r) => ({ usuario_id: +$('[data-u]', r).value, funcao: $('[data-f]', r).value })).filter((x) => x.usuario_id);
        await api('PUT', `api/procedimentos/${p.id}/comissao`, { membros }); close(); toast('Comissão atualizada.'); recarrega();
      }, $('#err', m));
    },
  });
}
function modalParte(p, x) {
  modal(h`<h2>${x ? 'Editar envolvido' : 'Adicionar envolvido'}</h2><div class="err-msg hide" id="err"></div><div class="form">
    <div><label>Papel</label><select id="pa">${PAPEIS.map((r) => h`<option ${r === x?.papel ? raw('selected') : ''}>${r}</option>`)}</select></div>
    <div><label>Nome *</label><input id="no" value="${x?.nome || ''}" maxlength="150"></div>
    <div><label>CPF / matrícula</label><input id="do" value="${x?.documento || ''}" maxlength="40"></div>
    <div><label>Cargo / lotação</label><input id="ca" value="${x?.cargo || ''}" maxlength="120"></div>
    <div class="full"><label>Contato</label><input id="co" value="${x?.contato || ''}" maxlength="150"></div>
    <div class="full"><label>Observação</label><input id="ob" value="${x?.observacao || ''}" maxlength="500"></div></div>
    <div class="acts">${x && p.pode_gerir ? '<button class="btn dng" data-x style="margin-right:auto">Remover</button>' : ''}<button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s, {
    fixo: true,
    onMount: (m, close) => {
      $('[data-n]', m).onclick = close;
      $('[data-s]', m).onclick = () => tentar(async () => {
        const b = { papel: $('#pa', m).value, nome: $('#no', m).value, documento: $('#do', m).value, cargo: $('#ca', m).value, contato: $('#co', m).value, observacao: $('#ob', m).value };
        x ? await api('PUT', 'api/partes/' + x.id, b) : await api('POST', `api/procedimentos/${p.id}/partes`, b);
        close(); toast('Envolvido salvo.'); recarrega();
      }, $('#err', m));
      const rm = $('[data-x]', m); if (rm) rm.onclick = async () => { if (await confirma(`Remover ${x.nome} do procedimento?`, 'Remover')) tentar(async () => { await api('DELETE', 'api/partes/' + x.id); close(); toast('Removido.'); recarrega(); }); };
    },
  });
}
function modalPrazo(p, x) {
  modal(h`<h2>${x ? 'Editar prazo / audiência' : 'Novo prazo / audiência'}</h2><div class="err-msg hide" id="err"></div><div class="form">
    <div><label>Tipo</label><select id="ti">${TIPOS_PRAZO.map((t) => h`<option ${t === x?.tipo ? raw('selected') : ''}>${t}</option>`)}</select></div>
    <div><label>Data *</label><input type="date" id="da" value="${x?.data || ''}"></div>
    <div><label>Horário (opcional)</label><input type="time" id="ho" value="${x?.hora || ''}"></div>
    <div class="full"><label>Descrição *</label><input id="de" value="${x?.descricao || ''}" maxlength="200" placeholder="Ex.: Oitiva do investigado / Prazo para apresentação de defesa"></div></div>
    <div class="acts">${x ? '<button class="btn dng" data-x style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s, {
    fixo: true,
    onMount: (m, close) => {
      $('[data-n]', m).onclick = close;
      $('[data-s]', m).onclick = () => tentar(async () => {
        const b = { tipo: $('#ti', m).value, data: $('#da', m).value, hora: $('#ho', m).value, descricao: $('#de', m).value };
        x ? await api('PUT', 'api/prazos/' + x.id, b) : await api('POST', `api/procedimentos/${p.id}/prazos`, b);
        close(); toast('Prazo salvo.'); await atualizaAlertas(); recarrega();
      }, $('#err', m));
      const rm = $('[data-x]', m); if (rm) rm.onclick = async () => { if (await confirma('Excluir este prazo?', 'Excluir')) tentar(async () => { await api('DELETE', 'api/prazos/' + x.id); close(); toast('Prazo excluído.'); await atualizaAlertas(); recarrega(); }); };
    },
  });
}
function modalDoc(p, x) {
  modal(h`<h2>${x ? 'Editar documento' : 'Registrar documento'}</h2><div class="err-msg hide" id="err"></div><div class="form">
    <div class="full"><label>Título *</label><input id="ti" value="${x?.titulo || ''}" maxlength="200" placeholder="Ex.: Portaria de instauração"></div>
    <div><label>Tipo</label><select id="tp"><option value="">—</option>${TIPOS_DOC.map((t) => h`<option ${t === x?.tipo ? raw('selected') : ''}>${t}</option>`)}</select></div>
    <div><label>Número no 1Doc</label><input id="nd" value="${x?.numero_doc || ''}" maxlength="60"></div>
    <div><label>Data do documento</label><input type="date" id="da" value="${x?.data || ''}"></div>
    <div><label>Link (opcional)</label><input id="li" value="${x?.link || ''}" maxlength="500" placeholder="https://…"></div>
    <div class="full"><label>Observação</label><input id="ob" value="${x?.observacao || ''}" maxlength="500"></div></div>
    <div class="acts">${x && p.pode_gerir ? '<button class="btn dng" data-x style="margin-right:auto">Remover</button>' : ''}<button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s, {
    fixo: true,
    onMount: (m, close) => {
      $('[data-n]', m).onclick = close;
      $('[data-s]', m).onclick = () => tentar(async () => {
        const b = { titulo: $('#ti', m).value, tipo: $('#tp', m).value, numero_doc: $('#nd', m).value, data: $('#da', m).value, link: $('#li', m).value, observacao: $('#ob', m).value };
        x ? await api('PUT', 'api/documentos/' + x.id, b) : await api('POST', `api/procedimentos/${p.id}/documentos`, b);
        close(); toast('Documento registrado.'); recarrega();
      }, $('#err', m));
      const rm = $('[data-x]', m); if (rm) rm.onclick = async () => { if (await confirma('Remover este documento do registro?', 'Remover')) tentar(async () => { await api('DELETE', 'api/documentos/' + x.id); close(); toast('Removido.'); recarrega(); }); };
    },
  });
}

/* ====== prazos e audiências ====== */
const PRZ = { status: 'pendentes', abertos: '1' };
async function pgPrazos(main) {
  const lista = await api('GET', 'api/prazos?' + new URLSearchParams(PRZ));
  main.innerHTML = topo('Prazos e audiências') + h`<div class="card">
    <div class="chips">${[['pendentes', 'Pendentes'], ['cumpridos', 'Cumpridos'], ['todos', 'Todos']].map(([v, l]) => h`<button class="chip ${PRZ.status === v ? 'on' : ''}" data-st="${v}">${l}</button>`)}</div>
    <label class="chk" style="display:flex;gap:6px;align-items:center;font-weight:600;margin:0 0 10px"><input type="checkbox" id="inc" style="width:auto" ${PRZ.abertos === '0' ? raw('checked') : ''}> Incluir procedimentos encerrados</label>
    <div class="hint" style="margin-bottom:6px">${plural(lista.length, 'item', 'itens')}</div>
    ${lista.length ? lista.map((r) => h`<div class="lista-i clicavel ${r.cumprido ? 'feito' : ''}" data-p="${r.procedimento_id}"><div class="dt">${fmtData(r.data)}${r.hora ? h`<div class="sub">${r.hora}</div>` : ''}</div><div class="x"><b>${r.descricao}</b><span class="sub">${r.tipo} · ${r.numero}${r.sigilo === 'sigiloso' ? ' 🔒' : ''} — ${r.assunto}</span></div>${prazoItemBadge(r)}</div>`) : h`<div class="empty">Nenhum prazo ou audiência.</div>`}</div>`.s;
  $$('[data-st]', main).forEach((b) => { b.onclick = () => { PRZ.status = b.dataset.st; recarrega(); }; });
  $('#inc').onchange = (e) => { PRZ.abertos = e.target.checked ? '0' : '1'; recarrega(); };
  $$('[data-p]', main).forEach((el) => { el.onclick = () => irProc(el.dataset.p); });
}

/* ====== alertas ====== */
async function pgAlertas(main) {
  const a = await api('GET', 'api/alertas'); state.alertas = a; atualizaBadge();
  const sec = (tit, n, corpo) => (n ? h`<div class="card" style="margin-bottom:14px"><h2>${tit} (${n})</h2>${corpo}</div>` : '');
  main.innerHTML = topo('Alertas') + h`<p style="color:var(--mut);margin-top:-8px">Prazos, audiências e prescrições que exigem atenção nos procedimentos que você pode acessar. Antecedência: ${a.dias_alerta} dias para prazos e ${a.dias_alerta_prescricao} dias para prescrição (definidos pelo administrador).</p>
    ${a.total ? '' : h`<div class="card empty">✅ Nenhum alerta no momento.</div>`}
    ${sec('⚖️ Prescrição', a.prescricoes.length, a.prescricoes.map((r) => h`<div class="lista-i clicavel" data-p="${r.id}"><div class="dt">${fmtData(r.prescricao_data)}</div><div class="x"><b>${r.numero} ${r.sigilo === 'sigiloso' ? '🔒' : ''}</b><span class="sub">${r.assunto}${r.prescricao_base ? ' · ' + r.prescricao_base : ''}</span></div>${prescBadge(r)}</div>`))}
    ${sec('🗓 Prazos e audiências', a.prazos.length, a.prazos.map((r) => h`<div class="lista-i clicavel" data-p="${r.procedimento_id}"><div class="dt">${fmtData(r.data)}${r.hora ? h`<div class="sub">${r.hora}</div>` : ''}</div><div class="x"><b>${r.descricao}</b><span class="sub">${r.tipo} · ${r.numero}${r.sigilo === 'sigiloso' ? ' 🔒' : ''}</span></div>${prazoItemBadge(r)}</div>`))}
    ${sec('📅 Prazo de conclusão dos procedimentos', a.procedimentos.length, a.procedimentos.map((r) => h`<div class="lista-i clicavel" data-p="${r.id}"><div class="dt">${fmtData(r.prazo_conclusao)}</div><div class="x"><b>${r.numero} ${r.sigilo === 'sigiloso' ? '🔒' : ''}</b><span class="sub">${r.tipo} · ${r.assunto}</span></div>${prazoBadge(r)}</div>`))}`.s;
  $$('[data-p]', main).forEach((el) => { el.onclick = () => irProc(el.dataset.p); });
}

/* ====== usuários (admin) ====== */
function gerarSenha() {
  const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789', r = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return Array.from({ length: 6 }, () => r(a)).join('') + Array.from({ length: 3 }, () => r(d)).join('');
}
async function pgUsuarios(main) {
  const lista = await api('GET', 'api/usuarios');
  main.innerHTML = topo('Usuários', '<button class="btn pri" id="novo">＋ Novo usuário</button>') + h`<div class="card"><div class="hint" style="margin-bottom:10px"><b>Administrador:</b> gerencia usuários e configurações e acessa tudo. <b>Corregedor(a):</b> acessa todos os procedimentos, designa comissões e vê a trilha de acesso. <b>Membro:</b> acessa os procedimentos internos e os sigilosos em que foi designado.</div><div class="tbl-wrap"><table>
    <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead><tbody>
    ${lista.map((u) => h`<tr><td><b>${u.nome}</b><div class="sub">${[u.cargo, u.email].filter(Boolean).join(' · ')}</div></td><td>${u.login}</td>
      <td><span class="badge ${u.perfil === 'admin' ? 'b-blu' : u.perfil === 'corregedor' ? 'b-pur' : 'b-gry'}">${PERFIL[u.perfil]}</span></td>
      <td><span class="badge ${u.ativo ? 'b-grn' : 'b-red'}">${u.ativo ? 'Ativo' : 'Inativo'}</span>${u.trocar_senha ? h` <span class="badge b-amb">Senha provisória</span>` : ''}</td>
      <td>${fmtDT(u.ultimo_acesso)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-ed="${u.id}">Editar</button> <button class="btn sm" data-pw="${u.id}">Redefinir senha</button></td></tr>`)}</tbody></table></div></div>`.s;
  const form = (u) => h`<h2>${u ? 'Editar usuário' : 'Novo usuário'}</h2><div class="err-msg hide" id="err"></div><div class="form">
    <div class="full"><label>Nome completo *</label><input id="n" value="${u?.nome || ''}" maxlength="120"></div>
    <div><label>Login *</label><input id="l" value="${u?.login || ''}" ${u ? raw('disabled') : ''} maxlength="40" autocomplete="off"></div>
    <div><label>Perfil</label><select id="p">${Object.entries(PERFIL).map(([k, v]) => h`<option value="${k}" ${k === (u?.perfil || 'membro') ? raw('selected') : ''}>${v}</option>`)}</select></div>
    <div><label>Cargo / Função</label><input id="c" value="${u?.cargo || ''}" maxlength="120"></div>
    <div><label>E-mail</label><input id="e" type="email" value="${u?.email || ''}" maxlength="120"></div>
    ${u ? h`<div class="full"><label><input type="checkbox" id="a" style="width:auto" ${u.ativo ? raw('checked') : ''}> Usuário ativo (pode acessar o sistema)</label></div>`
      : h`<div class="full"><label>Senha provisória *</label><input id="s" type="text" autocomplete="off" value="${gerarSenha()}"><div class="hint">Mínimo de 8 caracteres, com letras e números. O usuário será obrigado a trocá-la no primeiro acesso.</div></div>`}</div>
    <div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s;
  const abre = (u) => modal(form(u), { fixo: true, onMount: (m, close) => {
    $('[data-n]', m).onclick = close;
    $('[data-s]', m).onclick = () => tentar(async () => {
      const g = (i) => $('#' + i, m)?.value;
      if (u) await api('PUT', 'api/usuarios/' + u.id, { nome: g('n'), perfil: g('p'), cargo: g('c'), email: g('e'), ativo: $('#a', m).checked });
      else { await api('POST', 'api/usuarios', { nome: g('n'), login: g('l'), perfil: g('p'), cargo: g('c'), email: g('e'), senha: g('s') }); alert(`Usuário criado.\n\nLogin: ${g('l')}\nSenha provisória: ${g('s')}\n\nEntregue essas informações ao usuário. A senha deverá ser trocada no primeiro acesso.`); }
      close(); toast('Usuário salvo.'); recarrega();
    }, $('#err', m)); } });
  $('#novo').onclick = () => abre(null);
  $$('[data-ed]', main).forEach((b) => { b.onclick = () => abre(lista.find((u) => u.id === +b.dataset.ed)); });
  $$('[data-pw]', main).forEach((b) => { b.onclick = () => {
    const u = lista.find((x) => x.id === +b.dataset.pw);
    modal(h`<h2>Redefinir senha de ${u.nome}</h2><div class="err-msg hide" id="err"></div><label>Nova senha provisória</label><input id="s" value="${gerarSenha()}" autocomplete="off">
      <div class="hint">O usuário será desconectado e deverá trocar a senha no próximo acesso.</div><div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Redefinir</button></div>`.s, {
      fixo: true,
      onMount: (m, close) => { $('[data-n]', m).onclick = close; $('[data-s]', m).onclick = () => tentar(async () => { await api('POST', `api/usuarios/${u.id}/senha`, { senha: $('#s', m).value }); alert(`Senha redefinida.\n\nLogin: ${u.login}\nSenha provisória: ${$('#s', m).value}`); close(); recarrega(); }, $('#err', m)); } });
  }; });
}

/* ====== configurações / trilha de acesso / conta ====== */
async function pgConfig(main) {
  const c = await api('GET', 'api/config');
  const lTipo = (t) => h`<div class="rowx"><input data-nome value="${t.nome}" maxlength="80" placeholder="Nome do tipo" style="flex:1"><input data-dias type="number" min="0" max="1000" value="${t.prazo_dias}" style="width:90px;flex:none" title="Prazo padrão de conclusão, em dias (0 = sem prazo)"><span class="hint" style="white-space:nowrap">dias</span><button type="button" class="btn sm dng" data-rm>✕</button></div>`;
  const lPre = (t) => h`<div class="rowx"><input data-nome value="${t.nome}" maxlength="60" placeholder="Penalidade" style="flex:1"><input data-dias type="number" min="1" max="20000" value="${t.dias}" style="width:100px;flex:none"><span class="hint" style="white-space:nowrap">dias</span><button type="button" class="btn sm dng" data-rm>✕</button></div>`;
  main.innerHTML = topo('Configurações') + h`<form id="f"><div class="err-msg hide" id="err"></div><div class="grid g2">
    <div class="card"><h2>Tipos de procedimento e prazo de conclusão</h2><div id="tipos">${c.tipos.map(lTipo)}</div><button type="button" class="btn sm" id="at">＋ Adicionar tipo</button>
      <div class="hint" style="margin-top:8px">O prazo é a sugestão automática ao cadastrar (a partir da instauração). Ajuste conforme o Estatuto dos Servidores do município. Use 0 para não sugerir prazo.</div></div>
    <div class="card"><h2>Prazos prescricionais (modelos de cálculo)</h2><div id="pres">${c.prescricoes.map(lPre)}</div><button type="button" class="btn sm" id="ap">＋ Adicionar</button>
      <div class="hint" style="margin-top:8px">Os valores iniciais seguem o modelo federal (advertência 180 dias, suspensão 2 anos, demissão 5 anos). <b>Confirme com a legislação municipal.</b></div></div>
    <div class="card"><h2>Origens</h2><textarea id="ori" style="min-height:160px">${c.origens.join('\n')}</textarea><div class="hint">Uma por linha.</div></div>
    <div class="card"><h2>Resultados / penalidades</h2><textarea id="pen" style="min-height:160px">${c.penalidades.join('\n')}</textarea><div class="hint">Uma por linha. Usadas ao encerrar um procedimento.</div></div>
    <div class="card"><h2>Antecedência dos alertas</h2><div class="form"><div><label>Prazos e audiências (dias)</label><input type="number" id="da" min="1" max="60" value="${c.dias_alerta}"></div><div><label>Prescrição (dias)</label><input type="number" id="dp" min="1" max="730" value="${c.dias_alerta_prescricao}"></div></div></div>
    </div><button class="btn pri" style="margin-top:16px">Salvar configurações</button></form>`.s;
  const liga = (box) => $$('[data-rm]', box).forEach((b) => { b.onclick = () => b.parentElement.remove(); });
  const tipos = $('#tipos', main), pres = $('#pres', main); liga(tipos); liga(pres);
  $('#at', main).onclick = () => { const d = document.createElement('div'); d.innerHTML = lTipo({ nome: '', prazo_dias: 0 }).s; tipos.append(d.firstElementChild); liga(tipos); };
  $('#ap', main).onclick = () => { const d = document.createElement('div'); d.innerHTML = lPre({ nome: '', dias: 365 }).s; pres.append(d.firstElementChild); liga(pres); };
  $('#f', main).onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    const lin = (box, k) => $$('.rowx', box).map((r) => ({ nome: $('[data-nome]', r).value, [k]: +$('[data-dias]', r).value }));
    state.config = await api('PUT', 'api/config', { tipos: lin(tipos, 'prazo_dias'), prescricoes: lin(pres, 'dias'), origens: $('#ori').value.split('\n'), penalidades: $('#pen').value.split('\n'), dias_alerta: $('#da').value, dias_alerta_prescricao: $('#dp').value });
    toast('Configurações salvas.');
  }, $('#err', main)); };
}
async function pgAuditoria(main, _, termo = '') {
  const l = await api('GET', 'api/auditoria' + (termo ? '?q=' + encodeURIComponent(termo) : ''));
  main.innerHTML = topo('Trilha de acesso e auditoria') + h`<p style="color:var(--mut);margin-top:-8px">Registro das últimas 500 ações, incluindo cada consulta a procedimentos (quem viu, o quê e quando). Consultas repetidas em até 10 minutos aparecem uma vez.</p>
    <div class="card"><div class="filters"><input type="search" id="q" placeholder="Filtrar por usuário, ação ou procedimento…" value="${termo}"></div><div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Usuário</th><th>IP</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${l.map((a) => h`<tr><td style="white-space:nowrap">${fmtDT(a.criado_em)}</td><td>${a.usuario_nome || '—'}</td><td>${a.ip || ''}</td><td><span class="badge ${a.acao === 'procedimento_visualizado' ? 'b-blu' : a.acao === 'login_falhou' ? 'b-red' : 'b-gry'}">${a.acao}</span></td><td>${a.detalhe || ''}</td></tr>`)}</tbody></table></div></div>`.s;
  let t; const q = $('#q', main); q.oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { await pgAuditoria(main, null, e.target.value.trim()); const n = $('#q', main); n.focus(); n.setSelectionRange(1e4, 1e4); }, 400); };
}
async function pgConta(main) {
  const u = state.user;
  main.innerHTML = topo('Minha conta') + h`<div class="grid g2" style="max-width:900px"><div class="card"><h2>Meus dados</h2><dl class="kv"><dt>Nome</dt><dd>${u.nome}</dd><dt>Login</dt><dd>${u.login}</dd><dt>Perfil</dt><dd>${PERFIL[u.perfil]}</dd><dt>Cargo</dt><dd>${u.cargo || '—'}</dd></dl></div>
    <form class="card" id="f"><h2>Alterar senha</h2><div class="err-msg hide" id="err"></div>
      <label>Senha atual</label><input type="password" name="a" required autocomplete="current-password">
      <label style="margin-top:10px">Nova senha</label><input type="password" name="n" minlength="8" required autocomplete="new-password"><div class="hint">Mínimo de 8 caracteres, com letras e números.</div>
      <button class="btn pri" style="margin-top:14px">Alterar senha</button></form></div>`.s;
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('POST', 'api/me/senha', { atual: e.target.a.value, nova: e.target.n.value }); e.target.reset(); toast('Senha alterada.'); }, $('#err')); };
}

boot();
