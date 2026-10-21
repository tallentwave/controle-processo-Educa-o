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

function pascoa(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  return new Date(y, Math.floor((hh + l - 7 * m + 114) / 31) - 1, ((hh + l - 7 * m + 114) % 31) + 1);
}
const _fer = {};
function feriados(y) {
  if (_fer[y]) return _fer[y];
  const m = {}, add = (data, nome, fac) => { m[typeof data === 'string' ? data : iso(data)] = { nome, fac: !!fac }; };
  [['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'], ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Sra. Aparecida'],
    ['11-02', 'Finados'], ['11-15', 'Proclamação da República'], ['11-20', 'Consciência Negra'], ['12-25', 'Natal']].forEach(([d, n]) => add(`${y}-${d}`, n));
  const p = pascoa(y), mv = (n) => { const d = new Date(p); d.setDate(d.getDate() + n); return d; };
  add(mv(-48), 'Carnaval (ponto facultativo)', true); add(mv(-47), 'Carnaval (ponto facultativo)', true);
  add(mv(-2), 'Sexta-feira Santa'); add(mv(60), 'Corpus Christi (ponto facultativo)', true);
  return (_fer[y] = m);
}
const feriadoDe = (s) => feriados(+s.slice(0, 4))[s];

/* ====== estado ====== */
const state = { user: null, config: null, usuarios: [], recursos: [], alertas: { total: 0 }, ready: false };
const cor = (cat) => (state.config.categorias.find((c) => c.nome === cat) || {}).cor || '#475467';
const STATUS = ['Agendado', 'Confirmado', 'Realizado', 'Cancelado', 'Adiado'];
const PRIOS = ['Baixa', 'Normal', 'Alta', 'Urgente'];
const REC = { nenhuma: 'Não se repete', diaria: 'Todos os dias', semanal: 'Toda semana', quinzenal: 'A cada 15 dias', mensal: 'Todo mês', anual: 'Todo ano' };
const VISIB = { publica: 'Todos os usuários veem', participantes: 'Somente participantes', privada: 'Somente eu' };
const LEMB = [['', 'Sem lembrete'], [0, 'No horário'], [5, '5 minutos antes'], [10, '10 minutos antes'], [15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes'], [120, '2 horas antes'], [1440, '1 dia antes'], [2880, '2 dias antes']];
const stBadge = (s) => h`<span class="badge ${{ Agendado: 'b-blu', Confirmado: 'b-grn', Realizado: 'b-gry', Cancelado: 'b-red', Adiado: 'b-amb' }[s]}">${s}</span>`;
const prBadge = (p) => h`<span class="badge ${{ Baixa: 'b-gry', Normal: 'b-gry', Alta: 'b-amb', Urgente: 'b-red' }[p]}">${p}</span>`;
const respBadge = (r) => h`<span class="badge ${{ aceito: 'b-grn', recusado: 'b-red', pendente: 'b-gry' }[r]}">${{ aceito: 'Aceitou', recusado: 'Recusou', pendente: 'Pendente' }[r]}</span>`;
const ICONE = '<svg width="22" height="22" viewBox="0 0 32 32"><rect x="7" y="9" width="18" height="16" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M7 14h18M12 6v5M20 6v5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';

/* ====== inicialização ====== */
async function boot() {
  try { const me = await api('GET', 'api/me'); state.user = me; state.config = me.config; } catch { state.user = null; }
  state.ready = true; render();
}
async function carregaContexto() {
  const [al, us, rc, cf] = await Promise.all([api('GET', 'api/alertas'), api('GET', 'api/usuarios'), api('GET', 'api/recursos'), api('GET', 'api/config')]);
  state.alertas = al; state.usuarios = us.filter((u) => u.ativo !== 0); state.recursos = rc; state.config = cf;
}
window.addEventListener('hashchange', () => { if (state.user && !state.user.trocar_senha && $('#main')) renderPagina(); });

function render() {
  const app = $('#app');
  if (!state.ready) return;
  if (!state.user) return telaLogin(app);
  if (state.user.trocar_senha) return telaTrocaSenha(app);
  app.innerHTML = '';
  carregaContexto().then(() => { montaShell(app); renderPagina(); iniciaLembretes(); }).catch((e) => toast(e.message, true));
}

function montaShell(app) {
  const u = state.user, adm = u.perfil === 'admin', n = state.alertas.total;
  app.innerHTML = h`<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="logo">${raw(ICONE)}</div><div>Agenda<small>Secretaria Municipal de Educação</small></div></div>
      <nav class="nav">
        <a href="#/painel" data-r="painel">📊 Painel</a>
        <a href="#/agenda" data-r="agenda">📅 Agenda</a>
        <a href="#/tarefas" data-r="tarefas">✅ Tarefas</a>
        <a href="#/contatos" data-r="contatos">📇 Contatos</a>
        <a href="#/alertas" data-r="alertas">🔔 Alertas <span class="badge ${n ? '' : 'zero'}" id="nbadge">${n}</span></a>
        ${adm ? h`<div class="nav-sep">Administração</div>
          <a href="#/usuarios" data-r="usuarios">👥 Usuários</a>
          <a href="#/config" data-r="config">⚙️ Configurações</a>
          <a href="#/auditoria" data-r="auditoria">🧾 Auditoria</a>` : ''}
      </nav>
      <div class="me"><b>${u.nome}</b>${adm ? 'Administrador' : (u.cargo || 'Usuário')}
        <button id="conta">Minha conta</button><button id="sair">Sair</button></div>
    </aside>
    <main class="main" id="main"></main></div>`.s;
  $('#sair').onclick = async () => { await api('POST', 'api/logout'); state.user = null; location.hash = ''; render(); };
  $('#conta').onclick = () => { location.hash = '#/conta'; };
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
}
const atualizaBadge = () => { const b = $('#nbadge'); if (b) { b.textContent = state.alertas.total; b.classList.toggle('zero', !state.alertas.total); } };

const PAGINAS = { painel: pgPainel, agenda: pgAgenda, tarefas: pgTarefas, contatos: pgContatos, alertas: pgAlertas, usuarios: pgUsuarios, config: pgConfig, auditoria: pgAuditoria, conta: pgConta };
async function renderPagina() {
  const main = $('#main'); if (!main) return;
  const page = (location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0]) || 'painel';
  if (!PAGINAS[page] || (['usuarios', 'config', 'auditoria'].includes(page) && state.user.perfil !== 'admin')) { location.hash = '#/painel'; return; }
  $$('.nav a').forEach((x) => x.classList.toggle('on', x.dataset.r === page));
  main.innerHTML = '<div class="empty">Carregando…</div>';
  try { await PAGINAS[page](main); } catch (e) { console.error(e.stack || e); main.innerHTML = h`<div class="card empty">${e.message}</div>`.s; }
  window.scrollTo(0, 0);
}
const topo = (titulo, extra = '') => h`<div class="top"><button class="btn menu-btn" onclick="document.getElementById('side').classList.toggle('open')">☰</button><h1>${titulo}</h1><div class="sp"></div>${raw(extra)}</div>`.s;
const lerQuery = () => Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
const recarrega = () => renderPagina();

/* ====== login ====== */
function telaLogin(app) {
  app.innerHTML = h`<div class="login"><form class="card" id="f">
    <div class="logo">${raw(ICONE)}</div><h1>Agenda</h1><p class="s">Secretaria Municipal de Educação</p>
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
const itemMini = (o) => h`<div class="mini" style="--c:${cor(o.categoria)}" data-ev="${o.id}" data-oc="${o.ocorrencia}"><div class="bar"></div>
  <div class="t">${o.dia_inteiro ? 'Dia todo' : hhmm(o.inicio)}</div><div class="x"><b>${o.titulo}</b><span>${[fmtCurto(o.ocorrencia), o.local || o.recurso_nome].filter(Boolean).join(' · ')}</span></div></div>`;
const ligaEventos = (root) => $$('[data-ev]', root).forEach((el) => { el.onclick = (e) => { e.stopPropagation(); abreEvento(+el.dataset.ev, el.dataset.oc); }; });

async function pgPainel(main) {
  const p = await api('GET', 'api/painel');
  const max = Math.max(1, ...p.por_categoria.map((x) => x.total));
  const urg = p.tarefas_atrasadas + p.convites.length;
  main.innerHTML = topo(`Olá, ${state.user.nome.split(' ')[0]}!`, '<button class="btn pri" id="novo">＋ Novo compromisso</button>') + h`
    ${urg ? h`<div class="alert-banner"><span style="font-size:1.4rem">⚠️</span><div><b>${[p.convites.length ? plural(p.convites.length, 'convite aguardando resposta', 'convites aguardando resposta') : '', p.tarefas_atrasadas ? plural(p.tarefas_atrasadas, 'tarefa atrasada', 'tarefas atrasadas') : ''].filter(Boolean).join(' e ')}.</b></div><a href="#/alertas">Ver alertas →</a></div>`
      : p.hoje.length ? h`<div class="alert-banner amb"><span style="font-size:1.4rem">📅</span><div><b>Você tem ${plural(p.hoje.length, 'compromisso', 'compromissos')} hoje.</b></div><a href="#/agenda?v=dia">Abrir o dia →</a></div>`
      : h`<div class="alert-banner" style="background:var(--grn-l);border-color:#bbf7d0;color:#14532d">✅ <b>Nenhum compromisso para hoje e nada pendente. Agenda em dia!</b></div>`}
    <div class="grid g4" style="margin-bottom:14px">
      <a class="card stat blu" href="#/agenda?v=dia"><div class="n">${p.hoje.length}</div><div class="l">Compromissos hoje</div></a>
      <a class="card stat blu" href="#/agenda?v=semana"><div class="n">${p.proximos.length}</div><div class="l">Nos próximos 7 dias</div></a>
      <a class="card stat amb" href="#/alertas"><div class="n">${p.convites.length}</div><div class="l">Convites pendentes</div></a>
      <a class="card stat red" href="#/tarefas"><div class="n">${p.tarefas_atrasadas}</div><div class="l">Tarefas atrasadas</div></a>
      <a class="card stat amb" href="#/tarefas"><div class="n">${p.tarefas_hoje}</div><div class="l">Tarefas para hoje</div></a>
      <a class="card stat" href="#/agenda"><div class="n">${p.eventos_mes}</div><div class="l">Compromissos no mês (Secretaria)</div></a>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Minha agenda de hoje</h2>${p.hoje.length ? p.hoje.map(itemMini) : h`<div class="empty">Nenhum compromisso hoje.</div>`}</div>
      <div class="card"><h2>Próximos 7 dias</h2>${p.proximos.length ? p.proximos.slice(0, 8).map(itemMini) : h`<div class="empty">Nada agendado para os próximos dias.</div>`}</div>
      <div class="card"><h2>Reservas de hoje</h2>${p.reservas_hoje.length ? p.reservas_hoje.map((o) => h`<div class="mini" style="--c:${cor(o.categoria)}" data-ev="${o.id}" data-oc="${o.ocorrencia}"><div class="bar"></div><div class="t">${o.dia_inteiro ? 'Dia todo' : hhmm(o.inicio)}</div><div class="x"><b>${o.recurso_nome}</b><span>${o.titulo}</span></div></div>`) : h`<div class="empty">Nenhum espaço ou veículo reservado hoje.</div>`}</div>
      <div class="card"><h2>Minhas tarefas</h2>${p.tarefas.length ? p.tarefas.map((t) => h`<div class="mini" onclick="location.hash='#/tarefas'"><div class="x"><b>${t.titulo}</b><span>${t.prazo ? 'Prazo ' + fmtData(t.prazo) : 'Sem prazo'}</span></div>${prazoTarefa(t)}</div>`) : h`<div class="empty">Nenhuma tarefa pendente.</div>`}</div>
      <div class="card" style="grid-column:1/-1"><h2>Compromissos do mês por categoria</h2>${p.por_categoria.length ? h`<div class="bars">${p.por_categoria.map((x) => h`<div class="row"><span title="${x.nome}">${x.nome}</span><div class="bar"><i style="width:${(x.total / max) * 100}%;background:${cor(x.nome)}"></i></div><b>${x.total}</b></div>`)}</div>` : h`<div class="empty">Sem compromissos neste mês.</div>`}</div>
    </div>`.s;
  $('#novo').onclick = () => abreForm(null, { data: hojeSP() });
  ligaEventos(main);
}

/* ====== agenda (calendário) ====== */
const CAL = { v: le('ag_view', window.innerWidth < 700 ? 'lista' : 'mes'), d: null, categoria: '', recurso: '', meus: false };
function intervaloCal() {
  const { v, d } = CAL;
  if (v === 'mes') { const pri = d.slice(0, 8) + '01', ult = addD(addMes(pri, 1), -1); return [iniSemana(pri), addD(iniSemana(ult), 6)]; }
  if (v === 'semana') { const i = iniSemana(d); return [i, addD(i, 6)]; }
  if (v === 'dia') return [d, d];
  return [d, addD(d, 30)];
}
function tituloCal() {
  const { v, d } = CAL, dt = pd(d);
  if (v === 'mes') return `${MESES[dt.getMonth()]} de ${dt.getFullYear()}`;
  if (v === 'semana') { const i = pd(iniSemana(d)), f = pd(addD(iniSemana(d), 6)); return i.getMonth() === f.getMonth() ? `${i.getDate()} – ${f.getDate()} de ${MESES[f.getMonth()]} de ${f.getFullYear()}` : `${i.getDate()} ${MESES[i.getMonth()].slice(0, 3)} – ${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)} ${f.getFullYear()}`; }
  if (v === 'dia') return `${DIAS_L[dt.getDay()]}, ${dt.getDate()} de ${MESES[dt.getMonth()]} de ${dt.getFullYear()}`;
  return `Próximos 30 dias · a partir de ${fmtData(d)}`;
}
function irCal(v, d) { CAL.v = v; CAL.d = d; guarda('ag_view', v); location.hash = `#/agenda?v=${v}&d=${d}`; }
// divide um compromisso em um segmento por dia (compromissos que atravessam dias)
function segmentos(o) {
  const out = [], i = o.inicio.slice(0, 10), f = o.fim.slice(0, 10);
  for (let d = i, n = 0; d <= f && n < 400; d = addD(d, 1), n++) {
    const s = { ...o, dia: d, m0: d === i && !o.dia_inteiro ? mins(o.inicio) : 0, m1: d === f && !o.dia_inteiro ? mins(o.fim) : 1440, primeiro: d === i };
    if (d > i && !o.dia_inteiro && s.m1 === 0) continue;
    out.push(s);
  }
  return out;
}
const porDia = (ocs) => { const m = {}; for (const o of ocs) for (const s of segmentos(o)) (m[s.dia] ||= []).push(s); return m; };
const pendente = (o) => o.minha_resposta === 'pendente';
const chipEv = (s) => h`<button class="chip-ev ${s.dia_inteiro ? 'dia' : ''} ${s.status === 'Cancelado' ? 'canc' : ''} ${pendente(s) ? 'pend' : ''}" style="--c:${cor(s.categoria)}" data-ev="${s.id}" data-oc="${s.ocorrencia}" title="${s.titulo}${s.local ? ' — ' + s.local : ''}">${s.dia_inteiro || !s.primeiro ? '' : h`<span class="hr">${hhmm(s.inicio)}</span>`}${s.titulo}</button>`;

async function pgAgenda(main) {
  const q = lerQuery(), hoje = hojeSP();
  if (q.v && ['mes', 'semana', 'dia', 'lista'].includes(q.v)) CAL.v = q.v;
  CAL.d = q.d && /^\d{4}-\d{2}-\d{2}$/.test(q.d) ? q.d : (CAL.d || hoje);
  const [de, ate] = intervaloCal();
  const qs = new URLSearchParams({ inicio: de, fim: ate, ...(CAL.categoria ? { categoria: CAL.categoria } : {}), ...(CAL.recurso ? { recurso: CAL.recurso } : {}), ...(CAL.meus ? { meus: 1 } : {}) });
  const ocs = await api('GET', 'api/eventos?' + qs);
  const passo = { mes: 0, semana: 7, dia: 1, lista: 30 }[CAL.v];
  const nav = (n) => (CAL.v === 'mes' ? addMes(CAL.d.slice(0, 8) + '01', n) : addD(CAL.d, n * passo));
  const cats = state.config.categorias;
  main.innerHTML = topo('Agenda', `<a class="btn" href="api/exportar.ics" title="Baixar minha agenda para Google Agenda, Outlook ou celular">⬇ Exportar .ics</a><button class="btn" onclick="print()">🖨 Imprimir</button><button class="btn pri" id="novo">＋ Novo compromisso</button>`) + h`
    <div class="cal-bar">
      <div class="cal-nav"><button class="btn" id="hoje">Hoje</button><button class="btn" id="ant" aria-label="Anterior">‹</button><button class="btn" id="prox" aria-label="Próximo">›</button><h2 class="cal-title">${tituloCal()}</h2></div>
      <div class="sp"></div>
      <div class="chips views">${[['mes', 'Mês'], ['semana', 'Semana'], ['dia', 'Dia'], ['lista', 'Lista']].map(([v, l]) => h`<button class="chip ${CAL.v === v ? 'on' : ''}" data-v="${v}">${l}</button>`)}</div>
    </div>
    <div class="filters">
      <select id="fcat"><option value="">Todas as categorias</option>${cats.map((c) => h`<option ${c.nome === CAL.categoria ? raw('selected') : ''}>${c.nome}</option>`)}</select>
      <select id="frec"><option value="">Todos os espaços e veículos</option>${state.recursos.map((r) => h`<option value="${r.id}" ${String(r.id) === String(CAL.recurso) ? raw('selected') : ''}>${r.nome}</option>`)}</select>
      <label class="chk"><input type="checkbox" id="fmeus" ${CAL.meus ? raw('checked') : ''}> Somente os meus</label>
    </div>
    <div class="leg">${cats.map((c) => h`<span><i style="--c:${c.cor}"></i>${c.nome}</span>`)}</div>
    <div class="card cal-wrap" id="cal">${CAL.v === 'mes' ? vMes(ocs, de, ate) : CAL.v === 'lista' ? vLista(ocs, de, ate) : vSemana(ocs, de, ate)}</div>`.s;
  $('#novo').onclick = () => abreForm(null, { data: CAL.v === 'mes' || CAL.v === 'lista' ? hoje : CAL.d });
  $('#hoje').onclick = () => irCal(CAL.v, hoje);
  $('#ant').onclick = () => irCal(CAL.v, nav(-1));
  $('#prox').onclick = () => irCal(CAL.v, nav(1));
  $$('[data-v]', main).forEach((b) => { b.onclick = () => irCal(b.dataset.v, CAL.d); });
  $('#fcat').onchange = (e) => { CAL.categoria = e.target.value; recarrega(); };
  $('#frec').onchange = (e) => { CAL.recurso = e.target.value; recarrega(); };
  $('#fmeus').onchange = (e) => { CAL.meus = e.target.checked; recarrega(); };
  ligaEventos(main);
  $$('[data-ir]', main).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); irCal('dia', b.dataset.ir); }; });
  $$('[data-novo]', main).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); abreForm(null, { data: b.dataset.novo }); }; });
  $$('.col[data-dia]', main).forEach((col) => { col.onclick = (e) => {
    if (e.target !== col) return;
    const y = e.offsetY, hh = +col.dataset.h0 + Math.floor((y / 50) * 2) / 2;
    abreForm(null, { data: col.dataset.dia, hora: `${pad(Math.floor(hh))}:${hh % 1 ? '30' : '00'}` });
  }; });
  $$('.sem-head .d', main).forEach((d) => { d.onclick = () => irCal('dia', d.dataset.dia); });
  const agora = $('.agora', main); if (agora) agora.scrollIntoView({ block: 'center' });
}

