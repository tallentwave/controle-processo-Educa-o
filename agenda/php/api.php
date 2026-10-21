<?php
declare(strict_types=1);
require __DIR__ . '/app/lib.php';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

function responde(int $status, $obj): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}
$rotas = [];
function rota(string $m, string $padrao, string $nivel, callable $fn): void
{
    global $rotas;
    $rotas[] = [$m, '#^' . preg_replace('#:(\w+)#', '(?P<$1>[^/]+)', $padrao) . '$#', $nivel, $fn];
}
function nao_encontrado(string $o = 'Registro'): HttpError { return new HttpError(404, "$o não encontrado."); }
function intervalo(array $q, int $maxDias = 400): array
{
    $de = $q['inicio'] ?? ''; $ate = $q['fim'] ?? '';
    if (!data_ok($de) || !data_ok($ate)) throw bad('Informe o período (inicio e fim).');
    if ($ate < $de || dias_ate($de, $ate) > $maxDias) throw bad('Período inválido.');
    return [$de, $ate];
}
function ativos(array $ocs): array { return array_values(array_filter($ocs, fn($o) => $o['status'] !== 'Cancelado')); }
function convites_pendentes(array $u): array
{
    $h = hoje(); $vistos = []; $out = [];
    foreach (lista_ocorrencias($u, $h, soma_dias($h, 180), ['meus' => 1]) as $o) {
        if ($o['minha_resposta'] === 'pendente' && $o['status'] !== 'Cancelado' && $o['criado_por'] !== $u['id'] && !isset($vistos[$o['id']])) { $vistos[$o['id']] = 1; $out[] = $o; }
    }
    return $out;
}

// ---------------- autenticação ----------------
rota('POST', '/login', 'anon', function ($c) {
    $login = txt($c['body']['login'] ?? '', 80);
    $chave = md5(($_SERVER['REMOTE_ADDR'] ?? '') . '|' . mb_strtolower($login));
    $t = one('SELECT * FROM ag_tentativas WHERE chave=?', [$chave]);
    if ($t && (int)$t['n'] >= 5 && time() < (int)$t['ate']) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    $u = one('SELECT * FROM ag_usuarios WHERE login=?', [$login]);
    $ok = password_verify((string)($c['body']['senha'] ?? ''), $u['senha_hash'] ?? '$2y$10$NwpVplLe55P8XQd1DufhSuiw1TEgidXN43aNgL038vDNlrQw3hjN6');
    if (!$u || !$ok || !(int)$u['ativo']) {
        $n = ($t ? (int)$t['n'] : 0) + 1;
        if ($t) run('UPDATE ag_tentativas SET n=?, ate=? WHERE chave=?', [$n, time() + 300, $chave]);
        else run('INSERT INTO ag_tentativas(chave,n,ate) VALUES(?,?,?)', [$chave, $n, time() + 300]);
        audit(null, 'login_falhou', $login);
        throw new HttpError(401, 'Login ou senha incorretos.');
    }
    run('DELETE FROM ag_tentativas WHERE chave=?', [$chave]);
    abre_sessao($u);
    run('UPDATE ag_usuarios SET ultimo_acesso=? WHERE id=?', [agora(), $u['id']]);
    audit($u, 'login');
    return publico($u);
});
rota('POST', '/logout', 'anon', function () { $_SESSION = []; session_destroy(); return ['ok' => true]; });
rota('GET', '/me', 'auth', fn($c) => publico($c['user']) + ['config' => get_config(), 'hoje' => hoje(), 'agora' => agora_local()]);
rota('POST', '/me/senha', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body'];
    if (!password_verify((string)($b['atual'] ?? ''), $u['senha_hash'])) throw bad('Senha atual incorreta.');
    valida_senha($b['nova'] ?? null);
    if ($b['nova'] === $b['atual']) throw bad('A nova senha deve ser diferente da atual.');
    $hash = password_hash($b['nova'], PASSWORD_DEFAULT);
    run('UPDATE ag_usuarios SET senha_hash=?, trocar_senha=0 WHERE id=?', [$hash, $u['id']]);
    $_SESSION['pv'] = pv(['senha_hash' => $hash]);
    audit($u, 'senha_alterada');
    return ['ok' => true];
});

