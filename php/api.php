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

// ---------------- autenticação ----------------
rota('POST', '/login', 'anon', function ($c) {
    $login = txt($c['body']['login'] ?? '', 80);
    $chave = md5(($_SERVER['REMOTE_ADDR'] ?? '') . '|' . mb_strtolower($login));
    $t = one('SELECT * FROM tentativas WHERE chave=?', [$chave]);
    if ($t && (int)$t['n'] >= 5 && time() < (int)$t['ate']) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    $u = one('SELECT * FROM usuarios WHERE login=?', [$login]);
    // sempre calcula um hash, para não revelar por tempo de resposta se o usuário existe
    $ok = password_verify((string)($c['body']['senha'] ?? ''), $u['senha_hash'] ?? '$2y$10$NwpVplLe55P8XQd1DufhSuiw1TEgidXN43aNgL038vDNlrQw3hjN6');
    if (!$u || !$ok || !(int)$u['ativo']) {
        $n = ($t ? (int)$t['n'] : 0) + 1;
        if ($t) run('UPDATE tentativas SET n=?, ate=? WHERE chave=?', [$n, time() + 300, $chave]);
        else run('INSERT INTO tentativas(chave,n,ate) VALUES(?,?,?)', [$chave, $n, time() + 300]);
        audit(null, 'login_falhou', $login);
        throw new HttpError(401, 'Login ou senha incorretos.');
    }
    run('DELETE FROM tentativas WHERE chave=?', [$chave]);
    abre_sessao($u);
    run('UPDATE usuarios SET ultimo_acesso=? WHERE id=?', [agora(), $u['id']]);
    audit($u, 'login');
    return publico($u);
});
rota('POST', '/logout', 'anon', function () {
    $_SESSION = [];
    session_destroy();
    return ['ok' => true];
});
rota('GET', '/me', 'auth', fn($c) => publico($c['user']) + ['config' => get_config(), 'hoje' => hoje()]);
rota('POST', '/me/senha', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body'];
    if (!password_verify((string)($b['atual'] ?? ''), $u['senha_hash'])) throw bad('Senha atual incorreta.');
    valida_senha($b['nova'] ?? null);
    if ($b['nova'] === $b['atual']) throw bad('A nova senha deve ser diferente da atual.');
    $hash = password_hash($b['nova'], PASSWORD_DEFAULT);
    run('UPDATE usuarios SET senha_hash=?, trocar_senha=0 WHERE id=?', [$hash, $u['id']]);
    $_SESSION['pv'] = pv(['senha_hash' => $hash]);
    audit($u, 'senha_alterada');
    return ['ok' => true];
});

// ---------------- usuários ----------------
rota('GET', '/usuarios', 'auth', function ($c) {
    $rows = all('SELECT id,nome,login,email,cargo,perfil,ativo,trocar_senha,criado_em,ultimo_acesso FROM usuarios ORDER BY ativo DESC, nome');
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
    if (one('SELECT 1 FROM usuarios WHERE LOWER(login)=LOWER(?)', [$login])) throw bad('Já existe um usuário com esse login.');
    run('INSERT INTO usuarios(nome,login,email,cargo,perfil,senha_hash,trocar_senha,ativo,criado_em) VALUES(?,?,?,?,?,?,1,1,?)',
        [$nome, $login, txt($b['email'] ?? '', 120) ?: null, txt($b['cargo'] ?? '', 120) ?: null, $b['perfil'], password_hash($b['senha'], PASSWORD_DEFAULT), agora()]);
    audit($c['user'], 'usuario_criado', "$login ({$b['perfil']})");
    return ['id' => (int)db()->lastInsertId()];
});
rota('PUT', '/usuarios/:id', 'admin', function ($c) {
    $id = (int)$c['p']['id']; $b = $c['body']; $user = $c['user'];
    $alvo = one('SELECT * FROM usuarios WHERE id=?', [$id]);
    if (!$alvo) throw new HttpError(404, 'Usuário não encontrado.');
    $nome = txt($b['nome'] ?? $alvo['nome'], 120);
    $perfil = $b['perfil'] ?? $alvo['perfil'];
    $ativo = array_key_exists('ativo', $b) && $b['ativo'] !== null ? ($b['ativo'] ? 1 : 0) : (int)$alvo['ativo'];
    if ($nome === '') throw bad('Informe o nome.');
    if (!in_array($perfil, ['admin', 'usuario'], true)) throw bad('Perfil inválido.');
    if ($id === $user['id'] && ($perfil !== 'admin' || !$ativo)) throw bad('Você não pode remover seu próprio acesso de administrador.');
    run('UPDATE usuarios SET nome=?,email=?,cargo=?,perfil=?,ativo=? WHERE id=?',
        [$nome, txt($b['email'] ?? $alvo['email'], 120) ?: null, txt($b['cargo'] ?? $alvo['cargo'], 120) ?: null, $perfil, $ativo, $id]);
    audit($user, 'usuario_editado', $alvo['login'] . ($ativo !== (int)$alvo['ativo'] ? ($ativo ? ' (reativado)' : ' (desativado)') : ''));
    return ['ok' => true];
});
rota('POST', '/usuarios/:id/senha', 'admin', function ($c) {
    $id = (int)$c['p']['id'];
    $alvo = one('SELECT login FROM usuarios WHERE id=?', [$id]);
    if (!$alvo) throw new HttpError(404, 'Usuário não encontrado.');
    valida_senha($c['body']['senha'] ?? null);
    run('UPDATE usuarios SET senha_hash=?, trocar_senha=1 WHERE id=?', [password_hash($c['body']['senha'], PASSWORD_DEFAULT), $id]);
    audit($c['user'], 'senha_redefinida', $alvo['login']);
    return ['ok' => true];
});