function vMes(ocs, de, ate) {
  const m = porDia(ocs), hoje = hojeSP(), mesAtual = CAL.d.slice(0, 7), cel = [];
  for (let d = de; d <= ate; d = addD(d, 1)) {
    const fer = feriadoDe(d), lista = (m[d] || []).sort((a, b) => (b.dia_inteiro - a.dia_inteiro) || a.m0 - b.m0), max = 3;
    cel.push(h`<div class="mes-dia ${d.slice(0, 7) !== mesAtual ? 'fora' : ''} ${d === hoje ? 'hoje' : ''} ${fer && !fer.fac ? 'fer' : ''}" data-dia="${d}">
      <div class="mes-topo"><button class="num" data-ir="${d}" title="Abrir o dia">${+d.slice(8)}</button><button class="mais" data-novo="${d}" title="Novo compromisso">＋</button></div>
      ${fer ? h`<div class="fer-nome">${fer.nome}</div>` : ''}${lista.slice(0, max).map(chipEv)}${lista.length > max ? h`<button class="ver-mais" data-ir="${d}">+${lista.length - max} mais</button>` : ''}</div>`);
  }
  return h`<div class="mes">${DIAS.map((x) => h`<div class="mes-cab">${x}</div>`)}${cel}</div>`;
}

function colunas(segs) {
  segs.sort((a, b) => a.m0 - b.m0 || b.m1 - a.m1);
  const out = []; let grupo = [], lanes = [], fimG = -1;
  const fecha = () => { const n = Math.max(...grupo.map((s) => s.col)) + 1; grupo.forEach((s) => { s.n = n; }); out.push(...grupo); grupo = []; lanes = []; };
  for (const s of segs) {
    if (grupo.length && s.m0 >= fimG) fecha();
    let c = lanes.findIndex((e) => e <= s.m0); if (c < 0) { c = lanes.length; lanes.push(0); }
    lanes[c] = s.m1; s.col = c; fimG = grupo.length ? Math.max(fimG, s.m1) : s.m1; grupo.push(s);
  }
  if (grupo.length) fecha();
  return out;
}
function vSemana(ocs, de, ate) {
  const m = porDia(ocs), hoje = hojeSP(), dias = []; for (let d = de; d <= ate; d = addD(d, 1)) dias.push(d);
  const cfg = state.config; let h0 = cfg.hora_inicio, h1 = cfg.hora_fim;
  for (const d of dias) for (const s of (m[d] || [])) if (!s.dia_inteiro) { h0 = Math.min(h0, Math.floor(s.m0 / 60)); h1 = Math.max(h1, Math.ceil(s.m1 / 60)); }
  const H = 50, agora = agoraSP(), hh = h1 - h0;
  return h`<div class="sem" style="--hh:${H}px"><div class="sem-in">
    <div class="sem-head" style="--cols:${dias.length}"><div></div>${dias.map((d) => { const f = feriadoDe(d); return h`<div class="d ${d === hoje ? 'hoje' : ''} ${f ? 'fer' : ''}" data-dia="${d}"><small>${DIAS[dow(d)]}</small><b>${+d.slice(8)}</b>${f ? h`<span class="fn">${f.nome}</span>` : ''}</div>`; })}</div>
    <div class="sem-all" style="--cols:${dias.length}"><div class="g">Dia todo</div>${dias.map((d) => h`<div class="c">${(m[d] || []).filter((s) => s.dia_inteiro).map(chipEv)}</div>`)}</div>
    <div class="sem-corpo" style="--cols:${dias.length}">
      <div class="horas" style="height:${hh * H}px">${Array.from({ length: hh }, (_, i) => h`<span style="top:${i * H}px">${i ? pad(h0 + i) + ':00' : ''}</span>`)}</div>
      ${dias.map((d) => { const segs = colunas((m[d] || []).filter((s) => !s.dia_inteiro)); const f = feriadoDe(d);
        return h`<div class="col ${d === hoje ? 'hoje' : ''} ${f && !f.fac ? 'fer' : ''}" data-dia="${d}" data-h0="${h0}" style="height:${hh * H}px">
          ${segs.map((s) => h`<button class="ev-bloco ${s.status === 'Cancelado' ? 'canc' : ''} ${pendente(s) ? 'pend' : ''}" style="--c:${cor(s.categoria)};top:${Math.max(0, (s.m0 - h0 * 60) / 60 * H)}px;height:${Math.max(20, (s.m1 - s.m0) / 60 * H - 2)}px;left:calc(${(s.col / s.n) * 100}% + 1px);width:calc(${100 / s.n}% - 3px)" data-ev="${s.id}" data-oc="${s.ocorrencia}" title="${s.titulo}"><b>${s.titulo}</b>${s.m1 - s.m0 >= 45 ? h`${fmtMin(s.m0)} – ${fmtMin(s.m1)}${s.local ? ' · ' + s.local : ''}` : ''}</button>`)}
          ${d === hoje && mins(agora) >= h0 * 60 && mins(agora) < h1 * 60 ? h`<div class="agora" style="top:${(mins(agora) - h0 * 60) / 60 * H}px"></div>` : ''}</div>`; })}
    </div></div></div>`;
}
function vLista(ocs, de, ate) {
  const m = porDia(ocs), hoje = hojeSP(), blocos = [];
  for (let d = de; d <= ate; d = addD(d, 1)) {
    const l = (m[d] || []).sort((a, b) => (b.dia_inteiro - a.dia_inteiro) || a.m0 - b.m0), f = feriadoDe(d);
    if (!l.length && !f) continue;
    blocos.push(h`<div class="lista-dia ${d === hoje ? 'hoje' : ''}"><h3>${DIAS_L[dow(d)]}, ${fmtData(d).slice(0, 5)} ${d === hoje ? h`<small>· hoje</small>` : ''} ${f ? h`<small>· 🇧🇷 ${f.nome}</small>` : ''}</h3>
      ${l.map((s) => h`<button class="lin-ev ${s.status === 'Cancelado' ? 'canc' : ''}" style="--c:${cor(s.categoria)}" data-ev="${s.id}" data-oc="${s.ocorrencia}">
        <div class="t">${s.dia_inteiro ? 'Dia todo' : hhmm(s.inicio) + ' – ' + hhmm(s.fim)}</div>
        <div class="x"><b>${s.titulo}</b><span>${[s.categoria, s.local, s.recurso_nome && '📍 ' + s.recurso_nome, s.participantes_n ? '👥 ' + s.participantes_n : ''].filter(Boolean).join(' · ')}</span></div>
        ${s.status !== 'Agendado' ? stBadge(s.status) : ''}${pendente(s) ? h` <span class="badge b-amb">Convite</span>` : ''}</button>`)}</div>`);
  }
  return blocos.length ? h`${blocos}` : raw('<div class="empty">Nenhum compromisso neste período.</div>');
}