// ---------------- usuários ----------------
rota('GET', '/usuarios', 'auth', function ($c) {
    $rows = all('SELECT id,nome,login,email,cargo,perfil,ativo,trocar_senha,criado_em,ultimo_acesso FROM ag_usuarios ORDER BY ativo DESC, nome');
    $rows = array_map(fn($r) => cast_ints($r, ['id', 'ativo', 'trocar_senha']), $rows);
    if ($c['user']['perfil'] === 'admin') return $rows;
    return array_values(array_map(fn($r) => ['id' => $r['id'], 'nome' => $r['nome'], 'cargo' => $r['cargo']], array_filter($rows, fn($r) => $r['ativo'])));
});
rota('POST', '/usuarios', 'admin', function ($c) {
    $b = $c['body'];
    $nome = txt($b['nome'] ?? '', 120); $login = txt($b['login'] ?? '', 40);
    if ($nome === '') throw bad('Informe o nome.');
    if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $login)) throw bad('Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).');
    if (!in_array($b['perfil'] ?? '', ['admin', 'usuario'], true)) throw bad('Perfil inválido.');
    valida_senha($b['senha'] ?? null);
    if (one('SELECT 1 FROM ag_usuarios WHERE LOWER(login)=LOWER(?)', [$login])) throw bad('Já existe um usuário com esse login.');
    run('INSERT INTO ag_usuarios(nome,login,email,cargo,perfil,senha_hash,trocar_senha,ativo,criado_em) VALUES(?,?,?,?,?,?,1,1,?)',
        [$nome, $login, txt($b['email'] ?? '', 120) ?: null, txt($b['cargo'] ?? '', 120) ?: null, $b['perfil'], password_hash($b['senha'], PASSWORD_DEFAULT), agora()]);
    $novoId = lid();
    audit($c['user'], 'usuario_criado', "$login ({$b['perfil']})");
    return ['id' => $novoId];
});
rota('PUT', '/usuarios/:id', 'admin', function ($c) {
    $id = (int)$c['p']['id']; $b = $c['body']; $user = $c['user'];
    $alvo = one('SELECT * FROM ag_usuarios WHERE id=?', [$id]);
    if (!$alvo) throw nao_encontrado('Usuário');
    $nome = txt($b['nome'] ?? $alvo['nome'], 120);
    $perfil = $b['perfil'] ?? $alvo['perfil'];
    $ativo = array_key_exists('ativo', $b) && $b['ativo'] !== null ? ($b['ativo'] ? 1 : 0) : (int)$alvo['ativo'];
    if ($nome === '') throw bad('Informe o nome.');
    if (!in_array($perfil, ['admin', 'usuario'], true)) throw bad('Perfil inválido.');
    if ($id === $user['id'] && ($perfil !== 'admin' || !$ativo)) throw bad('Você não pode remover seu próprio acesso de administrador.');
    run('UPDATE ag_usuarios SET nome=?,email=?,cargo=?,perfil=?,ativo=? WHERE id=?',
        [$nome, txt($b['email'] ?? $alvo['email'], 120) ?: null, txt($b['cargo'] ?? $alvo['cargo'], 120) ?: null, $perfil, $ativo, $id]);
    audit($user, 'usuario_editado', $alvo['login'] . ($ativo !== (int)$alvo['ativo'] ? ($ativo ? ' (reativado)' : ' (desativado)') : ''));
    return ['ok' => true];
});
rota('POST', '/usuarios/:id/senha', 'admin', function ($c) {
    $id = (int)$c['p']['id'];
    $alvo = one('SELECT login FROM ag_usuarios WHERE id=?', [$id]);
    if (!$alvo) throw nao_encontrado('Usuário');
    valida_senha($c['body']['senha'] ?? null);
    run('UPDATE ag_usuarios SET senha_hash=?, trocar_senha=1 WHERE id=?', [password_hash($c['body']['senha'], PASSWORD_DEFAULT), $id]);
    audit($c['user'], 'senha_redefinida', $alvo['login']);
    return ['ok' => true];
});

