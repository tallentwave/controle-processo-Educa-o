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
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmtData = (d) => (d ? d.split('-').reverse().join('/') : '—');
const fmtDT = (s) => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); };
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && state.user) { state.user = null; render(); }
    const e = new Error(data.erro || 'Erro inesperado.'); e.status = r.status; throw e;
  }
  return data;
}
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 4000);
}
function modal(content, { onMount } = {}) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  const close = () => ov.remove();
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  document.body.append(ov);
  onMount && onMount(ov.firstElementChild, close);
  const f = $('input,select,textarea', ov); f && f.focus();
  return close;
}
const confirma = (msg, label = 'Confirmar') => new Promise((res) => {
  modal(h`<h2>${msg}</h2><div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn dng" data-s>${label}</button></div>`.s, {
    onMount: (m, close) => { $('[data-n]', m).onclick = () => { close(); res(false); }; $('[data-s]', m).onclick = () => { close(); res(true); }; },
  });
});
async function tentar(fn, errBox) {
  try { return await fn(); } catch (e) { if (errBox) { errBox.textContent = e.message; errBox.classList.remove('hide'); } else toast(e.message, true); }
}

/* ====== estado ====== */
const state = { user: null, config: null, hoje: null, alertas: { itens: [] }, usuarios: [], ready: false };
const STATUS = ['Aberto', 'Em andamento', 'Aguardando', 'Concluído', 'Arquivado'];
const PRIOS = ['Baixa', 'Normal', 'Alta', 'Urgente'];
const SIT = { vencido: ['b-red', 'Vencido'], hoje: ['b-amb', 'Vence hoje'], proximo: ['b-amb', 'A vencer'], no_prazo: ['b-grn', 'No prazo'], sem_prazo: ['b-gry', 'Sem prazo'], encerrado: ['b-gry', 'Encerrado'] };
const stBadge = (s) => h`<span class="badge ${{ Aberto: 'b-blu', 'Em andamento': 'b-blu', Aguardando: 'b-amb', 'Concluído': 'b-grn', Arquivado: 'b-gry' }[s]}">${s}</span>`;
const prBadge = (p) => h`<span class="badge ${{ Baixa: 'b-gry', Normal: 'b-gry', Alta: 'b-amb', Urgente: 'b-red' }[p]}">${p}</span>`;
function prazoTxt(p) {
  if (!p.prazo) return 'Sem prazo';
  const d = p.dias_restantes;
  if (p.situacao === 'encerrado') return fmtData(p.prazo);
  if (d < 0) return `${plural(-d, 'dia', 'dias')} em atraso`;
  if (d === 0) return 'Vence hoje';
  return d === 1 ? 'Vence amanhã' : `Faltam ${d} dias`;
}
const prazoBadge = (p) => { const [c] = SIT[p.situacao]; return h`<span class="badge ${c}">${prazoTxt(p)}</span>`; };

/* ====== inicialização ====== */
async function boot() {
  try {
    const me = await api('GET', '/api/me');
    state.user = me; state.config = me.config; state.hoje = me.hoje;
  } catch { state.user = null; }
  state.ready = true; render();
}

async function carregaContexto() {
  const [al, us] = await Promise.all([api('GET', '/api/alertas'), api('GET', '/api/usuarios')]);
  state.alertas = al; state.usuarios = us.filter((u) => u.ativo !== 0);
}

/* ====== roteamento ====== */
window.addEventListener('hashchange', () => { if (state.user) renderPagina(); });

function render() {
  const app = $('#app');
  if (!state.ready) return;
  if (!state.user) return telaLogin(app);
  if (state.user.trocar_senha) return telaTrocaSenha(app);
  app.innerHTML = '';
  carregaContexto().then(() => { montaShell(app); renderPagina(); }).catch((e) => toast(e.message, true));
}