/* ====== detalhe do compromisso ====== */
function descRepete(e) {
  if (e.recorrencia === 'nenhuma') return REC.nenhuma;
  return `${REC[e.recorrencia]}, até ${fmtData(e.recorre_ate)}`;
}
async function abreEvento(id, oc) {
  let e;
  try { e = await api('GET', 'api/eventos/' + id); } catch (er) { toast(er.message, true); return; }
  const dur = new Date(e.fim.replace(' ', 'T')) - new Date(e.inicio.replace(' ', 'T'));
  const dia0 = oc || e.data_inicio;
  const ini = new Date(`${dia0}T${e.hora_inicio}:00`), fim = new Date(ini.getTime() + dur);
  const quando = e.dia_inteiro
    ? (e.data_inicio === e.data_fim ? `${fmtCurto(dia0)} · dia inteiro` : `${fmtData(dia0)} a ${fmtData(iso(new Date(pd(dia0).getTime() + (pd(e.data_fim) - pd(e.data_inicio)))))} · dia inteiro`)
    : (iso(ini) === iso(fim) ? `${fmtCurto(iso(ini))} · ${hhmm(e.inicio)} às ${hhmm(e.fim)}` : `${fmtCurto(iso(ini))} ${hhmm(e.inicio)} até ${fmtCurto(iso(fim))} ${hhmm(e.fim)}`);
  const euPart = e.minha_resposta != null, lemb = LEMB.find(([v]) => String(v) === String(e.lembrete_min));
  const ehCancOc = e.excecoes.includes(dia0);
  modal(h`<div class="ev-topo" style="--c:${cor(e.categoria)}"><div class="cat">${e.categoria}</div><h2>${e.titulo}</h2>
      <div>${stBadge(e.status)} ${e.recorrencia !== 'nenhuma' ? h`<span class="badge b-gry">🔁 ${REC[e.recorrencia]}</span>` : ''} <span class="badge b-gry">${e.visibilidade === 'publica' ? '🌐 Pública' : e.visibilidade === 'privada' ? '🔒 Privada' : '👥 Participantes'}</span></div></div>
    <dl class="kv"><dt>Quando</dt><dd>${quando}</dd>
      ${e.recorrencia !== 'nenhuma' ? h`<dt>Repetição</dt><dd>${descRepete(e)}</dd>` : ''}
      ${e.local || e.recurso_nome ? h`<dt>Onde</dt><dd>${[e.local, e.recurso_nome && '📍 ' + e.recurso_nome].filter(Boolean).join(' · ')}</dd>` : ''}
      ${e.participantes.length ? h`<dt>Participantes</dt><dd><div class="pessoas">${e.participantes.map((p) => h`<div><span>${p.nome}</span>${respBadge(p.resposta)}</div>`)}</div></dd>` : ''}
      ${e.convidados_externos ? h`<dt>Convidados</dt><dd>${e.convidados_externos}</dd>` : ''}
      ${lemb && e.lembrete_min !== null ? h`<dt>Lembrete</dt><dd>${lemb[1]}</dd>` : ''}
      <dt>Organizador</dt><dd>${e.criador_nome}</dd>
      ${e.descricao ? h`<dt>Descrição</dt><dd style="white-space:pre-wrap">${e.descricao}</dd>` : ''}</dl>
    ${euPart ? h`<div class="conflito" style="background:var(--blu-l);color:#1e3a8a">Seu convite: ${respBadge(e.minha_resposta)} &nbsp; <button class="btn sm" data-r="aceito">✔ Aceitar</button> <button class="btn sm" data-r="recusado">✖ Recusar</button></div>` : ''}
    <div class="ev-acoes"><a class="btn sm" href="api/exportar.ics?evento=${e.id}&inicio=${addD(hojeSP(), -365)}&fim=${addD(hojeSP(), 1095)}">⬇ Adicionar ao meu calendário (.ics)</a>
      ${e.pode_editar ? h`<button class="btn sm" data-a="editar">✏️ Editar</button>
        <select data-a="status" aria-label="Situação">${STATUS.map((s) => h`<option ${s === e.status ? raw('selected') : ''}>${s}</option>`)}</select>
        ${e.recorrencia !== 'nenhuma' && !ehCancOc ? h`<button class="btn sm" data-a="oc">Cancelar só este dia</button>` : ''}
        <button class="btn sm dng" data-a="excluir">🗑 Excluir${e.recorrencia !== 'nenhuma' ? ' série' : ''}</button>` : ''}
      <button class="btn sm" data-a="fechar" style="margin-left:auto">Fechar</button></div>`.s, {
    largo: true,
    onMount: (m, close) => {
      $$('[data-r]', m).forEach((b) => { b.onclick = () => tentar(async () => { await api('POST', `api/eventos/${e.id}/resposta`, { resposta: b.dataset.r }); close(); toast(b.dataset.r === 'aceito' ? 'Presença confirmada.' : 'Convite recusado.'); await atualizaAlertas(); recarrega(); }); });
      $('[data-a=fechar]', m).onclick = close;
      const ed = $('[data-a=editar]', m); if (ed) ed.onclick = () => { close(); abreForm(e); };
      const st = $('[data-a=status]', m); if (st) st.onchange = () => tentar(async () => { await api('POST', `api/eventos/${e.id}/status`, { status: st.value }); close(); toast('Situação atualizada.'); recarrega(); });
      const oc2 = $('[data-a=oc]', m); if (oc2) oc2.onclick = async () => { if (await confirma(`Cancelar apenas a ocorrência de ${fmtData(dia0)}? As demais continuam.`, 'Cancelar este dia')) tentar(async () => { await api('POST', `api/eventos/${e.id}/cancelar-ocorrencia`, { data: dia0 }); close(); toast('Ocorrência cancelada.'); recarrega(); }); };
      const ex = $('[data-a=excluir]', m); if (ex) ex.onclick = async () => { if (await confirma(e.recorrencia !== 'nenhuma' ? 'Excluir este compromisso e todas as suas repetições?' : 'Excluir este compromisso?', 'Excluir')) tentar(async () => { await api('DELETE', 'api/eventos/' + e.id); close(); toast('Compromisso excluído.'); await atualizaAlertas(); recarrega(); }); };
    },
  });
}