// ---------------- compromissos ----------------
rota('GET', '/eventos', 'auth', function ($c) {
    [$de, $ate] = intervalo($c['query']);
    return lista_ocorrencias($c['user'], $de, $ate, $c['query']);
});
rota('GET', '/eventos/:id', 'auth', function ($c) {
    $u = $c['user'];
    $e = one(SEL_EVENTO . ' WHERE e.id=?', [$u['id'], (int)$c['p']['id']]);
    if (!$e || !pode_ver($u, $e)) throw nao_encontrado('Compromisso');
    $e = cast_ints($e, ['id', 'recurso_id', 'criado_por', 'dia_inteiro', 'lembrete_min', 'participantes_n']);
    $e['participantes'] = array_map(fn($r) => ['id' => (int)$r['id'], 'nome' => $r['nome'], 'cargo' => $r['cargo'], 'resposta' => $r['resposta']],
        all('SELECT u.id, u.nome, u.cargo, p.resposta FROM ag_participantes p JOIN ag_usuarios u ON u.id=p.usuario_id WHERE p.evento_id=? ORDER BY u.nome', [$e['id']]));
    $e['data_inicio'] = substr($e['inicio'], 0, 10); $e['hora_inicio'] = substr($e['inicio'], 11, 5);
    $e['data_fim'] = substr($e['fim'], 0, 10); $e['hora_fim'] = substr($e['fim'], 11, 5);
    $e['excecoes'] = array_column(all('SELECT data FROM ag_excecoes WHERE evento_id=? ORDER BY data', [$e['id']]), 'data');
    $e['pode_editar'] = pode_editar_evento($u, $e);
    return $e;
});
function grava_participantes(int $evento, array $ids): void
{
    $atuais = array_map('intval', array_column(all('SELECT usuario_id FROM ag_participantes WHERE evento_id=?', [$evento]), 'usuario_id'));
    foreach (array_diff($atuais, $ids) as $rm) run('DELETE FROM ag_participantes WHERE evento_id=? AND usuario_id=?', [$evento, $rm]);
    foreach (array_diff($ids, $atuais) as $add) run("INSERT INTO ag_participantes(evento_id,usuario_id,resposta) VALUES(?,?,'pendente')", [$evento, $add]);
}
function checa_conflitos(array $d, int $criador, int $ignorar, array $user, array $b): void
{
    $conf = acha_conflitos($d, $criador, $ignorar, $user);
    if ($conf['recurso']) throw new HttpError(409, 'Conflito de reserva: ' . $conf['recurso'][0], ['conflitos' => $conf, 'forcavel' => false]);
    if ($conf['pessoas'] && empty($b['confirmar'])) throw new HttpError(409, 'Há conflitos na agenda dos participantes.', ['conflitos' => $conf, 'forcavel' => true]);
}
rota('POST', '/eventos', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body'];
    $d = valida_evento($b, get_config());
    $d['participantes'] = array_values(array_diff($d['participantes'], [$u['id']]));
    checa_conflitos($d, $u['id'], 0, $u, $b);
    $now = agora();
    run('INSERT INTO ag_eventos(titulo,descricao,categoria,local,recurso_id,inicio,fim,dia_inteiro,status,visibilidade,recorrencia,recorre_ate,lembrete_min,convidados_externos,criado_por,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$d['titulo'], $d['descricao'], $d['categoria'], $d['local'], $d['recurso_id'], $d['inicio'], $d['fim'], $d['dia_inteiro'], $d['status'], $d['visibilidade'], $d['recorrencia'], $d['recorre_ate'], $d['lembrete_min'], $d['convidados_externos'], $u['id'], $now, $now]);
    $id = lid();
    grava_participantes($id, $d['participantes']);
    audit($u, 'compromisso_criado', $d['titulo'] . ' em ' . fmt_br($d['inicio']));
    return ['id' => $id];
});
rota('PUT', '/eventos/:id', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body'];
    $e = one('SELECT * FROM ag_eventos WHERE id=?', [(int)$c['p']['id']]);
    if (!$e || !pode_ver($u, $e)) throw nao_encontrado('Compromisso');
    if (!pode_editar_evento($u, $e)) throw new HttpError(403, 'Apenas quem criou o compromisso ou um administrador pode editá-lo.');
    $d = valida_evento($b, get_config());
    $d['participantes'] = array_values(array_diff($d['participantes'], [(int)$e['criado_por']]));
    checa_conflitos($d, (int)$e['criado_por'], (int)$e['id'], $u, $b);
    run('UPDATE ag_eventos SET titulo=?,descricao=?,categoria=?,local=?,recurso_id=?,inicio=?,fim=?,dia_inteiro=?,status=?,visibilidade=?,recorrencia=?,recorre_ate=?,lembrete_min=?,convidados_externos=?,atualizado_em=? WHERE id=?',
        [$d['titulo'], $d['descricao'], $d['categoria'], $d['local'], $d['recurso_id'], $d['inicio'], $d['fim'], $d['dia_inteiro'], $d['status'], $d['visibilidade'], $d['recorrencia'], $d['recorre_ate'], $d['lembrete_min'], $d['convidados_externos'], agora(), $e['id']]);
    if ($d['inicio'] !== $e['inicio'] || $d['recorrencia'] !== $e['recorrencia']) run('DELETE FROM ag_excecoes WHERE evento_id=?', [$e['id']]);
    grava_participantes((int)$e['id'], $d['participantes']);
    audit($u, 'compromisso_editado', $d['titulo']);
    return ['ok' => true];
});
rota('DELETE', '/eventos/:id', 'auth', function ($c) {
    $u = $c['user'];
    $e = one('SELECT * FROM ag_eventos WHERE id=?', [(int)$c['p']['id']]);
    if (!$e || !pode_ver($u, $e)) throw nao_encontrado('Compromisso');
    if (!pode_editar_evento($u, $e)) throw new HttpError(403, 'Apenas quem criou o compromisso ou um administrador pode excluí-lo.');
    foreach (['ag_participantes', 'ag_excecoes'] as $t) run("DELETE FROM $t WHERE evento_id=?", [$e['id']]);
    run('DELETE FROM ag_eventos WHERE id=?', [$e['id']]);
    audit($u, 'compromisso_excluido', $e['titulo']);
    return ['ok' => true];
});
rota('POST', '/eventos/:id/cancelar-ocorrencia', 'auth', function ($c) {
    $u = $c['user'];
    $e = one('SELECT * FROM ag_eventos WHERE id=?', [(int)$c['p']['id']]);
    if (!$e || !pode_ver($u, $e)) throw nao_encontrado('Compromisso');
    if (!pode_editar_evento($u, $e)) throw new HttpError(403, 'Sem permissão para alterar este compromisso.');
    if ($e['recorrencia'] === 'nenhuma') throw bad('Este compromisso não se repete.');
    $data = $c['body']['data'] ?? '';
    if (!data_ok($data) || !ocorrencias($e, $data, $data)) throw bad('Ocorrência não encontrada.');
    if (!one('SELECT 1 FROM ag_excecoes WHERE evento_id=? AND data=?', [$e['id'], $data])) run('INSERT INTO ag_excecoes(evento_id,data) VALUES(?,?)', [$e['id'], $data]);
    audit($u, 'ocorrencia_cancelada', $e['titulo'] . ' em ' . fmt_br($data));
    return ['ok' => true];
});
rota('POST', '/eventos/:id/resposta', 'auth', function ($c) {
    $u = $c['user'];
    $r = $c['body']['resposta'] ?? '';
    if (!in_array($r, ['aceito', 'recusado', 'pendente'], true)) throw bad('Resposta inválida.');
    $p = one('SELECT 1 FROM ag_participantes WHERE evento_id=? AND usuario_id=?', [(int)$c['p']['id'], $u['id']]);
    if (!$p) throw new HttpError(403, 'Você não foi convidado para este compromisso.');
    run('UPDATE ag_participantes SET resposta=? WHERE evento_id=? AND usuario_id=?', [$r, (int)$c['p']['id'], $u['id']]);
    return ['ok' => true];
});
rota('POST', '/eventos/:id/status', 'auth', function ($c) {
    $u = $c['user'];
    $e = one('SELECT * FROM ag_eventos WHERE id=?', [(int)$c['p']['id']]);
    if (!$e || !pode_ver($u, $e)) throw nao_encontrado('Compromisso');
    if (!pode_editar_evento($u, $e)) throw new HttpError(403, 'Sem permissão para alterar este compromisso.');
    $s = $c['body']['status'] ?? '';
    if (!in_array($s, STATUS_EVENTO, true)) throw bad('Situação inválida.');
    run('UPDATE ag_eventos SET status=?, atualizado_em=? WHERE id=?', [$s, agora(), $e['id']]);
    audit($u, 'compromisso_status', $e['titulo'] . ': ' . $s);
    return ['ok' => true];
});