// ---------------- processos ----------------
rota('GET', '/processos', 'auth', fn($c) => lista_processos($c['query'], $c['user']));
rota('POST', '/processos', 'auth', function ($c) {
    $user = $c['user']; $d = valida_processo($c['body']);
    if ($d['prazo'] && $d['prazo'] < $d['data_abertura']) throw bad('O prazo não pode ser anterior à data de abertura.');
    if (!array_key_exists('responsavel_id', $d)) $d['responsavel_id'] = $user['id'];
    numero_unico($d['numero']);
    $now = agora();
    run('INSERT INTO processos(numero,assunto,tipo,interessado,origem,descricao,prioridade,status,data_abertura,prazo,responsavel_id,criado_por,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$d['numero'], $d['assunto'], $d['tipo'], $d['interessado'], $d['origem'], $d['descricao'], $d['prioridade'], 'Aberto', $d['data_abertura'], $d['prazo'], $d['responsavel_id'], $user['id'], $now, $now]);
    $id = (int)db()->lastInsertId();
    add_mov($id, $user['id'], 'abertura', 'Processo cadastrado.');
    audit($user, 'processo_criado', $d['numero']);
    return ['id' => $id, 'numero' => $d['numero']];
});
rota('GET', '/processos/:id', 'auth', function ($c) {
    $p = one(BASE_SELECT . ' WHERE p.id=?', [(int)$c['p']['id']]);
    if (!$p) throw new HttpError(404, 'Processo não encontrado.');
    $movs = all('SELECT m.*, u.nome AS usuario_nome FROM movimentacoes m LEFT JOIN usuarios u ON u.id=m.usuario_id WHERE m.processo_id=? ORDER BY m.id DESC', [(int)$p['id']]);
    return decora([$p], get_config())[0] + ['movimentacoes' => $movs];
});
rota('PUT', '/processos/:id', 'auth', function ($c) {
    $user = $c['user'];
    $atual = one('SELECT * FROM processos WHERE id=?', [(int)$c['p']['id']]);
    if (!$atual) throw new HttpError(404, 'Processo não encontrado.');
    if (!pode_editar($user, $atual)) throw new HttpError(403, 'Apenas o responsável, quem abriu o processo ou um administrador pode editá-lo.');
    $d = valida_processo($c['body'], true);
    $novo = array_merge($atual, $d);
    if ($novo['prazo'] && $novo['prazo'] < $novo['data_abertura']) throw bad('O prazo não pode ser anterior à data de abertura.');
    $mud = [];
    if (isset($d['numero']) && $d['numero'] !== $atual['numero']) { numero_unico($d['numero'], (int)$atual['id']); $mud[] = "Número alterado de {$atual['numero']} para {$d['numero']}"; }
    if (array_key_exists('prazo', $d) && $d['prazo'] !== $atual['prazo']) $mud[] = 'Prazo alterado de ' . ($atual['prazo'] ?: 'sem prazo') . ' para ' . ($d['prazo'] ?: 'sem prazo');
    if (isset($d['prioridade']) && $d['prioridade'] !== $atual['prioridade']) $mud[] = "Prioridade: {$atual['prioridade']} → {$d['prioridade']}";
    if (array_key_exists('responsavel_id', $d) && $d['responsavel_id'] !== ($atual['responsavel_id'] === null ? null : (int)$atual['responsavel_id'])) {
        $nome = fn($i) => $i ? (one('SELECT nome FROM usuarios WHERE id=?', [$i])['nome'] ?? 'ninguém') : 'ninguém';
        $mud[] = 'Responsável: ' . $nome($atual['responsavel_id']) . ' → ' . $nome($d['responsavel_id']);
    }
    run('UPDATE processos SET numero=?,assunto=?,tipo=?,interessado=?,origem=?,descricao=?,prioridade=?,data_abertura=?,prazo=?,responsavel_id=?,atualizado_em=? WHERE id=?',
        [$novo['numero'], $novo['assunto'], $novo['tipo'], $novo['interessado'], $novo['origem'], $novo['descricao'], $novo['prioridade'], $novo['data_abertura'], $novo['prazo'], $novo['responsavel_id'], agora(), $atual['id']]);
    if ($mud) add_mov((int)$atual['id'], $user['id'], 'alteracao', implode('; ', $mud) . '.');
    audit($user, 'processo_editado', $atual['numero']);
    return ['ok' => true];
});
rota('POST', '/processos/:id/status', 'auth', function ($c) {
    $user = $c['user']; $b = $c['body'];
    $p = one('SELECT * FROM processos WHERE id=?', [(int)$c['p']['id']]);
    if (!$p) throw new HttpError(404, 'Processo não encontrado.');
    if (!pode_editar($user, $p)) throw new HttpError(403, 'Sem permissão para alterar a situação deste processo.');
    if (!in_array($b['status'] ?? '', STATUS_LISTA, true)) throw bad('Situação inválida.');
    $concl = in_array($b['status'], ['Concluído', 'Arquivado'], true) ? ($p['data_conclusao'] ?: hoje()) : null;
    run('UPDATE processos SET status=?, data_conclusao=?, atualizado_em=? WHERE id=?', [$b['status'], $concl, agora(), $p['id']]);
    $obs = txt($b['observacao'] ?? '', 2000);
    add_mov((int)$p['id'], $user['id'], 'status', "Situação: {$p['status']} → {$b['status']}." . ($obs !== '' ? " $obs" : ''));
    audit($user, 'processo_status', "{$p['numero']}: {$b['status']}");
    return ['ok' => true];
});
rota('POST', '/processos/:id/movimentacoes', 'auth', function ($c) {
    $p = one('SELECT id FROM processos WHERE id=?', [(int)$c['p']['id']]);
    if (!$p) throw new HttpError(404, 'Processo não encontrado.');
    $texto = txt($c['body']['texto'] ?? '', 3000);
    if ($texto === '') throw bad('Escreva o andamento.');
    add_mov((int)$p['id'], $c['user']['id'], 'andamento', $texto);
    run('UPDATE processos SET atualizado_em=? WHERE id=?', [agora(), $p['id']]);
    return ['ok' => true];
});
rota('DELETE', '/processos/:id', 'admin', function ($c) {
    $p = one('SELECT numero FROM processos WHERE id=?', [(int)$c['p']['id']]);
    if (!$p) throw new HttpError(404, 'Processo não encontrado.');
    run('DELETE FROM movimentacoes WHERE processo_id=?', [(int)$c['p']['id']]);
    run('DELETE FROM processos WHERE id=?', [(int)$c['p']['id']]);
    audit($c['user'], 'processo_excluido', $p['numero']);
    return ['ok' => true];
});

// ---------------- alertas e painel ----------------
rota('GET', '/alertas', 'auth', function ($c) {
    $cfg = get_config(); $h = hoje(); $user = $c['user'];
    $sql = BASE_SELECT . ' WHERE p.status IN ' . SQL_ABERTOS . ' AND p.prazo IS NOT NULL AND p.prazo <= ?';
    $par = [soma_dias($h, (int)$cfg['dias_alerta'])];
    if ($user['perfil'] !== 'admin') { $sql .= ' AND p.responsavel_id=?'; $par[] = $user['id']; }
    return ['dias_alerta' => (int)$cfg['dias_alerta'], 'itens' => decora(all($sql . ' ORDER BY p.prazo ASC LIMIT 200', $par), $cfg)];
});
rota('GET', '/painel', 'auth', function ($c) {
    $cfg = get_config(); $h = hoje(); $dias = (int)$cfg['dias_alerta']; $ab = 'status IN ' . SQL_ABERTOS; $uid = $c['user']['id'];
    $ano = substr($h, 0, 4);
    $por = fn($col) => array_map(fn($r) => cast_ints($r, ['total']), all("SELECT COALESCE($col,'—') AS nome, COUNT(*) AS total FROM processos WHERE $ab GROUP BY COALESCE($col,'—') ORDER BY total DESC"));
    return [
        'dias_alerta' => $dias,
        'total_abertos' => cnt("SELECT COUNT(*) FROM processos WHERE $ab"),
        'vencidos' => cnt("SELECT COUNT(*) FROM processos WHERE $ab AND prazo < ?", [$h]),
        'hoje' => cnt("SELECT COUNT(*) FROM processos WHERE $ab AND prazo = ?", [$h]),
        'proximos' => cnt("SELECT COUNT(*) FROM processos WHERE $ab AND prazo > ? AND prazo <= ?", [$h, soma_dias($h, $dias)]),
        'sem_prazo' => cnt("SELECT COUNT(*) FROM processos WHERE $ab AND prazo IS NULL"),
        'meus_abertos' => cnt("SELECT COUNT(*) FROM processos WHERE $ab AND responsavel_id=?", [$uid]),
        'concluidos_ano' => cnt("SELECT COUNT(*) FROM processos WHERE status='Concluído' AND data_conclusao >= ? AND data_conclusao <= ?", ["$ano-01-01", "$ano-12-31"]),
        'por_status' => array_map(fn($r) => ['nome' => $r['nome'], 'total' => (int)$r['total']], all('SELECT status AS nome, COUNT(*) AS total FROM processos GROUP BY status')),
        'por_tipo' => $por('tipo'),
        'por_responsavel' => array_map(fn($r) => cast_ints($r, ['total', 'vencidos']), all(
            "SELECT COALESCE(u.nome,'Sem responsável') AS nome, COUNT(*) AS total, SUM(CASE WHEN p.prazo < ? THEN 1 ELSE 0 END) AS vencidos
             FROM processos p LEFT JOIN usuarios u ON u.id=p.responsavel_id WHERE p.$ab GROUP BY p.responsavel_id, u.nome ORDER BY total DESC LIMIT 10", [$h])),
        'recentes' => array_map(fn($r) => cast_ints($r, ['processo_id']), all(
            'SELECT m.criado_em, m.tipo, m.texto, p.id AS processo_id, p.numero, u.nome AS usuario_nome FROM movimentacoes m
             JOIN processos p ON p.id=m.processo_id LEFT JOIN usuarios u ON u.id=m.usuario_id ORDER BY m.id DESC LIMIT 8')),
    ];
});

// ---------------- administração ----------------
rota('GET', '/config', 'auth', fn() => get_config());
rota('PUT', '/config', 'admin', function ($c) {
    $b = $c['body'];
    if (isset($b['dias_alerta'])) {
        $n = filter_var($b['dias_alerta'], FILTER_VALIDATE_INT);
        if ($n === false || $n < 1 || $n > 60) throw bad('Dias de alerta deve ser entre 1 e 60.');
        set_config('dias_alerta', $n);
    }
    if (isset($b['tipos'])) {
        if (!is_array($b['tipos'])) throw bad('Lista de tipos inválida.');
        $tipos = array_values(array_unique(array_filter(array_map(fn($t) => txt($t, 80), $b['tipos']), fn($t) => $t !== '')));
        if (!$tipos) throw bad('Informe pelo menos um tipo de processo.');
        set_config('tipos', $tipos);
    }
    audit($c['user'], 'config_alterada');
    return get_config();
});
rota('GET', '/auditoria', 'admin', function ($c) {
    $q = '%' . txt($c['query']['q'] ?? '', 80) . '%';
    return all('SELECT * FROM auditoria WHERE (usuario_nome LIKE ? OR acao LIKE ? OR detalhe LIKE ?) ORDER BY id DESC LIMIT 300', [$q, $q, $q]);
});
rota('GET', '/exportar.csv', 'auth', function ($c) {
    $rows = lista_processos($c['query'], $c['user']);
    $cols = [['numero', 'Número'], ['assunto', 'Assunto'], ['tipo', 'Tipo'], ['interessado', 'Interessado'], ['origem', 'Origem'], ['prioridade', 'Prioridade'],
        ['status', 'Situação'], ['data_abertura', 'Abertura'], ['prazo', 'Prazo'], ['dias_restantes', 'Dias restantes'], ['responsavel_nome', 'Responsável']];
    // evita injeção de fórmulas ao abrir no Excel
    $cel = function ($v) { $s = $v === null ? '' : (string)$v; if (preg_match('/^[=+\-@\t\r]/', $s)) $s = "'" . $s; return '"' . str_replace('"', '""', $s) . '"'; };
    $linhas = [implode(';', array_map(fn($c) => $cel($c[1]), $cols))];
    foreach ($rows as $r) $linhas[] = implode(';', array_map(fn($c) => $cel($r[$c[0]] ?? null), $cols));
    audit($c['user'], 'exportacao', count($rows) . ' processos');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="processos-' . hoje() . '.csv"');
    echo "\xEF\xBB\xBF" . implode("\r\n", $linhas);
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
    config(); // lança "não instalado" antes de qualquer outra coisa
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
    $out = ($r[3])(['user' => $user, 'body' => $body, 'p' => $params, 'query' => $_GET]);
    responde(200, $out);
} catch (HttpError $e) {
    $dados = ['erro' => $e->getMessage()];
    if ($e->instalar) $dados['instalar'] = true;
    responde($e->status, $dados);
} catch (Throwable $e) {
    error_log('[processos] ' . $e);
    responde(500, ['erro' => 'Erro interno do servidor.']);
}