/* ====== formulário de compromisso ====== */
function addHoras(hora, n) { const t = (+hora.slice(0, 2) + n); return t >= 24 ? '23:59' : `${pad(t)}:${hora.slice(3, 5)}`; }
function abreForm(e, pre = {}) {
  const novo = !e;
  const v = e || { titulo: '', categoria: state.config.categorias[0].nome, status: 'Agendado', visibilidade: 'publica', recorrencia: 'nenhuma', dia_inteiro: 0, local: '', descricao: '', convidados_externos: '',
    data_inicio: pre.data || hojeSP(), hora_inicio: pre.hora || '09:00', data_fim: pre.data || hojeSP(), hora_fim: addHoras(pre.hora || '09:00', 1), lembrete_min: state.config.lembrete_padrao, recurso_id: null, participantes: [], recorre_ate: '' };
  if (novo && pre.hora === '23:30') v.hora_fim = '23:59';
  const marcados = new Set((v.participantes || []).map((p) => p.id));
  const outros = state.usuarios.filter((u) => u.id !== state.user.id);
  const cats = state.config.categorias.map((c) => c.nome); if (!cats.includes(v.categoria)) cats.push(v.categoria);
  modal(h`<h2>${novo ? 'Novo compromisso' : 'Editar compromisso'}</h2><div class="err-msg hide" id="err"></div>
    <form id="f" class="form" autocomplete="off">
      <div class="full"><label>Título <span class="req">*</span></label><input name="titulo" value="${v.titulo}" maxlength="200" required placeholder="Ex.: Reunião com diretores das escolas"></div>
      <div><label>Categoria</label><select name="categoria">${cats.map((c) => h`<option ${c === v.categoria ? raw('selected') : ''}>${c}</option>`)}</select></div>
      <div><label>Situação</label><select name="status">${STATUS.map((s) => h`<option ${s === v.status ? raw('selected') : ''}>${s}</option>`)}</select></div>
      <div class="full"><label class="chk" style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" name="dia_inteiro" style="width:auto" ${v.dia_inteiro ? raw('checked') : ''}> Dia inteiro (sem horário)</label></div>
      <div><label>Início</label><div style="display:grid;grid-template-columns:1fr 100px;gap:8px"><input type="date" name="data_inicio" value="${v.data_inicio}" required><input type="time" name="hora_inicio" value="${v.hora_inicio}" class="hr"></div></div>
      <div><label>Término</label><div style="display:grid;grid-template-columns:1fr 100px;gap:8px"><input type="date" name="data_fim" value="${v.data_fim}" required><input type="time" name="hora_fim" value="${v.hora_fim}" class="hr"></div></div>
      <div><label>Local</label><input name="local" value="${v.local || ''}" maxlength="200" placeholder="Ex.: EMEF Paulo Freire"></div>
      <div><label>Reservar espaço / veículo</label><select name="recurso_id"><option value="">Nenhum</option>${state.recursos.filter((r) => r.ativo || r.id === v.recurso_id).map((r) => h`<option value="${r.id}" ${r.id === v.recurso_id ? raw('selected') : ''}>${r.nome} (${r.tipo})</option>`)}</select><div class="hint">O sistema impede reservas no mesmo horário.</div></div>
      <div><label>Repetir</label><select name="recorrencia">${Object.entries(REC).map(([k, l]) => h`<option value="${k}" ${k === v.recorrencia ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div id="ate" class="${v.recorrencia === 'nenhuma' ? 'hide' : ''}"><label>Repetir até <span class="req">*</span></label><input type="date" name="recorre_ate" value="${v.recorre_ate || ''}"><div class="hint">Máximo de 3 anos. Ao editar, a série inteira é alterada.</div></div>
      <div><label>Lembrete</label><select name="lembrete_min">${LEMB.map(([k, l]) => h`<option value="${k}" ${String(k) === String(v.lembrete_min ?? '') ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div><label>Quem pode ver</label><select name="visibilidade">${Object.entries(VISIB).map(([k, l]) => h`<option value="${k}" ${k === v.visibilidade ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div class="full" id="partbox"><label>Participantes (usuários do sistema)</label>
        <input type="search" id="bpart" placeholder="Filtrar por nome…" style="margin-bottom:6px">
        <div class="lista-part">${outros.length ? outros.map((u) => h`<label data-nome="${u.nome.toLowerCase()}"><input type="checkbox" name="part" value="${u.id}" ${marcados.has(u.id) ? raw('checked') : ''}> ${u.nome}${u.cargo ? h` <span class="hint">· ${u.cargo}</span>` : ''}</label>`) : h`<div class="hint">Não há outros usuários cadastrados.</div>`}</div>
        <div class="hint">Os convidados veem o compromisso na agenda deles e podem aceitar ou recusar.</div></div>
      <div class="full"><label>Convidados externos</label><input name="convidados_externos" value="${v.convidados_externos || ''}" maxlength="500" placeholder="Nomes e contatos de pessoas de fora do sistema"></div>
      <div class="full"><label>Descrição / pauta</label><textarea name="descricao" maxlength="5000">${v.descricao || ''}</textarea></div>
    </form>
    <div class="acts"><button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>${novo ? 'Agendar' : 'Salvar'}</button></div>`.s, {
    largo: true, fixo: true,
    onMount: (m, close) => {
      const f = $('#f', m), err = $('#err', m);
      const sync = () => {
        const di = f.dia_inteiro.checked;
        $$('.hr', f).forEach((x) => { x.disabled = di; x.style.opacity = di ? '.4' : '1'; });
        $('#ate', m).classList.toggle('hide', f.recorrencia.value === 'nenhuma');
        $('#partbox', m).classList.toggle('hide', f.visibilidade.value === 'privada');
      };
      f.dia_inteiro.onchange = sync; f.recorrencia.onchange = sync; f.visibilidade.onchange = sync; sync();
      f.data_inicio.onchange = () => { if (f.data_fim.value < f.data_inicio.value) f.data_fim.value = f.data_inicio.value; };
      f.hora_inicio.onchange = () => { if (f.data_inicio.value === f.data_fim.value && f.hora_fim.value <= f.hora_inicio.value) f.hora_fim.value = addHoras(f.hora_inicio.value, 1); };
      $('#bpart', m).oninput = (ev) => { const t = ev.target.value.toLowerCase(); $$('.lista-part label', m).forEach((l) => { l.style.display = l.dataset.nome.includes(t) ? '' : 'none'; }); };
      $('[data-n]', m).onclick = close;
      const envia = async (confirmar) => {
        const fd = new FormData(f), b = Object.fromEntries(fd.entries());
        b.dia_inteiro = f.dia_inteiro.checked; b.participantes = fd.getAll('part').map(Number); delete b.part;
        if (b.dia_inteiro) { delete b.hora_inicio; delete b.hora_fim; } else { b.hora_inicio = f.hora_inicio.value; b.hora_fim = f.hora_fim.value; }
        if (b.recorrencia === 'nenhuma') b.recorre_ate = '';
        if (confirmar) b.confirmar = true;
        try {
          const r = novo ? await api('POST', 'api/eventos', b) : await api('PUT', 'api/eventos/' + e.id, b);
          close(); toast(novo ? 'Compromisso agendado.' : 'Compromisso atualizado.'); await atualizaAlertas(); recarrega(); return r;
        } catch (er) {
          if (er.status === 409 && er.data.conflitos) {
            const c = er.data.conflitos, lista = [...c.recurso, ...c.pessoas];
            if (er.data.forcavel) {
              modal(h`<h2>Conflito de agenda</h2><div class="conflito">${er.message}<ul>${lista.map((x) => h`<li>${x}</li>`)}</ul></div><p>Deseja agendar mesmo assim?</p><div class="acts"><button class="btn" data-n>Voltar e ajustar</button><button class="btn pri" data-s>Agendar mesmo assim</button></div>`.s, {
                onMount: (m2, close2) => { $('[data-n]', m2).onclick = close2; $('[data-s]', m2).onclick = () => { close2(); envia(true); }; },
              });
            } else { err.innerHTML = `<b>Conflito de reserva</b><ul style="margin:6px 0 0;padding-left:18px">${lista.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; err.classList.remove('hide'); err.scrollIntoView({ block: 'nearest' }); }
          } else { err.textContent = er.message; err.classList.remove('hide'); err.scrollIntoView({ block: 'nearest' }); }
        }
      };
      $('[data-s]', m).onclick = () => { if (f.reportValidity()) envia(false); };
      f.onsubmit = (ev) => { ev.preventDefault(); if (f.reportValidity()) envia(false); };
    },
  });
}
async function atualizaAlertas() { try { state.alertas = await api('GET', 'api/alertas'); atualizaBadge(); } catch { /* ignora */ } }