// ---------------- painel e alertas ----------------
rota('GET', '/painel', 'auth', function ($c) {
    $u = $c['user']; $h = hoje(); $ini = substr($h, 0, 8) . '01'; $fim = date('Y-m-t');
    $hojeOcs = ativos(lista_ocorrencias($u, $h, $h, ['meus' => 1]));
    $prox = ativos(lista_ocorrencias($u, soma_dias($h, 1), soma_dias($h, 7), ['meus' => 1]));
    $mes = ativos(lista_ocorrencias($u, $ini, $fim));
    $porCat = [];
    foreach ($mes as $o) $porCat[$o['categoria']] = ($porCat[$o['categoria']] ?? 0) + 1;
    arsort($porCat);
    $tmine = '(responsavel_id = ? OR criado_por = ?)';
    $tp = [$u['id'], $u['id']];
    $tarefas = all('SELECT t.*, r.nome AS responsavel_nome FROM ag_tarefas t LEFT JOIN ag_usuarios r ON r.id=t.responsavel_id WHERE concluida=0 AND ' . $tmine . ' ORDER BY (t.prazo IS NULL) ASC, t.prazo ASC, t.id DESC LIMIT 6', $tp);
    return [
        'hoje' => $hojeOcs, 'proximos' => $prox, 'convites' => convites_pendentes($u),
        'eventos_mes' => count($mes),
        'por_categoria' => array_map(fn($n, $t) => ['nome' => $n, 'total' => $t], array_keys($porCat), array_values($porCat)),
        'reservas_hoje' => array_values(array_filter(ativos(lista_ocorrencias($u, $h, $h)), fn($o) => $o['recurso_id'])),
        'tarefas_atrasadas' => cnt("SELECT COUNT(*) FROM ag_tarefas WHERE concluida=0 AND prazo < ? AND $tmine", array_merge([$h], $tp)),
        'tarefas_hoje' => cnt("SELECT COUNT(*) FROM ag_tarefas WHERE concluida=0 AND prazo = ? AND $tmine", array_merge([$h], $tp)),
        'tarefas_pendentes' => cnt("SELECT COUNT(*) FROM ag_tarefas WHERE concluida=0 AND $tmine", $tp),
        'tarefas' => array_map('decora_tarefa', $tarefas),
    ];
});
rota('GET', '/alertas', 'auth', function ($c) {
    $u = $c['user']; $h = hoje(); $now = time();
    $prox = ativos(lista_ocorrencias($u, $h, soma_dias($h, 2), ['meus' => 1]));
    $lemb = [];
    foreach ($prox as $o) {
        if ($o['lembrete_min'] === null || $o['dia_inteiro']) continue;
        $ini = strtotime($o['inicio']); $fim = strtotime($o['fim']);
        if ($now >= $ini - $o['lembrete_min'] * 60 && $now < $fim) $lemb[] = $o + ['minutos' => (int)ceil(($ini - $now) / 60)];
    }
    $tar = array_map('decora_tarefa', all('SELECT t.*, r.nome AS responsavel_nome FROM ag_tarefas t LEFT JOIN ag_usuarios r ON r.id=t.responsavel_id
        WHERE concluida=0 AND prazo IS NOT NULL AND prazo <= ? AND responsavel_id=? ORDER BY prazo ASC LIMIT 100', [$h, $u['id']]));
    $conv = convites_pendentes($u);
    return [
        'lembretes' => $lemb, 'hoje' => array_values(array_filter($prox, fn($o) => $o['ocorrencia'] === $h || ($o['inicio'] <= "$h 23:59:59" && $o['fim'] >= "$h 00:00:00"))),
        'convites' => $conv, 'tarefas' => $tar, 'total' => count($lemb) + count($conv) + count($tar),
    ];
});

// ---------------- tarefas ----------------
function valida_tarefa(array $b): array
{
    $d = ['titulo' => txt($b['titulo'] ?? '', 200)];
    if ($d['titulo'] === '') throw bad('Informe o título da tarefa.');
    $d['descricao'] = txt($b['descricao'] ?? '', 3000) ?: null;
    $d['prazo'] = ($b['prazo'] ?? '') ?: null;
    if ($d['prazo'] !== null && !data_ok($d['prazo'])) throw bad('Prazo inválido.');
    $d['prioridade'] = ($b['prioridade'] ?? '') ?: 'Normal';
    if (!in_array($d['prioridade'], PRIORIDADES, true)) throw bad('Prioridade inválida.');
    $d['responsavel_id'] = !empty($b['responsavel_id']) ? (int)$b['responsavel_id'] : null;
    if ($d['responsavel_id'] && !one('SELECT 1 FROM ag_usuarios WHERE id=? AND ativo=1', [$d['responsavel_id']])) throw bad('Responsável inválido.');
    return $d;
}
rota('GET', '/tarefas', 'auth', function ($c) {
    $u = $c['user']; $q = $c['query']; $w = []; $p = [];
    if (($q['escopo'] ?? '') === 'todas' && $u['perfil'] === 'admin') { /* sem filtro */ }
    else { $w[] = '(t.responsavel_id = ? OR t.criado_por = ?)'; array_push($p, $u['id'], $u['id']); }
    $st = $q['status'] ?? 'abertas';
    if ($st === 'abertas') $w[] = 't.concluida = 0'; elseif ($st === 'concluidas') $w[] = 't.concluida = 1';
    if (!empty($q['q'])) { $w[] = '(t.titulo LIKE ? OR t.descricao LIKE ?)'; $l = '%' . txt($q['q'], 100) . '%'; array_push($p, $l, $l); }
    $rows = all('SELECT t.*, r.nome AS responsavel_nome, cr.nome AS criador_nome FROM ag_tarefas t LEFT JOIN ag_usuarios r ON r.id=t.responsavel_id LEFT JOIN ag_usuarios cr ON cr.id=t.criado_por'
        . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY t.concluida ASC, (t.prazo IS NULL) ASC, t.prazo ASC, t.id DESC LIMIT 1000', $p);
    return array_map('decora_tarefa', $rows);
});
rota('POST', '/tarefas', 'auth', function ($c) {
    $u = $c['user']; $d = valida_tarefa($c['body']);
    if (!$d['responsavel_id']) $d['responsavel_id'] = $u['id'];
    $now = agora();
    run('INSERT INTO ag_tarefas(titulo,descricao,prazo,prioridade,concluida,responsavel_id,criado_por,criado_em,atualizado_em) VALUES(?,?,?,?,0,?,?,?,?)',
        [$d['titulo'], $d['descricao'], $d['prazo'], $d['prioridade'], $d['responsavel_id'], $u['id'], $now, $now]);
    $novoId = lid();
    audit($u, 'tarefa_criada', $d['titulo']);
    return ['id' => $novoId];
});
rota('PUT', '/tarefas/:id', 'auth', function ($c) {
    $u = $c['user'];
    $t = one('SELECT * FROM ag_tarefas WHERE id=?', [(int)$c['p']['id']]);
    if (!$t) throw nao_encontrado('Tarefa');
    if (!pode_tarefa($u, $t)) throw new HttpError(403, 'Sem permissão para editar esta tarefa.');
    $d = valida_tarefa($c['body']);
    run('UPDATE ag_tarefas SET titulo=?,descricao=?,prazo=?,prioridade=?,responsavel_id=?,atualizado_em=? WHERE id=?',
        [$d['titulo'], $d['descricao'], $d['prazo'], $d['prioridade'], $d['responsavel_id'] ?: $t['responsavel_id'], agora(), $t['id']]);
    audit($u, 'tarefa_editada', $d['titulo']);
    return ['ok' => true];
});
rota('POST', '/tarefas/:id/concluir', 'auth', function ($c) {
    $u = $c['user'];
    $t = one('SELECT * FROM ag_tarefas WHERE id=?', [(int)$c['p']['id']]);
    if (!$t) throw nao_encontrado('Tarefa');
    if (!pode_tarefa($u, $t)) throw new HttpError(403, 'Sem permissão para alterar esta tarefa.');
    $conc = !empty($c['body']['concluida']) ? 1 : 0;
    run('UPDATE ag_tarefas SET concluida=?, concluida_em=?, atualizado_em=? WHERE id=?', [$conc, $conc ? agora() : null, agora(), $t['id']]);
    return ['ok' => true];
});
rota('DELETE', '/tarefas/:id', 'auth', function ($c) {
    $u = $c['user'];
    $t = one('SELECT * FROM ag_tarefas WHERE id=?', [(int)$c['p']['id']]);
    if (!$t) throw nao_encontrado('Tarefa');
    if (!pode_tarefa($u, $t)) throw new HttpError(403, 'Sem permissão para excluir esta tarefa.');
    run('DELETE FROM ag_tarefas WHERE id=?', [$t['id']]);
    audit($u, 'tarefa_excluida', $t['titulo']);
    return ['ok' => true];
});

// ---------------- contatos ----------------
function valida_contato(array $b): array
{
    $d = ['nome' => txt($b['nome'] ?? '', 150)];
    if ($d['nome'] === '') throw bad('Informe o nome do contato.');
    foreach (['cargo' => 120, 'orgao' => 150, 'telefone' => 40, 'celular' => 40, 'email' => 120, 'observacoes' => 1000] as $k => $m) $d[$k] = txt($b[$k] ?? '', $m) ?: null;
    if ($d['email'] !== null && !filter_var($d['email'], FILTER_VALIDATE_EMAIL)) throw bad('E-mail inválido.');
    return $d;
}
rota('GET', '/contatos', 'auth', function ($c) {
    $w = ''; $p = [];
    if (!empty($c['query']['q'])) {
        $w = ' WHERE (nome LIKE ? OR cargo LIKE ? OR orgao LIKE ? OR telefone LIKE ? OR celular LIKE ? OR email LIKE ?)';
        $l = '%' . txt($c['query']['q'], 100) . '%'; $p = array_fill(0, 6, $l);
    }
    return array_map(fn($r) => cast_ints($r, ['id', 'criado_por']), all('SELECT * FROM ag_contatos' . $w . ' ORDER BY nome LIMIT 1000', $p));
});
rota('POST', '/contatos', 'auth', function ($c) {
    $d = valida_contato($c['body']);
    run('INSERT INTO ag_contatos(nome,cargo,orgao,telefone,celular,email,observacoes,criado_por,criado_em) VALUES(?,?,?,?,?,?,?,?,?)',
        [$d['nome'], $d['cargo'], $d['orgao'], $d['telefone'], $d['celular'], $d['email'], $d['observacoes'], $c['user']['id'], agora()]);
    $novoId = lid();
    audit($c['user'], 'contato_criado', $d['nome']);
    return ['id' => $novoId];
});
rota('PUT', '/contatos/:id', 'auth', function ($c) {
    $u = $c['user'];
    $t = one('SELECT * FROM ag_contatos WHERE id=?', [(int)$c['p']['id']]);
    if (!$t) throw nao_encontrado('Contato');
    if ($u['perfil'] !== 'admin' && (int)$t['criado_por'] !== $u['id']) throw new HttpError(403, 'Apenas quem cadastrou o contato ou um administrador pode editá-lo.');
    $d = valida_contato($c['body']);
    run('UPDATE ag_contatos SET nome=?,cargo=?,orgao=?,telefone=?,celular=?,email=?,observacoes=? WHERE id=?',
        [$d['nome'], $d['cargo'], $d['orgao'], $d['telefone'], $d['celular'], $d['email'], $d['observacoes'], $t['id']]);
    audit($u, 'contato_editado', $d['nome']);
    return ['ok' => true];
});
rota('DELETE', '/contatos/:id', 'auth', function ($c) {
    $u = $c['user'];
    $t = one('SELECT * FROM ag_contatos WHERE id=?', [(int)$c['p']['id']]);
    if (!$t) throw nao_encontrado('Contato');
    if ($u['perfil'] !== 'admin' && (int)$t['criado_por'] !== $u['id']) throw new HttpError(403, 'Apenas quem cadastrou o contato ou um administrador pode excluí-lo.');
    run('DELETE FROM ag_contatos WHERE id=?', [$t['id']]);
    audit($u, 'contato_excluido', $t['nome']);
    return ['ok' => true];
});

// ---------------- recursos, configurações, auditoria, exportação ----------------
rota('GET', '/recursos', 'auth', function ($c) {
    $sql = 'SELECT id,nome,tipo,ativo FROM ag_recursos' . ($c['user']['perfil'] === 'admin' ? '' : ' WHERE ativo=1') . ' ORDER BY ativo DESC, nome';
    return array_map(fn($r) => cast_ints($r, ['id', 'ativo']), all($sql));
});
function valida_recurso(array $b): array
{
    $n = txt($b['nome'] ?? '', 120);
    if ($n === '') throw bad('Informe o nome do recurso.');
    $t = $b['tipo'] ?? 'Sala';
    if (!in_array($t, TIPOS_RECURSO, true)) throw bad('Tipo de recurso inválido.');
    return [$n, $t];
}
rota('POST', '/recursos', 'admin', function ($c) {
    [$n, $t] = valida_recurso($c['body']);
    run('INSERT INTO ag_recursos(nome,tipo,ativo) VALUES(?,?,1)', [$n, $t]);
    $novoId = lid();
    audit($c['user'], 'recurso_criado', $n);
    return ['id' => $novoId];
});
rota('PUT', '/recursos/:id', 'admin', function ($c) {
    $r = one('SELECT * FROM ag_recursos WHERE id=?', [(int)$c['p']['id']]);
    if (!$r) throw nao_encontrado('Recurso');
    [$n, $t] = valida_recurso($c['body'] + ['nome' => $r['nome'], 'tipo' => $r['tipo']]);
    $ativo = array_key_exists('ativo', $c['body']) ? ($c['body']['ativo'] ? 1 : 0) : (int)$r['ativo'];
    run('UPDATE ag_recursos SET nome=?,tipo=?,ativo=? WHERE id=?', [$n, $t, $ativo, $r['id']]);
    audit($c['user'], 'recurso_editado', $n . ($ativo ? '' : ' (desativado)'));
    return ['ok' => true];
});
rota('GET', '/config', 'auth', fn() => get_config());
rota('PUT', '/config', 'admin', function ($c) {
    $b = $c['body'];
    if (isset($b['categorias'])) {
        if (!is_array($b['categorias'])) throw bad('Lista de categorias inválida.');
        $cats = []; $vistos = [];
        foreach ($b['categorias'] as $x) {
            $n = txt($x['nome'] ?? '', 60); $cor = (string)($x['cor'] ?? '');
            if ($n === '') continue;
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', $cor)) throw bad("Cor inválida para a categoria «$n».");
            if (isset($vistos[mb_strtolower($n)])) continue;
            $vistos[mb_strtolower($n)] = 1; $cats[] = ['nome' => $n, 'cor' => strtolower($cor)];
        }
        if (!$cats) throw bad('Informe pelo menos uma categoria.');
        set_config('categorias', $cats);
    }
    if (isset($b['hora_inicio']) || isset($b['hora_fim'])) {
        $cur = get_config();
        $hi = (int)($b['hora_inicio'] ?? $cur['hora_inicio']); $hf = (int)($b['hora_fim'] ?? $cur['hora_fim']);
        if ($hi < 0 || $hi > 22 || $hf < 1 || $hf > 24 || $hf <= $hi) throw bad('Horário da agenda inválido.');
        set_config('hora_inicio', $hi); set_config('hora_fim', $hf);
    }
    if (array_key_exists('lembrete_padrao', $b)) {
        $l = ($b['lembrete_padrao'] === null || $b['lembrete_padrao'] === '') ? null : (int)$b['lembrete_padrao'];
        if ($l !== null && !in_array($l, LEMBRETES, true)) throw bad('Lembrete padrão inválido.');
        set_config('lembrete_padrao', $l);
    }
    audit($c['user'], 'config_alterada');
    return get_config();
});
rota('GET', '/auditoria', 'admin', function ($c) {
    $q = '%' . txt($c['query']['q'] ?? '', 80) . '%';
    return all('SELECT * FROM ag_auditoria WHERE (usuario_nome LIKE ? OR acao LIKE ? OR detalhe LIKE ?) ORDER BY id DESC LIMIT 300', [$q, $q, $q]);
});
rota('GET', '/exportar.ics', 'auth', function ($c) {
    $u = $c['user']; $q = $c['query']; $h = hoje();
    $de = data_ok($q['inicio'] ?? '') ? $q['inicio'] : soma_dias($h, -30);
    $ate = data_ok($q['fim'] ?? '') ? $q['fim'] : soma_dias($h, 365);
    if ($ate < $de || dias_ate($de, $ate) > 1200) throw bad('Período inválido.');
    $ocs = lista_ocorrencias($u, $de, $ate, ['meus' => 1]);
    if (!empty($q['evento'])) $ocs = array_values(array_filter($ocs, fn($o) => $o['id'] === (int)$q['evento']));
    $det = [];
    if ($ocs) foreach (all('SELECT id, descricao FROM ag_eventos WHERE descricao IS NOT NULL AND id IN (' . in_marks(array_unique(array_column($ocs, 'id'))) . ')', array_values(array_unique(array_column($ocs, 'id')))) as $r) $det[(int)$r['id']] = $r['descricao'];
    audit($u, 'exportacao_ics', count($ocs) . ' compromissos');
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: attachment; filename="agenda-' . $h . '.ics"');
    echo gera_ics($ocs, $det);
    exit;
});

// ---------------- despacho ----------------
try {
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
    $path = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
    if ($base !== '' && strpos($path, $base) === 0) $path = substr($path, strlen($base));
    $path = preg_replace('#^/(api\.php|api)(?=/|$)#', '', $path);
    $metodo = $_SERVER['REQUEST_METHOD'];

    $achada = null;
    foreach ($rotas as $r) if ($r[0] === $metodo && preg_match($r[1], $path, $m)) { $achada = [$r, array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY)]; break; }
    if (!$achada) throw new HttpError(404, 'Rota não encontrada.');
    [$r, $params] = $achada;

    if ($metodo !== 'GET' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') throw new HttpError(403, 'Requisição inválida.');
    config();
    inicia_sessao();
    $user = usuario_da_sessao();
    if ($r[2] !== 'anon' && !$user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    if ($r[2] === 'admin' && $user['perfil'] !== 'admin') throw new HttpError(403, 'Acesso restrito ao administrador.');
    if ($user && $user['trocar_senha'] && !in_array($path, ['/me', '/me/senha', '/logout'], true)) throw new HttpError(403, 'Troque sua senha para continuar.');

    $body = [];
    if ($metodo !== 'GET') {
        $raw = file_get_contents('php://input', false, null, 0, 1000001);
        if (strlen((string)$raw) > 1000000) throw new HttpError(413, 'Requisição muito grande.');
        if ($raw !== '' && $raw !== false) {
            $body = json_decode($raw, true);
            if (!is_array($body)) throw bad('JSON inválido.');
        }
    }
    responde(200, ($r[3])(['user' => $user, 'body' => $body, 'p' => $params, 'query' => $_GET]));
} catch (HttpError $e) {
    $dados = ['erro' => $e->getMessage()] + $e->extra;
    if ($e->instalar) $dados['instalar'] = true;
    responde($e->status, $dados);
} catch (Throwable $e) {
    error_log('[agenda] ' . $e);
    responde(500, ['erro' => 'Erro interno do servidor.']);
}