function montaShell(app) {
  const u = state.user, adm = u.perfil === 'admin';
  const n = state.alertas.itens.length;
  app.innerHTML = h`<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="logo">${raw(ICONE)}</div><div>Controle de Processos<small>Secretaria Municipal de Educação</small></div></div>
      <nav class="nav">
        <a href="#/painel" data-r="painel">📊 Painel</a>
        <a href="#/processos" data-r="processos">📁 Processos</a>
        <a href="#/alertas" data-r="alertas">🔔 Alertas de prazo ${n ? h`<span class="badge">${n}</span>` : ''}</a>
        ${adm ? h`<div class="nav-sep">Administração</div>
          <a href="#/usuarios" data-r="usuarios">👥 Usuários</a>
          <a href="#/config" data-r="config">⚙️ Configurações</a>
          <a href="#/auditoria" data-r="auditoria">🧾 Auditoria</a>` : ''}
      </nav>
      <div class="me"><b>${u.nome}</b>${adm ? 'Administrador' : (u.cargo || 'Usuário')}
        <button id="conta">Minha conta</button><button id="sair">Sair</button></div>
    </aside>
    <main class="main" id="main"></main></div>`.s;
  $('#sair').onclick = async () => { await api('POST', '/api/logout'); state.user = null; location.hash = ''; render(); };
  $('#conta').onclick = () => location.hash = '#/conta';
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
}
const raw = (s) => new Safe(s);
const ICONE = '<svg width="22" height="22" viewBox="0 0 32 32"><path d="M5 12l11-6 11 6-11 6z M10 16v6c0 3 12 3 12 0v-6" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';

const PAGINAS = {
  painel: pgPainel, processos: pgLista, alertas: pgAlertas, usuarios: pgUsuarios, config: pgConfig, auditoria: pgAuditoria, conta: pgConta, processo: pgDetalhe, form: pgForm,
};
async function renderPagina() {
  const main = $('#main'); if (!main) return;
  const [rotaBase = 'painel', a, b] = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'painel').split('/');
  let page = rotaBase, arg = a;
  if (rotaBase === 'processos' && a === 'novo') page = 'form', arg = null;
  else if (rotaBase === 'processos' && a && b === 'editar') page = 'form';
  else if (rotaBase === 'processos' && a) page = 'processo';
  if (!PAGINAS[page] || (['usuarios', 'config', 'auditoria'].includes(page) && state.user.perfil !== 'admin')) { location.hash = '#/painel'; return; }
  const nav = ['painel', 'processos', 'alertas', 'usuarios', 'config', 'auditoria'].includes(page) ? page : (page === 'processo' || page === 'form' ? 'processos' : '');
  $$('.nav a').forEach((x) => x.classList.toggle('on', x.dataset.r === nav));
  main.innerHTML = '<div class="empty">Carregando…</div>';
  try { await PAGINAS[page](main, arg ? decodeURIComponent(arg) : null); } catch (e) { main.innerHTML = h`<div class="card empty">${e.message}</div>`.s; }
  window.scrollTo(0, 0);
}
const topo = (titulo, extra = '') => h`<div class="top"><button class="btn menu-btn" onclick="document.getElementById('side').classList.toggle('open')">☰</button><h1>${titulo}</h1><div class="sp"></div>${raw(extra)}</div>`.s;
const lerQuery = () => Object.fromEntries(new URLSearchParams((location.hash.split('?')[1]) || ''));