/* ====== tarefas ====== */
const prazoTarefa = (t) => {
  const [c, tx] = { concluida: ['b-grn', 'Concluída'], atrasada: ['b-red', `${plural(-t.dias_restantes, 'dia', 'dias')} em atraso`], hoje: ['b-amb', 'Vence hoje'], proxima: ['b-amb', t.dias_restantes === 1 ? 'Vence amanhã' : `Faltam ${t.dias_restantes} dias`], no_prazo: ['b-gry', `Faltam ${t.dias_restantes} dias`], sem_prazo: ['b-gry', 'Sem prazo'] }[t.situacao];
  return h`<span class="badge ${c}">${tx}</span>`;
};
const TAR = { status: 'abertas', escopo: 'minhas', q: '' };
async function pgTarefas(main) {
  const adm = state.user.perfil === 'admin';
  const qs = new URLSearchParams({ status: TAR.status, escopo: TAR.escopo, q: TAR.q });
  const lista = await api('GET', 'api/tarefas?' + qs);
  main.innerHTML = topo('Tarefas', '<button class="btn pri" id="novo">＋ Nova tarefa</button>') + h`<div class="card">
    <div class="chips">${[['abertas', 'Abertas'], ['concluidas', 'Concluídas'], ['todas', 'Todas']].map(([v, l]) => h`<button class="chip ${TAR.status === v ? 'on' : ''}" data-st="${v}">${l}</button>`)}</div>
    <div class="filters"><input type="search" id="busca" placeholder="Buscar tarefa…" value="${TAR.q}">
      ${adm ? h`<select id="esc"><option value="minhas" ${TAR.escopo === 'minhas' ? raw('selected') : ''}>Somente as minhas</option><option value="todas" ${TAR.escopo === 'todas' ? raw('selected') : ''}>Todas as tarefas (admin)</option></select>` : ''}</div>
    <div class="hint" style="margin-bottom:6px">${plural(lista.length, 'tarefa', 'tarefas')}</div>
    ${lista.length ? lista.map((t) => h`<div class="tarefa ${t.concluida ? 'feita' : ''}"><input type="checkbox" data-c="${t.id}" ${t.concluida ? raw('checked') : ''} aria-label="Concluir">
      <div class="x"><b>${t.titulo}</b><div class="sub">${[t.prazo && 'Prazo ' + fmtData(t.prazo), t.responsavel_nome && 'Responsável: ' + t.responsavel_nome].filter(Boolean).join(' · ')}</div>${t.descricao ? h`<div class="sub">${t.descricao}</div>` : ''}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${prBadge(t.prioridade)} ${prazoTarefa(t)} <button class="btn sm" data-e="${t.id}">Editar</button></div></div>`) : h`<div class="empty">Nenhuma tarefa por aqui.</div>`}</div>`.s;
  $('#novo').onclick = () => formTarefa(null);
  $$('[data-st]', main).forEach((b) => { b.onclick = () => { TAR.status = b.dataset.st; recarrega(); }; });
  let t; $('#busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { TAR.q = e.target.value.trim(); recarrega(); }, 400); };
  $('#busca').onfocus = (e) => e.target.setSelectionRange(1e4, 1e4);
  const esc2 = $('#esc'); if (esc2) esc2.onchange = (e) => { TAR.escopo = e.target.value; recarrega(); };
  $$('[data-c]', main).forEach((c) => { c.onchange = () => tentar(async () => { await api('POST', `api/tarefas/${c.dataset.c}/concluir`, { concluida: c.checked }); await atualizaAlertas(); recarrega(); }); });
  $$('[data-e]', main).forEach((b) => { b.onclick = () => formTarefa(lista.find((x) => x.id === +b.dataset.e)); });
}
function formTarefa(t) {
  modal(h`<h2>${t ? 'Editar tarefa' : 'Nova tarefa'}</h2><div class="err-msg hide" id="err"></div><div class="form">
    <div class="full"><label>Título *</label><input id="ti" value="${t?.titulo || ''}" maxlength="200"></div>
    <div><label>Prazo</label><input type="date" id="pr" value="${t?.prazo || ''}"></div>
    <div><label>Prioridade</label><select id="pi">${PRIOS.map((p) => h`<option ${p === (t?.prioridade || 'Normal') ? raw('selected') : ''}>${p}</option>`)}</select></div>
    <div class="full"><label>Responsável</label><select id="re">${state.usuarios.map((u) => h`<option value="${u.id}" ${u.id === (t?.responsavel_id ?? state.user.id) ? raw('selected') : ''}>${u.nome}</option>`)}</select></div>
    <div class="full"><label>Detalhes</label><textarea id="de" maxlength="3000" style="min-height:80px">${t?.descricao || ''}</textarea></div></div>
    <div class="acts">${t ? '<button class="btn dng" data-x style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-n>Cancelar</button><button class="btn pri" data-s>Salvar</button></div>`.s, {
    fixo: true,
    onMount: (m, close) => {
      $('[data-n]', m).onclick = close;
      $('[data-s]', m).onclick = () => tentar(async () => {
        const b = { titulo: $('#ti', m).value, prazo: $('#pr', m).value, prioridade: $('#pi', m).value, responsavel_id: $('#re', m).value, descricao: $('#de', m).value };
        t ? await api('PUT', 'api/tarefas/' + t.id, b) : await api('POST', 'api/tarefas', b);
        close(); toast('Tarefa salva.'); await atualizaAlertas(); recarrega();
      }, $('#err', m));
      const x = $('[data-x]', m); if (x) x.onclick = async () => { if (await confirma('Excluir esta tarefa?', 'Excluir')) tentar(async () => { await api('DELETE', 'api/tarefas/' + t.id); close(); toast('Tarefa excluída.'); await atualizaAlertas(); recarrega(); }); };
    },
  });
}

/* ====== contatos ====== */
let BUSCA_CONTATO = '';
async function pgContatos(main) {
  const lista = await api('GET', 'api/contatos' + (BUSCA_CONTATO ? '?q=' + encodeURIComponent(BUSCA_CONTATO) : ''));
  main.innerHTML = topo('Contatos', '<button class="btn pri" id="novo">＋ Novo contato</button>') + h`<div class="card">
    <div class="filters"><input type="search" id="busca" placeholder="Buscar por nome, cargo, escola/setor, telefone ou e-mail…" value="${BUSCA_CONTATO}"></div>
    <div class="hint" style="margin-bottom:8px">${plural(lista.length, 'contato', 'contatos')}</div>
    ${lista.length ? h`<div class="tbl-wrap"><table><thead><tr><th>Nome</th><th>Escola / Setor</th><th>Telefone</th><th>E-mail</th><th></th></tr></thead><tbody>
      ${lista.map((c) => h`<tr><td><b>${c.nome}</b><div class="sub">${c.cargo || ''}</div></td><td>${c.orgao || '—'}</td>
        <td>${[c.telefone, c.celular].filter(Boolean).map((x) => h`<div><a href="tel:${x.replace(/[^\d+]/g, '')}">${x}</a></div>`)}${!c.telefone && !c.celular ? '—' : ''}</td>
        <td>${c.email ? h`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-e="${c.id}">Editar</button></td></tr>`)}</tbody></table></div>` : h`<div class="empty">Nenhum contato encontrado.</div>`}</div>`.s;
  $('#novo').onclick = () => formContato(null);
  let t; $('#busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { BUSCA_CONTATO = e.target.value.trim(); recarrega(); }, 400); };
  $('#busca').onfocus = (e) => e.target.setSelectionRange(1e4, 1e4);
  $$('[data-e]', main).forEach((b) => { b.onclick = () => formContato(lista.find((x) => x.id === +b.dataset.e)); });
}
function formContato(c) {
  const pode = !c || state.user.perfil === 'admin' || c.criado_por === state.user.id;
  const campo = (id, rot, val, extra = '') => h`<div><label>${rot}</label><input id="${id}" value="${val || ''}" maxlength="150" ${raw(extra)} ${pode ? '' : raw('disabled')}></div>`;
  modal(h`<h2>${c ? (pode ? 'Editar contato' : 'Contato') : 'Novo contato'}</h2><div class="err-msg hide" id="err"></div><div class="form">
    <div class="full">${campo('n', 'Nome *', c?.nome)}</div>${campo('ca', 'Cargo / Função', c?.cargo)}${campo('o', 'Escola / Setor', c?.orgao)}
    ${campo('t', 'Telefone', c?.telefone, 'type="tel"')}${campo('ce', 'Celular / WhatsApp', c?.celular, 'type="tel"')}
    <div class="full">${campo('e', 'E-mail', c?.email, 'type="email"')}</div>
    <div class="full"><label>Observações</label><textarea id="ob" maxlength="1000" style="min-height:70px" ${pode ? '' : raw('disabled')}>${c?.observacoes || ''}</textarea></div></div>
    <div class="acts">${c && pode ? '<button class="btn dng" data-x style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-n>${pode ? 'Cancelar' : 'Fechar'}</button>${pode ? '<button class="btn pri" data-s>Salvar</button>' : ''}</div>`.s, {
    fixo: true,
    onMount: (m, close) => {
      $('[data-n]', m).onclick = close;
      const s = $('[data-s]', m); if (s) s.onclick = () => tentar(async () => {
        const g = (i) => $('#' + i, m).value, b = { nome: g('n'), cargo: g('ca'), orgao: g('o'), telefone: g('t'), celular: g('ce'), email: g('e'), observacoes: g('ob') };
        c ? await api('PUT', 'api/contatos/' + c.id, b) : await api('POST', 'api/contatos', b);
        close(); toast('Contato salvo.'); recarrega();
      }, $('#err', m));
      const x = $('[data-x]', m); if (x) x.onclick = async () => { if (await confirma(`Excluir o contato ${c.nome}?`, 'Excluir')) tentar(async () => { await api('DELETE', 'api/contatos/' + c.id); close(); toast('Contato excluído.'); recarrega(); }); };
    },
  });
}

/* ====== alertas e lembretes ====== */
async function pgAlertas(main) {
  const a = await api('GET', 'api/alertas'); state.alertas = a; atualizaBadge();
  const sec = (tit, itens, fn) => (itens.length ? h`<div class="card" style="margin-bottom:14px"><h2>${tit} (${itens.length})</h2>${itens.map(fn)}</div>` : '');
  const notif = 'Notification' in window && Notification.permission === 'default';
  main.innerHTML = topo('Alertas') + h`<p style="color:var(--mut);margin-top:-8px">Lembretes de compromissos, convites e tarefas que precisam da sua atenção.
    ${notif ? h`<button class="btn sm" id="notif">🔔 Ativar avisos no navegador</button>` : ''}</p>
    ${a.total ? '' : h`<div class="card empty">✅ Nenhum alerta no momento. Tudo em dia!</div>`}
    ${sec('⏰ Começam em breve', a.lembretes, (o) => h`<div class="mini" style="--c:${cor(o.categoria)}" data-ev="${o.id}" data-oc="${o.ocorrencia}"><div class="bar"></div><div class="t">${hhmm(o.inicio)}</div><div class="x"><b>${o.titulo}</b><span>${o.minutos > 0 ? `Começa em ${plural(o.minutos, 'minuto', 'minutos')}` : 'Em andamento'}${o.local ? ' · ' + o.local : ''}</span></div></div>`)}
    ${sec('📨 Convites aguardando resposta', a.convites, (o) => h`<div class="mini" style="--c:${cor(o.categoria)}" data-ev="${o.id}" data-oc="${o.ocorrencia}"><div class="bar"></div><div class="t">${o.dia_inteiro ? 'Dia todo' : hhmm(o.inicio)}</div><div class="x"><b>${o.titulo}</b><span>${fmtCurto(o.ocorrencia)} · de ${o.criador_nome}</span></div><span class="badge b-amb">Responder</span></div>`)}
    ${sec('✅ Tarefas atrasadas ou para hoje', a.tarefas, (t) => h`<div class="mini" onclick="location.hash='#/tarefas'"><div class="x"><b>${t.titulo}</b><span>Prazo ${fmtData(t.prazo)}</span></div>${prazoTarefa(t)}</div>`)}
    ${sec('📅 Compromissos de hoje', a.hoje, itemMini)}`.s;
  ligaEventos(main);
  const nb = $('#notif'); if (nb) nb.onclick = async () => { await Notification.requestPermission(); recarrega(); };
}
let _lemb = null;
function iniciaLembretes() {
  if (_lemb) return;
  const checa = async () => {
    if (!state.user || state.user.trocar_senha) return;
    let a; try { a = await api('GET', 'api/alertas'); } catch { return; }
    state.alertas = a; atualizaBadge();
    const vistos = le('ag_avisados', []);
    for (const o of a.lembretes) {
      const k = `${o.id}|${o.inicio}`;
      if (vistos.includes(k)) continue;
      vistos.push(k);
      const msg = o.minutos > 0 ? `Começa em ${plural(o.minutos, 'minuto', 'minutos')}: ${o.titulo}` : `Em andamento: ${o.titulo}`;
      toast('🔔 ' + msg);
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Agenda da Educação', { body: msg }); } catch { /* sem suporte */ }
    }
    guarda('ag_avisados', vistos.slice(-200));
  };
  _lemb = setInterval(checa, 60000);
  setTimeout(checa, 2500);
}

/* ====== usuários (admin) ====== */
function gerarSenha() {
  const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789', r = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return Array.from({ length: 6 }, () => r(a)).join('') + Array.from({ length: 3 }, () => r(d)).join('');
}
async function pgUsuarios(main) {
  const lista = await api('GET', 'api/usuarios');
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
      onMount: (m, close) => { $('[data-n]', m).onclick = close; $('[data-s]', m).onclick = () => tentar(async () => { await api('POST', `api/usuarios/${u.id}/senha`, { senha: $('#s', m).value }); alert(`Senha redefinida.\n\nLogin: ${u.login}\nSenha provisória: ${$('#s', m).value}`); close(); recarrega(); }, $('#err', m)); } });
  }; });
}

/* ====== configurações / auditoria / conta ====== */
async function pgConfig(main) {
  const c = await api('GET', 'api/config'), recursos = await api('GET', 'api/recursos');
  const linhaCat = (x) => h`<div class="cor-lin"><input type="color" value="${x.cor}" data-cor><input value="${x.nome}" maxlength="60" data-nome placeholder="Nome da categoria"><button type="button" class="btn sm dng" data-rm title="Remover">✕</button></div>`;
  const horas = (sel, ini, fim) => Array.from({ length: fim - ini + 1 }, (_, i) => h`<option value="${ini + i}" ${ini + i === sel ? raw('selected') : ''}>${pad(ini + i)}:00</option>`);
  main.innerHTML = topo('Configurações') + h`<div class="grid g2">
    <form class="card" id="f"><div class="err-msg hide" id="err"></div>
      <h2>Categorias de compromisso</h2><div id="cats">${c.categorias.map(linhaCat)}</div>
      <button type="button" class="btn sm" id="addcat">＋ Adicionar categoria</button>
      <div class="hint" style="margin-top:8px">Renomear ou remover uma categoria não altera compromissos já criados: eles continuam com o nome antigo e aparecem em cinza.</div>
      <h2 style="margin-top:22px">Agenda semanal e lembretes</h2>
      <div class="form"><div><label>A agenda começa às</label><select id="hi">${horas(c.hora_inicio, 0, 22)}</select></div><div><label>e termina às</label><select id="hf">${horas(c.hora_fim, 1, 24)}</select></div>
      <div class="full"><label>Lembrete padrão para novos compromissos</label><select id="lp">${LEMB.map(([k, l]) => h`<option value="${k}" ${String(k) === String(c.lembrete_padrao ?? '') ? raw('selected') : ''}>${l}</option>`)}</select></div></div>
      <button class="btn pri" style="margin-top:16px">Salvar configurações</button></form>
    <div class="card"><h2>Espaços e veículos para reserva</h2><div id="rec">${recursos.map((r) => h`<div class="cor-lin" data-id="${r.id}"><input value="${r.nome}" maxlength="120" data-n style="flex:1"><select data-t style="width:130px;flex:none">${['Sala', 'Auditório', 'Veículo', 'Equipamento', 'Outro'].map((t) => h`<option ${t === r.tipo ? raw('selected') : ''}>${t}</option>`)}</select>
      <label style="margin:0;white-space:nowrap;font-weight:500"><input type="checkbox" data-a ${r.ativo ? raw('checked') : ''} style="width:auto"> ativo</label><button class="btn sm" data-sv>Salvar</button></div>`)}</div>
      <h3 style="margin-top:16px">Novo espaço ou veículo</h3><div class="cor-lin"><input id="rn" placeholder="Ex.: Sala de formação" maxlength="120" style="flex:1"><select id="rt" style="width:130px;flex:none">${['Sala', 'Auditório', 'Veículo', 'Equipamento', 'Outro'].map((t) => h`<option>${t}</option>`)}</select><button class="btn pri sm" id="rad">Adicionar</button></div>
      <div class="hint">Itens desativados deixam de aparecer para novas reservas, mas o histórico é mantido.</div></div></div>`.s;
  const cats = $('#cats', main);
  const liga = () => $$('[data-rm]', cats).forEach((b) => { b.onclick = () => b.parentElement.remove(); });
  liga();
  $('#addcat', main).onclick = () => { const d = document.createElement('div'); d.innerHTML = linhaCat({ nome: '', cor: '#1d4ed8' }).s; cats.append(d.firstElementChild); liga(); };
  $('#f', main).onsubmit = (e) => { e.preventDefault(); tentar(async () => {
    state.config = await api('PUT', 'api/config', { categorias: $$('.cor-lin', cats).map((l) => ({ nome: $('[data-nome]', l).value, cor: $('[data-cor]', l).value })), hora_inicio: +$('#hi').value, hora_fim: +$('#hf').value, lembrete_padrao: $('#lp').value });
    toast('Configurações salvas.');
  }, $('#err', main)); };
  $$('#rec [data-id]', main).forEach((l) => { $('[data-sv]', l).onclick = () => tentar(async () => {
    await api('PUT', 'api/recursos/' + l.dataset.id, { nome: $('[data-n]', l).value, tipo: $('[data-t]', l).value, ativo: $('[data-a]', l).checked }); toast('Salvo.'); state.recursos = await api('GET', 'api/recursos');
  }); });
  $('#rad', main).onclick = () => tentar(async () => { await api('POST', 'api/recursos', { nome: $('#rn').value, tipo: $('#rt').value }); toast('Adicionado.'); state.recursos = await api('GET', 'api/recursos'); recarrega(); });
}
async function pgAuditoria(main) {
  const l = await api('GET', 'api/auditoria');
  main.innerHTML = topo('Auditoria') + h`<p style="color:var(--mut);margin-top:-8px">Registro das últimas 300 ações realizadas no sistema.</p><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${l.map((a) => h`<tr><td style="white-space:nowrap">${fmtDT(a.criado_em)}</td><td>${a.usuario_nome || '—'}</td><td><span class="badge b-gry">${a.acao}</span></td><td>${a.detalhe || ''}</td></tr>`)}</tbody></table></div></div>`.s;
}
async function pgConta(main) {
  const u = state.user, perm = 'Notification' in window ? Notification.permission : 'unsupported';
  main.innerHTML = topo('Minha conta') + h`<div class="grid g2" style="max-width:900px"><div class="card"><h2>Meus dados</h2><dl class="kv"><dt>Nome</dt><dd>${u.nome}</dd><dt>Login</dt><dd>${u.login}</dd><dt>Perfil</dt><dd>${u.perfil === 'admin' ? 'Administrador' : 'Usuário'}</dd><dt>Cargo</dt><dd>${u.cargo || '—'}</dd></dl>
      <h3 style="margin-top:16px">Avisos no navegador</h3><p class="hint">${perm === 'granted' ? '✅ Ativados: você será avisado dos lembretes enquanto o sistema estiver aberto.' : perm === 'denied' ? 'Bloqueados nas configurações do navegador.' : perm === 'unsupported' ? 'Seu navegador não oferece esse recurso.' : 'Receba um aviso na tela quando um compromisso estiver prestes a começar.'}</p>
      ${perm === 'default' ? '<button class="btn sm" id="notif">🔔 Ativar avisos</button>' : ''}</div>
    <form class="card" id="f"><h2>Alterar senha</h2><div class="err-msg hide" id="err"></div>
      <label>Senha atual</label><input type="password" name="a" required autocomplete="current-password">
      <label style="margin-top:10px">Nova senha</label><input type="password" name="n" minlength="8" required autocomplete="new-password"><div class="hint">Mínimo de 8 caracteres, com letras e números.</div>
      <button class="btn pri" style="margin-top:14px">Alterar senha</button></form></div>`.s;
  $('#f').onsubmit = (e) => { e.preventDefault(); tentar(async () => { await api('POST', 'api/me/senha', { atual: e.target.a.value, nova: e.target.n.value }); e.target.reset(); toast('Senha alterada.'); }, $('#err')); };
  const nb = $('#notif'); if (nb) nb.onclick = async () => { await Notification.requestPermission(); recarrega(); };
}

boot();