/* ====== login ====== */
function telaLogin(app) {
  app.innerHTML = h`<div class="login"><form class="card" id="f">
    <div class="logo">${raw(ICONE)}</div><h1>Controle de Processos</h1><p class="s">Secretaria Municipal de Educação</p>
    <div class="err-msg hide" id="err"></div>
    <div class="f"><label for="l">Usuário</label><input id="l" autocomplete="username" required autofocus></div>
    <div class="f"><label for="s">Senha</label><input id="s" type="password" autocomplete="current-password" required></div>
    <button class="btn pri" style="width:100%;justify-content:center">Entrar</button>
    <p class="hint" style="text-align:center;margin-top:14px">Não tem acesso? Solicite ao administrador do sistema.</p></form></div>`.s;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    await tentar(async () => {
      state.user = await api('POST', '/api/login', { login: $('#l').value, senha: $('#s').value });
      const me = await api('GET', '/api/me'); state.user = me; state.config = me.config; state.hoje = me.hoje;
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
  $('#sair').onclick = async () => { await api('POST', '/api/logout'); state.user = null; render(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#n').value !== $('#n2').value) { $('#err').textContent = 'As senhas não conferem.'; $('#err').classList.remove('hide'); return; }
    await tentar(async () => {
      await api('POST', '/api/me/senha', { atual: $('#a').value, nova: $('#n').value });
      state.user.trocar_senha = false; toast('Senha alterada com sucesso.'); location.hash = '#/painel'; render();
    }, $('#err'));
  };
}

/* ====== painel ====== */
async function pgPainel(main) {
  const p = await api('GET', '/api/painel');
  const bars = (arr, cor) => { const max = Math.max(1, ...arr.map((x) => x.total)); return arr.length ? h`<div class="bars">${arr.map((x) => h`<div class="row"><span title="${x.nome}">${x.nome}</span><div class="bar"><i style="width:${(x.total / max) * 100}%"></i></div><b>${x.total}</b></div>`)}</div>` : h`<div class="empty">Sem dados.</div>`; };
  const urg = p.vencidos + p.hoje;
  main.innerHTML = topo(`Olá, ${state.user.nome.split(' ')[0]}!`, '<a class="btn pri" href="#/processos/novo">＋ Novo processo</a>') + h`
    ${urg ? h`<div class="alert-banner"><span style="font-size:1.4rem">⚠️</span><div><b>${p.vencidos ? plural(p.vencidos, 'processo com prazo vencido', 'processos com prazo vencido') : ''}${p.vencidos && p.hoje ? ' e ' : ''}${p.hoje ? plural(p.hoje, 'vence hoje', 'vencem hoje') : ''}.</b><br>Priorize esses processos para evitar atrasos.</div><a href="#/alertas">Ver alertas →</a></div>`
      : p.proximos ? h`<div class="alert-banner amb"><span style="font-size:1.4rem">⏰</span><div><b>${plural(p.proximos, 'processo vence', 'processos vencem')} nos próximos ${p.dias_alerta} dias.</b></div><a href="#/alertas">Ver alertas →</a></div>`
      : h`<div class="alert-banner" style="background:var(--grn-l);border-color:#bbf7d0;color:#14532d">✅ <b>Nenhum prazo vencido ou próximo do vencimento. Tudo em dia!</b></div>`}
    <div class="grid g4" style="margin-bottom:14px">
      <a class="card stat red" href="#/processos?prazo=vencidos"><div class="n">${p.vencidos}</div><div class="l">Prazos vencidos</div></a>
      <a class="card stat amb" href="#/processos?prazo=hoje"><div class="n">${p.hoje}</div><div class="l">Vencem hoje</div></a>
      <a class="card stat amb" href="#/processos?prazo=alerta"><div class="n">${p.proximos}</div><div class="l">Vencem em até ${p.dias_alerta} dias</div></a>
      <a class="card stat blu" href="#/processos?status=abertos"><div class="n">${p.total_abertos}</div><div class="l">Processos em aberto</div></a>
      <a class="card stat blu" href="#/processos?responsavel=meus&status=abertos"><div class="n">${p.meus_abertos}</div><div class="l">Sob minha responsabilidade</div></a>
      <a class="card stat" href="#/processos?prazo=sem"><div class="n">${p.sem_prazo}</div><div class="l">Em aberto sem prazo</div></a>
      <a class="card stat grn" href="#/processos?status=Conclu%C3%ADdo"><div class="n">${p.concluidos_ano}</div><div class="l">Concluídos em ${state.hoje.slice(0, 4)}</div></a>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Em aberto por tipo</h2>${bars(p.por_tipo)}</div>
      <div class="card"><h2>Carga por responsável</h2>${p.por_responsavel.length ? h`<div class="bars">${p.por_responsavel.map((x) => h`<div class="row"><span>${x.nome}</span><div class="bar"><i style="width:${(x.total / Math.max(...p.por_responsavel.map((y) => y.total))) * 100}%"></i></div><b>${x.total}</b></div>${x.vencidos ? h`<div class="hint" style="margin:-4px 0 4px"><span class="badge b-red">${plural(x.vencidos, 'vencido', 'vencidos')}</span></div>` : ''}`)}</div>` : h`<div class="empty">Sem dados.</div>`}</div>
      <div class="card" style="grid-column:1/-1"><h2>Últimas movimentações</h2>
        ${p.recentes.length ? h`<ul class="timeline">${p.recentes.map((m) => h`<li class="${m.tipo}"><a href="#/processos/${m.processo_id}"><b>${m.numero}</b></a> — ${m.texto}<div class="who">${m.usuario_nome || 'Sistema'} · ${fmtDT(m.criado_em)}</div></li>`)}</ul>` : h`<div class="empty">Nenhuma movimentação ainda.</div>`}</div>
    </div>`.s;
}

/* ====== lista de processos ====== */
function tabelaProcessos(lista) {
  if (!lista.length) return h`<div class="empty">Nenhum processo encontrado.</div>`;
  return h`<div class="tbl-wrap"><table><thead><tr><th>Número</th><th>Assunto</th><th>Responsável</th><th>Situação</th><th>Prioridade</th><th>Prazo</th></tr></thead><tbody>
    ${lista.map((p) => h`<tr class="row s-${p.situacao}" data-id="${p.id}">
      <td class="num">${p.numero}</td>
      <td><b>${p.assunto}</b><div class="sub">${[p.tipo, p.interessado].filter(Boolean).join(' · ')}</div></td>
      <td>${p.responsavel_nome || '—'}</td><td>${stBadge(p.status)}</td><td>${prBadge(p.prioridade)}</td>
      <td>${fmtData(p.prazo)}<div>${prazoBadge(p)}</div></td></tr>`)}</tbody></table></div>`;
}
const abreLinha = (root) => $$('tr.row', root).forEach((tr) => tr.onclick = () => location.hash = `#/processos/${tr.dataset.id}`);

async function pgLista(main) {
  const q = lerQuery();
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  const lista = await api('GET', '/api/processos' + (qs ? '?' + qs : ''));
  const chips = [['', 'Todos'], ['vencidos', 'Vencidos'], ['hoje', 'Vencem hoje'], ['alerta', `Próximos ${state.config.dias_alerta} dias`], ['sem', 'Sem prazo']];
  const set = (k, v) => { const n = { ...lerQuery(), [k]: v }; location.hash = '#/processos?' + new URLSearchParams(Object.entries(n).filter(([, x]) => x)).toString(); };
  const opt = (arr, cur) => arr.map((x) => h`<option ${x === cur ? raw('selected') : ''}>${x}</option>`);
  main.innerHTML = topo('Processos', `<a class="btn" href="/api/exportar.csv${qs ? '?' + qs : ''}">⬇ Exportar CSV</a><button class="btn" onclick="print()">🖨 Imprimir</button><a class="btn pri" href="#/processos/novo">＋ Novo processo</a>`) + h`
    <div class="card">
      <div class="chips">${chips.map(([v, l]) => h`<button class="chip ${(q.prazo || '') === v ? 'on' : ''}" data-prazo="${v}">${l}</button>`)}</div>
      <div class="filters">
        <input type="search" id="busca" placeholder="Buscar por número, assunto, interessado ou origem…" value="${q.q || ''}">
        <select id="fstatus"><option value="">Todas as situações</option><option value="abertos" ${q.status === 'abertos' ? raw('selected') : ''}>Somente em aberto</option>${opt(STATUS, q.status)}</select>
        <select id="ftipo"><option value="">Todos os tipos</option>${opt(state.config.tipos, q.tipo)}</select>
        <select id="fresp"><option value="">Todos os responsáveis</option><option value="meus" ${q.responsavel === 'meus' ? raw('selected') : ''}>Somente os meus</option>${state.usuarios.map((u) => h`<option value="${u.id}" ${String(u.id) === q.responsavel ? raw('selected') : ''}>${u.nome}</option>`)}</select>
      </div>
      <div class="hint" style="margin-bottom:8px">${plural(lista.length, 'processo', 'processos')}</div>
      ${tabelaProcessos(lista)}</div>`.s;
  $$('.chip', main).forEach((c) => c.onclick = () => set('prazo', c.dataset.prazo));
  let t; $('#busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => set('q', e.target.value.trim()), 400); };
  $('#busca').onfocus = (e) => e.target.setSelectionRange(1e4, 1e4);
  $('#fstatus').onchange = (e) => set('status', e.target.value); $('#ftipo').onchange = (e) => set('tipo', e.target.value); $('#fresp').onchange = (e) => set('responsavel', e.target.value);
  abreLinha(main);
}

/* ====== alertas ====== */
async function pgAlertas(main) {
  const a = await api('GET', '/api/alertas');
  const grupos = [['vencido', '🔴 Prazos vencidos', 'b-red'], ['hoje', '🟠 Vencem hoje', 'b-amb'], ['proximo', `🟡 Vencem nos próximos ${a.dias_alerta} dias`, 'b-amb']];
  const adm = state.user.perfil === 'admin';
  main.innerHTML = topo('Alertas de prazo') + h`<p style="color:var(--mut);margin-top:-8px">${adm ? 'Todos os processos em aberto' : 'Seus processos em aberto'} que exigem atenção. Os alertas consideram o limite de ${a.dias_alerta} dias definido nas configurações.</p>
    ${a.itens.length ? grupos.map(([s, t]) => { const l = a.itens.filter((i) => i.situacao === s); return l.length ? h`<div class="card" style="margin-bottom:14px"><h2>${t} (${l.length})</h2>${tabelaProcessos(l)}</div>` : ''; })
      : h`<div class="card empty">✅ Nenhum alerta no momento. Todos os prazos estão em dia.</div>`}`.s;
  abreLinha(main);
}

/* ====== formulário de processo ====== */
async function pgForm(main, _) {
  const partes = location.hash.replace('#/', '').split('?')[0].split('/');
  const id = partes[1] !== 'novo' ? partes[1] : null;
  const p = id ? await api('GET', '/api/processos/' + id) : { prioridade: 'Normal', data_abertura: state.hoje, responsavel_id: state.user.id };
  const resp = state.usuarios;
  const adm = state.user.perfil === 'admin';
  main.innerHTML = topo(id ? `Editar processo ${p.numero}` : 'Novo processo') + h`<form class="card" id="f"><div class="err-msg hide" id="err"></div><div class="form">
    <div class="full"><label>Assunto <span class="req">*</span></label><input name="assunto" value="${p.assunto || ''}" maxlength="300" required placeholder="Ex.: Solicitação de transporte escolar – Zona Rural"></div>
    <div><label>Tipo</label><select name="tipo"><option value="">Selecione…</option>${state.config.tipos.map((t) => h`<option ${t === p.tipo ? raw('selected') : ''}>${t}</option>`)}</select></div>
    <div><label>Prioridade</label><select name="prioridade">${PRIOS.map((t) => h`<option ${t === p.prioridade ? raw('selected') : ''}>${t}</option>`)}</select></div>
    <div><label>Interessado / Requerente</label><input name="interessado" value="${p.interessado || ''}" maxlength="200" placeholder="Nome do aluno, servidor, empresa…"></div>
    <div><label>Escola / Setor de origem</label><input name="origem" value="${p.origem || ''}" maxlength="200"></div>
    <div><label>Data de abertura</label><input type="date" name="data_abertura" value="${p.data_abertura || ''}" required></div>
    <div><label>Prazo final</label><input type="date" name="prazo" value="${p.prazo || ''}"><div class="hint">Você será alertado ${state.config.dias_alerta} dias antes do vencimento.</div></div>
    <div><label>Responsável</label><select name="responsavel_id"><option value="">Sem responsável</option>${resp.map((u) => h`<option value="${u.id}" ${u.id === p.responsavel_id ? raw('selected') : ''}>${u.nome}</option>`)}</select></div>
    <div class="full"><label>Descrição / Observações</label><textarea name="descricao" maxlength="5000">${p.descricao || ''}</textarea></div>
  </div><div style="display:flex;gap:8px;margin-top:18px"><button class="btn pri">${id ? 'Salvar alterações' : 'Abrir processo'}</button><a class="btn" href="#/processos${id ? '/' + id : ''}">Cancelar</a></div></form>`.s;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    await tentar(async () => {
      const r = id ? await api('PUT', '/api/processos/' + id, body) : await api('POST', '/api/processos', body);
      toast(id ? 'Processo atualizado.' : `Processo ${r.numero} aberto.`); location.hash = '#/processos/' + (id || r.id);
      const al = await api('GET', '/api/alertas'); state.alertas = al;
    }, $('#err'));
  };
}

/* ====== detalhe ====== */
async function pgDetalhe(main, id) {
  const p = await api('GET', '/api/processos/' + id);
  const u = state.user, pode = u.perfil === 'admin' || p.responsavel_id === u.id || p.criado_por === u.id;
  const msg = { vencido: `⛔ Prazo vencido — ${prazoTxt(p)} (${fmtData(p.prazo)})`, hoje: `⚠️ O prazo vence hoje (${fmtData(p.prazo)})`, proximo: `⏰ ${prazoTxt(p)} — prazo em ${fmtData(p.prazo)}`, no_prazo: `✅ ${prazoTxt(p)} — prazo em ${fmtData(p.prazo)}`, sem_prazo: 'Sem prazo definido', encerrado: `Processo ${p.status.toLowerCase()}${p.data_conclusao ? ' em ' + fmtData(p.data_conclusao) : ''}` }[p.situacao];
  main.innerHTML = topo(`Processo ${p.numero}`, `<a class="btn" href="#/processos">← Voltar</a><button class="btn" onclick="print()">🖨 Imprimir</button>${pode ? `<a class="btn" href="#/processos/${p.id}/editar">✏️ Editar</a>` : ''}${u.perfil === 'admin' ? '<button class="btn dng" id="del">Excluir</button>' : ''}`) + h`
    <div class="deadline ${p.situacao}">${msg}</div>
    <div class="det"><div class="card"><h2>${p.assunto}</h2>
      <dl class="kv"><dt>Situação</dt><dd>${stBadge(p.status)} ${pode ? h`<button class="btn sm" id="mst">Alterar situação</button>` : ''}</dd>
        <dt>Prioridade</dt><dd>${prBadge(p.prioridade)}</dd><dt>Tipo</dt><dd>${p.tipo || '—'}</dd><dt>Interessado</dt><dd>${p.interessado || '—'}</dd>
        <dt>Origem</dt><dd>${p.origem || '—'}</dd><dt>Responsável</dt><dd>${p.responsavel_nome || '—'}</dd>
        <dt>Abertura</dt><dd>${fmtData(p.data_abertura)}</dd><dt>Prazo</dt><dd>${fmtData(p.prazo)}</dd>
        ${p.data_conclusao ? h`<dt>Conclusão</dt><dd>${fmtData(p.data_conclusao)}</dd>` : ''}</dl>
      ${p.descricao ? h`<h3 style="margin-top:16px">Descrição</h3><p style="white-space:pre-wrap;margin:0">${p.descricao}</p>` : ''}</div>
    <div class="card"><h2>Andamento</h2>
      <form id="fm"><textarea name="texto" placeholder="Registrar andamento, despacho ou observação…" maxlength="3000" required style="min-height:70px"></textarea><button class="btn pri sm" style="margin:8px 0 16px">Registrar</button></form>
      <ul class="timeline">${p.movimentacoes.map((m) => h`<li class="${m.tipo}">${m.texto}<div class="who">${m.usuario_nome || 'Sistema'} · ${fmtDT(m.criado_em)}</div></li>`)}</ul></div></div>`.s;
  $('#fm').onsubmit = async (e) => { e.preventDefault(); await tentar(async () => { await api('POST', `/api/processos/${id}/movimentacoes`, { texto: e.target.texto.value }); toast('Andamento registrado.'); renderPagina(); }); };
  if ($('#del')) $('#del').onclick = async () => { if (await confirma(`Excluir o processo ${p.numero}? Essa ação não pode ser desfeita.`, 'Excluir')) await tentar(async () => { await api('DELETE', '/api/processos/' + id); toast('Processo excluído.'); location.hash = '#/processos'; }); };
  if ($('#mst')) $('#mst').onclick = () => modal(h`<h2>Alterar situação</h2><div class="err-msg hide" id="err"></div>
    <label>Nova situação</label><select id="ns">${STATUS.map((s) => h`<option ${s === p.status ? raw('selected') : ''}>${s}</option>`)}</select>
    <label style="margin-top:12px">Observação (opcional)</label><textarea id="ob" maxlength="2000" style="min-height:70px"></textarea>
    <div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s, {
    onMount: (m, close) => { $('[data-n]', m).onclick = close; $('[data-s]', m).onclick = () => tentar(async () => { await api('POST', `/api/processos/${id}/status`, { status: $('#ns', m).value, observacao: $('#ob', m).value }); close(); toast('Situação atualizada.'); state.alertas = await api('GET', '/api/alertas'); renderPagina(); }, $('#err', m)); },
  });
}

/* ====== usuários (admin) ====== */
async function pgUsuarios(main) {
  const lista = await api('GET', '/api/usuarios');
  main.innerHTML = topo('Usuários', '<button class="btn pri" id="novo">＋ Novo usuário</button>') + h`<div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead><tbody>
    ${lista.map((u) => h`<tr><td><b>${u.nome}</b><div class="sub">${[u.cargo, u.email].filter(Boolean).join(' · ')}</div></td><td>${u.login}</td>
      <td><span class="badge ${u.perfil === 'admin' ? 'b-blu' : 'b-gry'}">${u.perfil === 'admin' ? 'Administrador' : 'Usuário'}</span></td>
      <td><span class="badge ${u.ativo ? 'b-grn' : 'b-red'}">${u.ativo ? 'Ativo' : 'Inativo'}</span>${u.trocar_senha ? h` <span class="badge b-amb">Senha provisória</span>` : ''}</td>
      <td>${fmtDT(u.ultimo_acesso)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-ed="${u.id}">Editar</button> <button class="btn sm" data-pw="${u.id}">Redefinir senha</button></td></tr>`)}</tbody></table></div></div>`.s;
  const form = (u) => h`<h2>${u ? 'Editar usuário' : 'Novo usuário'}</h2><div class="err-msg hide" id="err"></div><div class="form">
    <div class="full"><label>Nome completo *</label><input id="n" value="${u?.nome || ''}" maxlength="120"></div>
    <div><label>Login *</label><input id="l" value="${u?.login || ''}" ${u ? raw('disabled') : ''} maxlength="40" autocomplete="off"></div>
    <div><label>Perfil</label><select id="p"><option value="usuario" ${u?.perfil === 'usuario' ? raw('selected') : ''}>Usuário</option><option value="admin" ${u?.perfil === 'admin' ? raw('selected') : ''}>Administrador</option></select></div>
    <div><label>Cargo / Setor</label><input id="c" value="${u?.cargo || ''}" maxlength="120"></div>
    <div><label>E-mail</label><input id="e" type="email" value="${u?.email || ''}" maxlength="120"></div>
    ${u ? h`<div class="full"><label><input type="checkbox" id="a" style="width:auto" ${u.ativo ? raw('checked') : ''}> Usuário ativo (pode acessar o sistema)</label></div>`
      : h`<div class="full"><label>Senha provisória *</label><input id="s" type="text" autocomplete="off" value="${gerarSenha()}"><div class="hint">Mínimo de 8 caracteres, com letras e números. O usuário será obrigado a trocá-la no primeiro acesso.</div></div>`}</div>
    <div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s;
  const abre = (u) => modal(form(u), { onMount: (m, close) => {
    $('[data-n]', m).onclick = close;
    $('[data-s]', m).onclick = () => tentar(async () => {
      const g = (i) => $('#' + i, m)?.value;
      if (u) await api('PUT', '/api/usuarios/' + u.id, { nome: g('n'), perfil: g('p'), cargo: g('c'), email: g('e'), ativo: $('#a', m).checked });
      else { await api('POST', '/api/usuarios', { nome: g('n'), login: g('l'), perfil: g('p'), cargo: g('c'), email: g('e'), senha: g('s') }); alert(`Usuário criado.\n\nLogin: ${g('l')}\nSenha provisória: ${g('s')}\n\nEntregue essas informações ao usuário. A senha deverá ser trocada no primeiro acesso.`); }
      close(); toast('Usuário salvo.'); renderPagina();
    }, $('#err', m)); } });
  $('#novo').onclick = () => abre(null);
  $$('[data-ed]', main).forEach((b) => b.onclick = () => abre(lista.find((u) => u.id === +b.dataset.ed)));
  $$('[data-pw]', main).forEach((b) => b.onclick = () => {
    const u = lista.find((x) => x.id === +b.dataset.pw);
    modal(h`<h2>Redefinir senha de ${u.nome}</h2><div class="err-msg hide" id="err"></div><label>Nova senha provisória</label><input id="s" value="${gerarSenha()}" autocomplete="off">
      <div class="hint">O usuário será desconectado e deverá trocar a senha no próximo acesso.</div><div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Redefinir</button></div>`.s, {
      onMount: (m, close) => { $('[data-n]', m).onclick = close; $('[data-s]', m).onclick = () => tentar(async () => { await api('POST', `/api/usuarios/${u.id}/senha`, { senha: $('#s', m).value }); alert(`Senha redefinida.\n\nLogin: ${u.login}\nSenha provisória: ${$('#s', m).value}`); close(); renderPagina(); }, $('#err', m)); } });
  });
}
function gerarSenha() {
  const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789', r = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return Array.from({ length: 6 }, () => r(a)).join('') + Array.from({ length: 3 }, () => r(d)).join('');
}

/* ====== configurações / auditoria / conta ====== */
async function pgConfig(main) {
  const c = await api('GET', '/api/config');
  main.innerHTML = topo('Configurações') + h`<form class="card" id="f" style="max-width:640px"><div class="err-msg hide" id="err"></div>
    <label>Antecedência do alerta de prazo (dias)</label><input type="number" name="dias" min="1" max="60" value="${c.dias_alerta}" style="max-width:120px">
    <div class="hint">Processos em aberto que vencem dentro desse período aparecem como “a vencer” nos alertas e no painel.</div>
    <label style="margin-top:18px">Tipos de processo (um por linha)</label><textarea name="tipos" style="min-height:200px">${c.tipos.join('\n')}</textarea>
    <button class="btn pri" style="margin-top:16px">Salvar configurações</button></form>`.s;
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    state.config = await api('PUT', '/api/config', { dias_alerta: e.target.dias.value, tipos: e.target.tipos.value.split('\n') }); toast('Configurações salvas.'); }, $('#err')); };
}
async function pgAuditoria(main) {
  const l = await api('GET', '/api/auditoria');
  main.innerHTML = topo('Auditoria') + h`<p style="color:var(--mut);margin-top:-8px">Registro das últimas 300 ações realizadas no sistema.</p><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${l.map((a) => h`<tr><td style="white-space:nowrap">${fmtDT(a.criado_em)}</td><td>${a.usuario_nome || '—'}</td><td><span class="badge b-gry">${a.acao}</span></td><td>${a.detalhe || ''}</td></tr>`)}</tbody></table></div></div>`.s;
}
async function pgConta(main) {
  const u = state.user;
  main.innerHTML = topo('Minha conta') + h`<div class="grid g2" style="max-width:900px"><div class="card"><h2>Meus dados</h2><dl class="kv"><dt>Nome</dt><dd>${u.nome}</dd><dt>Login</dt><dd>${u.login}</dd><dt>Perfil</dt><dd>${u.perfil === 'admin' ? 'Administrador' : 'Usuário'}</dd><dt>Cargo</dt><dd>${u.cargo || '—'}</dd></dl></div>
    <form class="card" id="f"><h2>Alterar senha</h2><div class="err-msg hide" id="err"></div>
      <label>Senha atual</label><input type="password" name="a" required autocomplete="current-password">
      <label style="margin-top:10px">Nova senha</label><input type="password" name="n" minlength="8" required autocomplete="new-password"><div class="hint">Mínimo de 8 caracteres, com letras e números.</div>
      <button class="btn pri" style="margin-top:14px">Alterar senha</button></form></div>`.s;
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('POST', '/api/me/senha', { atual: e.target.a.value, nova: e.target.n.value }); e.target.reset(); toast('Senha alterada.'); }, $('#err')); };
}

boot();
// atualiza alertas periodicamente (a cada 5 min)
setInterval(() => { if (state.user && !state.user.trocar_senha) api('GET', '/api/alertas').then((a) => { state.alertas = a; const b = $('.nav a[data-r=alertas]'); if (b) { const n = a.itens.length; b.innerHTML = '🔔 Alertas de prazo' + (n ? `<span class="badge">${n}</span>` : ''); } }).catch(() => {}); }, 300000);
