<?php
declare(strict_types=1);
require __DIR__ . '/app/lib.php';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store, private');

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
function filho(array $u, string $tabela, int $id, array $niveis): array
{
    $r = one("SELECT * FROM $tabela WHERE id=?", [$id]);
    if (!$r) throw nao_encontrado();
    $p = carrega_proc($u, (int)$r['procedimento_id'], $niveis);
    return [$r, $p];
}
function junta_url(?string $v): ?string
{
    $v = txt($v, 500);
    if ($v === '') return null;
    if (!preg_match('#^https?://[^\s]+$#i', $v)) throw bad('O link deve começar com http:// ou https://');
    return $v;
}

// ---------------- autenticação ----------------
rota('POST', '/login', 'anon', function ($c) {
    $login = txt($c['body']['login'] ?? '', 80);
    $chave = md5(($_SERVER['REMOTE_ADDR'] ?? '') . '|' . mb_strtolower($login));
    $t = one('SELECT * FROM cg_tentativas WHERE chave=?', [$chave]);
    if ($t && (int)$t['n'] >= 5 && time() < (int)$t['ate']) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    $u = one('SELECT * FROM cg_usuarios WHERE login=?', [$login]);
    $ok = password_verify((string)($c['body']['senha'] ?? ''), $u['senha_hash'] ?? '$2y$10$NwpVplLe55P8XQd1DufhSuiw1TEgidXN43aNgL038vDNlrQw3hjN6');
    if (!$u || !$ok || !(int)$u['ativo']) {
        $n = ($t ? (int)$t['n'] : 0) + 1;
        if ($t) run('UPDATE cg_tentativas SET n=?, ate=? WHERE chave=?', [$n, time() + 300, $chave]);
        else run('INSERT INTO cg_tentativas(chave,n,ate) VALUES(?,?,?)', [$chave, $n, time() + 300]);
        audit(null, 'login_falhou', $login);
        throw new HttpError(401, 'Login ou senha incorretos.');
    }
    run('DELETE FROM cg_tentativas WHERE chave=?', [$chave]);
    abre_sessao($u);
    run('UPDATE cg_usuarios SET ultimo_acesso=? WHERE id=?', [agora(), $u['id']]);
    audit($u, 'login');
    return publico($u);
});
rota('POST', '/logout', 'anon', function () { $_SESSION = []; session_destroy(); return ['ok' => true]; });
rota('GET', '/me', 'auth', fn($c) => publico($c['user']) + ['config' => get_config(), 'hoje' => hoje()]);
rota('POST', '/me/senha', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body'];
    if (!password_verify((string)($b['atual'] ?? ''), $u['senha_hash'])) throw bad('Senha atual incorreta.');
    valida_senha($b['nova'] ?? null);
    if ($b['nova'] === $b['atual']) throw bad('A nova senha deve ser diferente da atual.');
    $hash = password_hash($b['nova'], PASSWORD_DEFAULT);
    run('UPDATE cg_usuarios SET senha_hash=?, trocar_senha=0 WHERE id=?', [$hash, $u['id']]);
    $_SESSION['pv'] = pv(['senha_hash' => $hash]);
    audit($u, 'senha_alterada');
    return ['ok' => true];
});

// ---------------- usuários ----------------
rota('GET', '/usuarios', 'auth', function ($c) {
    $rows = all('SELECT id,nome,login,email,cargo,perfil,ativo,trocar_senha,criado_em,ultimo_acesso FROM cg_usuarios ORDER BY ativo DESC, nome');
    $rows = array_map(fn($r) => cast_ints($r, ['id', 'ativo', 'trocar_senha']), $rows);
    if ($c['user']['perfil'] === 'admin') return $rows;
    return array_values(array_map(fn($r) => ['id' => $r['id'], 'nome' => $r['nome'], 'cargo' => $r['cargo'], 'perfil' => $r['perfil']], array_filter($rows, fn($r) => $r['ativo'])));
});
rota('POST', '/usuarios', 'admin', function ($c) {
    $b = $c['body'];
    $nome = txt($b['nome'] ?? '', 120); $login = txt($b['login'] ?? '', 40);
    if ($nome === '') throw bad('Informe o nome.');
    if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $login)) throw bad('Login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).');
    if (!in_array($b['perfil'] ?? '', PERFIS, true)) throw bad('Perfil inválido.');
    valida_senha($b['senha'] ?? null);
    if (one('SELECT 1 FROM cg_usuarios WHERE LOWER(login)=LOWER(?)', [$login])) throw bad('Já existe um usuário com esse login.');
    run('INSERT INTO cg_usuarios(nome,login,email,cargo,perfil,senha_hash,trocar_senha,ativo,criado_em) VALUES(?,?,?,?,?,?,1,1,?)',
        [$nome, $login, txt($b['email'] ?? '', 120) ?: null, txt($b['cargo'] ?? '', 120) ?: null, $b['perfil'], password_hash($b['senha'], PASSWORD_DEFAULT), agora()]);
    $novo = lid();
    audit($c['user'], 'usuario_criado', "$login ({$b['perfil']})");
    return ['id' => $novo];
});
rota('PUT', '/usuarios/:id', 'admin', function ($c) {
    $id = (int)$c['p']['id']; $b = $c['body']; $user = $c['user'];
    $alvo = one('SELECT * FROM cg_usuarios WHERE id=?', [$id]);
    if (!$alvo) throw nao_encontrado('Usuário');
    $nome = txt($b['nome'] ?? $alvo['nome'], 120);
    $perfil = $b['perfil'] ?? $alvo['perfil'];
    $ativo = array_key_exists('ativo', $b) && $b['ativo'] !== null ? ($b['ativo'] ? 1 : 0) : (int)$alvo['ativo'];
    if ($nome === '') throw bad('Informe o nome.');
    if (!in_array($perfil, PERFIS, true)) throw bad('Perfil inválido.');
    if ($id === $user['id'] && ($perfil !== 'admin' || !$ativo)) throw bad('Você não pode remover seu próprio acesso de administrador.');
    run('UPDATE cg_usuarios SET nome=?,email=?,cargo=?,perfil=?,ativo=? WHERE id=?',
        [$nome, txt($b['email'] ?? $alvo['email'], 120) ?: null, txt($b['cargo'] ?? $alvo['cargo'], 120) ?: null, $perfil, $ativo, $id]);
    audit($user, 'usuario_editado', $alvo['login'] . ($perfil !== $alvo['perfil'] ? " (perfil: $perfil)" : '') . ($ativo !== (int)$alvo['ativo'] ? ($ativo ? ' (reativado)' : ' (desativado)') : ''));
    return ['ok' => true];
});
rota('POST', '/usuarios/:id/senha', 'admin', function ($c) {
    $id = (int)$c['p']['id'];
    $alvo = one('SELECT login FROM cg_usuarios WHERE id=?', [$id]);
    if (!$alvo) throw nao_encontrado('Usuário');
    valida_senha($c['body']['senha'] ?? null);
    run('UPDATE cg_usuarios SET senha_hash=?, trocar_senha=1 WHERE id=?', [password_hash($c['body']['senha'], PASSWORD_DEFAULT), $id]);
    audit($c['user'], 'senha_redefinida', $alvo['login']);
    return ['ok' => true];
});

// ---------------- procedimentos ----------------
rota('GET', '/procedimentos', 'auth', fn($c) => lista_procedimentos($c['query'], $c['user']));
function valida_comissao($membros): array
{
    $out = []; $vistos = []; $pres = 0;
    foreach ((array)$membros as $m) {
        $uid = (int)($m['usuario_id'] ?? 0); $f = $m['funcao'] ?? 'Membro';
        if ($uid <= 0 || isset($vistos[$uid])) throw bad('Comissão com membro inválido ou repetido.');
        if (!in_array($f, FUNCOES, true)) throw bad('Função inválida na comissão.');
        if (!one('SELECT 1 FROM cg_usuarios WHERE id=? AND ativo=1', [$uid])) throw bad('Membro da comissão inválido ou inativo.');
        if ($f === 'Presidente' && ++$pres > 1) throw bad('A comissão só pode ter um(a) presidente.');
        $vistos[$uid] = 1; $out[] = ['usuario_id' => $uid, 'funcao' => $f];
    }
    return $out;
}
function grava_comissao(int $pid, array $membros): string
{
    run('DELETE FROM cg_comissao WHERE procedimento_id=?', [$pid]);
    $nomes = [];
    foreach ($membros as $m) {
        run('INSERT INTO cg_comissao(procedimento_id,usuario_id,funcao) VALUES(?,?,?)', [$pid, $m['usuario_id'], $m['funcao']]);
        $nomes[] = (one('SELECT nome FROM cg_usuarios WHERE id=?', [$m['usuario_id']])['nome'] ?? '?') . ' (' . $m['funcao'] . ')';
    }
    return $nomes ? implode('; ', $nomes) : 'sem membros designados';
}
rota('POST', '/procedimentos', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body']; $cfg = get_config();
    $d = valida_proc($b, $cfg);
    if (!eh_gestor($u)) $d['situacao'] = 'Em análise';
    numero_unico($d['numero']);
    $membros = eh_gestor($u) ? valida_comissao($b['comissao'] ?? []) : [];
    $now = agora();
    run('INSERT INTO cg_procedimentos(numero,tipo,origem,assunto,descricao,data_fato,data_ciencia,data_instauracao,portaria,sigilo,situacao,prazo_conclusao,prescricao_data,prescricao_base,criado_por,criado_em,atualizado_em) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [$d['numero'], $d['tipo'], $d['origem'], $d['assunto'], $d['descricao'], $d['data_fato'], $d['data_ciencia'], $d['data_instauracao'], $d['portaria'], $d['sigilo'], $d['situacao'], $d['prazo_conclusao'], $d['prescricao_data'], $d['prescricao_base'], $u['id'], $now, $now]);
    $id = lid();
    if ($membros) grava_comissao($id, $membros);
    add_andamento($id, $u['id'], 'Registro', 'Procedimento cadastrado no sistema.');
    audit($u, 'procedimento_criado', $d['numero'] . ($d['sigilo'] === 'sigiloso' ? ' (sigiloso)' : ''));
    return ['id' => $id, 'numero' => $d['numero']];
});
rota('GET', '/procedimentos/:id', 'auth', function ($c) {
    $u = $c['user']; $cfg = get_config();
    $p = carrega_proc($u, (int)$c['p']['id']);
    $row = one(SEL_PROC . ' WHERE p.id=?', [$p['id']]);
    $r = decora_proc($row, $cfg);
    $r['nivel'] = $p['_nivel'];
    $r['pode_atuar'] = in_array($p['_nivel'], NIVEIS_ATUAR, true);
    $r['pode_gerir'] = in_array($p['_nivel'], NIVEIS_GERIR, true);
    $r['gestor'] = $p['_nivel'] === 'gestor';
    $r['criador_nome'] = one('SELECT nome FROM cg_usuarios WHERE id=?', [$p['criado_por']])['nome'] ?? null;
    $r['comissao'] = array_map(fn($x) => ['usuario_id' => (int)$x['usuario_id'], 'nome' => $x['nome'], 'cargo' => $x['cargo'], 'funcao' => $x['funcao']],
        all("SELECT c.usuario_id, c.funcao, u.nome, u.cargo FROM cg_comissao c JOIN cg_usuarios u ON u.id=c.usuario_id WHERE c.procedimento_id=? ORDER BY (c.funcao='Presidente') DESC, u.nome", [$p['id']]));
    $r['partes'] = array_map(fn($x) => cast_ints($x, ['id', 'procedimento_id']), all('SELECT * FROM cg_partes WHERE procedimento_id=? ORDER BY papel, nome', [$p['id']]));
    $r['prazos'] = array_map(fn($x) => decora_prazo($x, $cfg), all('SELECT * FROM cg_prazos WHERE procedimento_id=? ORDER BY cumprido ASC, data ASC, hora ASC', [$p['id']]));
    $r['documentos'] = array_map(fn($x) => cast_ints($x, ['id', 'procedimento_id']), all('SELECT * FROM cg_documentos WHERE procedimento_id=? ORDER BY COALESCE(data, criado_em) DESC, id DESC', [$p['id']]));
    $r['andamentos'] = array_map(fn($x) => cast_ints($x, ['id']), all('SELECT a.*, u.nome AS usuario_nome FROM cg_andamentos a LEFT JOIN cg_usuarios u ON u.id=a.usuario_id WHERE a.procedimento_id=? ORDER BY a.id DESC', [$p['id']]));
    // trilha de acesso: cada consulta fica registrada (uma vez a cada 10 minutos por usuário/procedimento)
    $det = 'visualizou ' . $p['numero'] . ($p['sigilo'] === 'sigiloso' ? ' (sigiloso)' : '');
    $ja = one('SELECT 1 FROM cg_auditoria WHERE usuario_id=? AND acao=? AND detalhe=? AND criado_em >= ?', [$u['id'], 'procedimento_visualizado', $det, gmdate('Y-m-d H:i:s', time() - 600)]);
    if (!$ja) audit($u, 'procedimento_visualizado', $det);
    return $r;
});
rota('PUT', '/procedimentos/:id', 'auth', function ($c) {
    $u = $c['user']; $p = carrega_proc($u, (int)$c['p']['id'], NIVEIS_GERIR);
    $d = valida_proc($c['body'] + ['situacao' => $p['situacao']], get_config());
    $d['situacao'] = $p['situacao']; // a situação só muda pelo fluxo próprio, que gera andamento
    if ($d['numero'] !== $p['numero']) numero_unico($d['numero'], (int)$p['id']);
    if ($d['sigilo'] !== $p['sigilo'] && $p['_nivel'] !== 'gestor') throw new HttpError(403, 'Apenas o corregedor ou o administrador pode alterar o nível de sigilo.');
    $mud = [];
    foreach (['numero' => 'Número', 'tipo' => 'Tipo', 'sigilo' => 'Sigilo', 'prazo_conclusao' => 'Prazo de conclusão', 'prescricao_data' => 'Prescrição', 'data_instauracao' => 'Instauração'] as $k => $rot)
        if (($d[$k] ?? null) !== ($p[$k] ?? null)) $mud[] = "$rot: " . ($p[$k] ?: '—') . ' → ' . ($d[$k] ?: '—');
    run('UPDATE cg_procedimentos SET numero=?,tipo=?,origem=?,assunto=?,descricao=?,data_fato=?,data_ciencia=?,data_instauracao=?,portaria=?,sigilo=?,prazo_conclusao=?,prescricao_data=?,prescricao_base=?,atualizado_em=? WHERE id=?',
        [$d['numero'], $d['tipo'], $d['origem'], $d['assunto'], $d['descricao'], $d['data_fato'], $d['data_ciencia'], $d['data_instauracao'], $d['portaria'], $d['sigilo'], $d['prazo_conclusao'], $d['prescricao_data'], $d['prescricao_base'], agora(), $p['id']]);
    if ($mud) add_andamento((int)$p['id'], $u['id'], 'Registro', 'Dados alterados — ' . implode('; ', $mud) . '.');
    audit($u, 'procedimento_editado', $d['numero']);
    return ['ok' => true];
});
rota('DELETE', '/procedimentos/:id', 'admin', function ($c) {
    $p = one('SELECT id, numero FROM cg_procedimentos WHERE id=?', [(int)$c['p']['id']]);
    if (!$p) throw nao_encontrado('Procedimento');
    foreach (['cg_comissao', 'cg_partes', 'cg_andamentos', 'cg_prazos', 'cg_documentos'] as $t) run("DELETE FROM $t WHERE procedimento_id=?", [$p['id']]);
    run('DELETE FROM cg_procedimentos WHERE id=?', [$p['id']]);
    audit($c['user'], 'procedimento_excluido', $p['numero']);
    return ['ok' => true];
});
rota('PUT', '/procedimentos/:id/comissao', 'auth', function ($c) {
    $u = $c['user']; $p = carrega_proc($u, (int)$c['p']['id'], ['gestor']);
    $membros = valida_comissao($c['body']['membros'] ?? []);
    $desc = grava_comissao((int)$p['id'], $membros);
    add_andamento((int)$p['id'], $u['id'], 'Designação', "Comissão/equipe definida: $desc.");
    audit($u, 'comissao_alterada', $p['numero']);
    return ['ok' => true];
});
rota('POST', '/procedimentos/:id/situacao', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body']; $p = carrega_proc($u, (int)$c['p']['id'], NIVEIS_GERIR);
    $nova = $b['situacao'] ?? '';
    if (!in_array($nova, SITUACOES, true)) throw bad('Situação inválida.');
    if ($nova === $p['situacao']) throw bad('O procedimento já está nessa situação.');
    $obs = txt($b['observacao'] ?? '', 3000);
    $fechando = in_array($nova, ENCERRADAS, true); $reabrindo = in_array($p['situacao'], ENCERRADAS, true) && !$fechando;
    if ($reabrindo && $obs === '') throw bad('Informe o motivo da reabertura.');
    if ($nova === 'Arquivado' && $obs === '') throw bad('Informe o motivo do arquivamento.');
    $pen = $dec = $dd = null; $enc = null;
    if ($fechando) {
        $pen = txt($b['penalidade'] ?? '', 80) ?: null; $dec = txt($b['decisao'] ?? '', 8000) ?: null;
        $dd = data_opc($b, 'data_decisao', 'Data da decisão') ?: hoje(); $enc = hoje();
    }
    if ($fechando) run('UPDATE cg_procedimentos SET situacao=?, penalidade=?, decisao=?, data_decisao=?, data_encerramento=?, atualizado_em=? WHERE id=?', [$nova, $pen, $dec, $dd, $enc, agora(), $p['id']]);
    elseif ($reabrindo) run('UPDATE cg_procedimentos SET situacao=?, data_encerramento=NULL, atualizado_em=? WHERE id=?', [$nova, agora(), $p['id']]);
    else run('UPDATE cg_procedimentos SET situacao=?, atualizado_em=? WHERE id=?', [$nova, agora(), $p['id']]);
    add_andamento((int)$p['id'], $u['id'], 'Situação', "Situação alterada: {$p['situacao']} → $nova." . ($fechando && $pen ? " Resultado: $pen." : '') . ($obs !== '' ? " $obs" : ''));
    audit($u, 'procedimento_situacao', "{$p['numero']}: $nova");
    return ['ok' => true];
});
rota('POST', '/procedimentos/:id/prorrogar', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body']; $p = carrega_proc($u, (int)$c['p']['id'], NIVEIS_GERIR);
    if (in_array($p['situacao'], ENCERRADAS, true)) throw bad('O procedimento está encerrado.');
    $novo = $b['novo_prazo'] ?? '';
    if (!data_ok($novo)) throw bad('Informe a nova data limite.');
    if ($novo <= hoje() || ($p['prazo_conclusao'] && $novo <= $p['prazo_conclusao'])) throw bad('A nova data deve ser posterior ao prazo atual e à data de hoje.');
    $motivo = txt($b['motivo'] ?? '', 3000);
    if ($motivo === '') throw bad('Informe a justificativa da prorrogação.');
    run('UPDATE cg_procedimentos SET prazo_conclusao=?, prorrogacoes=prorrogacoes+1, atualizado_em=? WHERE id=?', [$novo, agora(), $p['id']]);
    add_andamento((int)$p['id'], $u['id'], 'Prorrogação', 'Prazo prorrogado de ' . ($p['prazo_conclusao'] ?: 'sem prazo') . " para $novo (" . ($p['prorrogacoes'] + 1) . "ª prorrogação). $motivo");
    audit($u, 'prazo_prorrogado', "{$p['numero']}: $novo");
    return ['ok' => true];
});

// ---------------- andamentos, partes, prazos, documentos ----------------
rota('POST', '/procedimentos/:id/andamentos', 'auth', function ($c) {
    $u = $c['user']; $b = $c['body']; $p = carrega_proc($u, (int)$c['p']['id'], NIVEIS_ATUAR);
    $tipo = $b['tipo'] ?? 'Despacho';
    if (!in_array($tipo, TIPOS_ANDAMENTO, true)) throw bad('Tipo de andamento inválido.');
    $texto = txt($b['texto'] ?? '', 6000);
    if ($texto === '') throw bad('Descreva o ato ou andamento.');
    $data = data_opc($b, 'data', 'Data') ?: hoje();
    if ($data > hoje()) throw bad('A data do andamento não pode ser futura.');
    add_andamento((int)$p['id'], $u['id'], $tipo, $texto, $data);
    run('UPDATE cg_procedimentos SET atualizado_em=? WHERE id=?', [agora(), $p['id']]);
    return ['ok' => true];
});
function valida_parte(array $b): array
{
    $papel = $b['papel'] ?? '';
    if (!in_array($papel, PAPEIS, true)) throw bad('Papel inválido.');
    $nome = txt($b['nome'] ?? '', 150);
    if ($nome === '') throw bad('Informe o nome.');
    return [$papel, $nome, txt($b['documento'] ?? '', 40) ?: null, txt($b['cargo'] ?? '', 120) ?: null, txt($b['contato'] ?? '', 150) ?: null, txt($b['observacao'] ?? '', 500) ?: null];
}
rota('POST', '/procedimentos/:id/partes', 'auth', function ($c) {
    $p = carrega_proc($c['user'], (int)$c['p']['id'], NIVEIS_ATUAR);
    run('INSERT INTO cg_partes(procedimento_id,papel,nome,documento,cargo,contato,observacao) VALUES(?,?,?,?,?,?,?)', array_merge([$p['id']], valida_parte($c['body'])));
    $novo = lid();
    add_andamento((int)$p['id'], $c['user']['id'], 'Registro', "Parte incluída: {$c['body']['nome']} ({$c['body']['papel']}).");
    return ['id' => $novo];
});
rota('PUT', '/partes/:id', 'auth', function ($c) {
    [$r, $p] = filho($c['user'], 'cg_partes', (int)$c['p']['id'], NIVEIS_ATUAR);
    run('UPDATE cg_partes SET papel=?,nome=?,documento=?,cargo=?,contato=?,observacao=? WHERE id=?', array_merge(valida_parte($c['body']), [$r['id']]));
    return ['ok' => true];
});
rota('DELETE', '/partes/:id', 'auth', function ($c) {
    [$r, $p] = filho($c['user'], 'cg_partes', (int)$c['p']['id'], NIVEIS_GERIR);
    run('DELETE FROM cg_partes WHERE id=?', [$r['id']]);
    add_andamento((int)$p['id'], $c['user']['id'], 'Registro', "Parte removida: {$r['nome']} ({$r['papel']}).");
    return ['ok' => true];
});
function valida_prazo(array $b): array
{
    $tipo = $b['tipo'] ?? '';
    if (!in_array($tipo, TIPOS_PRAZO, true)) throw bad('Tipo de prazo inválido.');
    $desc = txt($b['descricao'] ?? '', 200);
    if ($desc === '') throw bad('Descreva o prazo ou a audiência.');
    $data = $b['data'] ?? '';
    if (!data_ok($data)) throw bad('Informe a data.');
    $hora = ($b['hora'] ?? '') ?: null;
    if ($hora !== null && !hora_ok($hora)) throw bad('Horário inválido (HH:MM).');
    return [$tipo, $desc, $data, $hora];
}
rota('GET', '/prazos', 'auth', function ($c) {
    $u = $c['user']; $q = $c['query']; $cfg = get_config(); $par = []; $w = [sql_visivel($u, $par)];
    $st = $q['status'] ?? 'pendentes';
    if ($st === 'pendentes') $w[] = 'd.cumprido = 0'; elseif ($st === 'cumpridos') $w[] = 'd.cumprido = 1';
    if (($q['abertos'] ?? '1') === '1') $w[] = 'p.situacao NOT IN ' . SQL_ENCERRADAS;
    if (data_ok($q['inicio'] ?? '')) { $w[] = 'd.data >= ?'; $par[] = $q['inicio']; }
    if (data_ok($q['fim'] ?? '')) { $w[] = 'd.data <= ?'; $par[] = $q['fim']; }
    $rows = all('SELECT d.*, p.numero, p.assunto, p.sigilo, p.tipo AS proc_tipo FROM cg_prazos d JOIN cg_procedimentos p ON p.id=d.procedimento_id WHERE ' . implode(' AND ', $w)
        . ' ORDER BY d.cumprido ASC, d.data ASC, d.hora ASC LIMIT 500', $par);
    return array_map(fn($r) => decora_prazo($r, $cfg), $rows);
});
rota('POST', '/procedimentos/:id/prazos', 'auth', function ($c) {
    $p = carrega_proc($c['user'], (int)$c['p']['id'], NIVEIS_ATUAR);
    run('INSERT INTO cg_prazos(procedimento_id,tipo,descricao,data,hora,cumprido,criado_por,criado_em) VALUES(?,?,?,?,?,0,?,?)', array_merge([$p['id']], valida_prazo($c['body']), [$c['user']['id'], agora()]));
    $novo = lid();
    audit($c['user'], 'prazo_criado', $p['numero'] . ': ' . $c['body']['descricao']);
    return ['id' => $novo];
});
rota('PUT', '/prazos/:id', 'auth', function ($c) {
    [$r, $p] = filho($c['user'], 'cg_prazos', (int)$c['p']['id'], NIVEIS_ATUAR);
    run('UPDATE cg_prazos SET tipo=?,descricao=?,data=?,hora=? WHERE id=?', array_merge(valida_prazo($c['body']), [$r['id']]));
    return ['ok' => true];
});
rota('POST', '/prazos/:id/cumprir', 'auth', function ($c) {
    [$r, $p] = filho($c['user'], 'cg_prazos', (int)$c['p']['id'], NIVEIS_ATUAR);
    $ok = !empty($c['body']['cumprido']) ? 1 : 0;
    run('UPDATE cg_prazos SET cumprido=?, cumprido_em=? WHERE id=?', [$ok, $ok ? agora() : null, $r['id']]);
    if ($ok) add_andamento((int)$p['id'], $c['user']['id'], 'Registro', "Prazo cumprido: {$r['descricao']} (previsto para {$r['data']}).");
    return ['ok' => true];
});
rota('DELETE', '/prazos/:id', 'auth', function ($c) {
    [$r, $p] = filho($c['user'], 'cg_prazos', (int)$c['p']['id'], NIVEIS_ATUAR);
    run('DELETE FROM cg_prazos WHERE id=?', [$r['id']]);
    return ['ok' => true];
});
function valida_doc(array $b): array
{
    $titulo = txt($b['titulo'] ?? '', 200);
    if ($titulo === '') throw bad('Informe o título do documento.');
    $tipo = txt($b['tipo'] ?? '', 40) ?: null;
    return [$titulo, $tipo, txt($b['numero_doc'] ?? '', 60) ?: null, data_opc($b, 'data', 'Data'), junta_url($b['link'] ?? null), txt($b['observacao'] ?? '', 500) ?: null];
}
rota('POST', '/procedimentos/:id/documentos', 'auth', function ($c) {
    $p = carrega_proc($c['user'], (int)$c['p']['id'], NIVEIS_ATUAR);
    run('INSERT INTO cg_documentos(procedimento_id,titulo,tipo,numero_doc,data,link,observacao,criado_por,criado_em) VALUES(?,?,?,?,?,?,?,?,?)', array_merge([$p['id']], valida_doc($c['body']), [$c['user']['id'], agora()]));
    $novo = lid();
    add_andamento((int)$p['id'], $c['user']['id'], 'Juntada', 'Documento registrado: ' . txt($c['body']['titulo'], 200) . '.');
    return ['id' => $novo];
});
rota('PUT', '/documentos/:id', 'auth', function ($c) {
    [$r, $p] = filho($c['user'], 'cg_documentos', (int)$c['p']['id'], NIVEIS_ATUAR);
    run('UPDATE cg_documentos SET titulo=?,tipo=?,numero_doc=?,data=?,link=?,observacao=? WHERE id=?', array_merge(valida_doc($c['body']), [$r['id']]));
    return ['ok' => true];
});
rota('DELETE', '/documentos/:id', 'auth', function ($c) {
    [$r, $p] = filho($c['user'], 'cg_documentos', (int)$c['p']['id'], NIVEIS_GERIR);
    run('DELETE FROM cg_documentos WHERE id=?', [$r['id']]);
    add_andamento((int)$p['id'], $c['user']['id'], 'Registro', "Documento removido do registro: {$r['titulo']}.");
    return ['ok' => true];
});

// ---------------- painel e alertas ----------------
rota('GET', '/painel', 'auth', function ($c) {
    $u = $c['user']; $cfg = get_config(); $h = hoje(); $dp = (int)$cfg['dias_alerta']; $dpr = (int)$cfg['dias_alerta_prescricao']; $ab = 'p.situacao NOT IN ' . SQL_ENCERRADAS;
    $conta = function (string $extra = '', array $ep = []) use ($u) { $p = []; $v = sql_visivel($u, $p); return cnt("SELECT COUNT(*) FROM cg_procedimentos p WHERE $v" . ($extra ? " AND $extra" : ''), array_merge($p, $ep)); };
    $grupo = function (string $col, bool $soAbertos) use ($u) { $p = []; $v = sql_visivel($u, $p);
        return array_map(fn($r) => ['nome' => $r['nome'], 'total' => (int)$r['total']], all("SELECT COALESCE(p.$col,'—') AS nome, COUNT(*) AS total FROM cg_procedimentos p WHERE $v" . ($soAbertos ? ' AND p.situacao NOT IN ' . SQL_ENCERRADAS : '') . " GROUP BY COALESCE(p.$col,'—') ORDER BY total DESC", $p)); };
    $pp = []; $vv = sql_visivel($u, $pp);
    $prazos = all("SELECT d.*, p.numero, p.assunto, p.sigilo FROM cg_prazos d JOIN cg_procedimentos p ON p.id=d.procedimento_id WHERE $vv AND $ab AND d.cumprido=0 AND d.data <= ? ORDER BY d.data, d.hora LIMIT 8", array_merge($pp, [soma_dias($h, 14)]));
    $pp2 = []; $vv2 = sql_visivel($u, $pp2);
    $presc = all(SEL_PROC . " WHERE $vv2 AND $ab AND p.prescricao_data IS NOT NULL AND p.prescricao_data <= ? ORDER BY p.prescricao_data LIMIT 6", array_merge($pp2, [soma_dias($h, $dpr)]));
    $pp3 = []; $vv3 = sql_visivel($u, $pp3);
    $porMembro = all("SELECT u.nome, COUNT(DISTINCT c.procedimento_id) AS total FROM cg_comissao c JOIN cg_usuarios u ON u.id=c.usuario_id JOIN cg_procedimentos p ON p.id=c.procedimento_id WHERE $vv3 AND $ab GROUP BY u.id, u.nome ORDER BY total DESC LIMIT 8", $pp3);
    $pp4 = []; $vv4 = sql_visivel($u, $pp4);
    $rec = all("SELECT a.criado_em, a.tipo, a.texto, p.id AS procedimento_id, p.numero, p.sigilo, us.nome AS usuario_nome FROM cg_andamentos a JOIN cg_procedimentos p ON p.id=a.procedimento_id LEFT JOIN cg_usuarios us ON us.id=a.usuario_id WHERE $vv4 ORDER BY a.id DESC LIMIT 8", $pp4);
    return [
        'dias_alerta' => $dp, 'dias_alerta_prescricao' => $dpr,
        'em_andamento' => $conta($ab),
        'sigilosos' => $conta("$ab AND p.sigilo = 'sigiloso'"),
        'prazo_vencido' => $conta("$ab AND p.prazo_conclusao IS NOT NULL AND p.prazo_conclusao < ?", [$h]),
        'prazo_proximo' => $conta("$ab AND p.prazo_conclusao >= ? AND p.prazo_conclusao <= ?", [$h, soma_dias($h, $dp)]),
        'prescrito' => $conta("$ab AND p.prescricao_data IS NOT NULL AND p.prescricao_data < ?", [$h]),
        'prescricao_proxima' => $conta("$ab AND p.prescricao_data >= ? AND p.prescricao_data <= ?", [$h, soma_dias($h, $dpr)]),
        'sem_prazo' => $conta("$ab AND p.prazo_conclusao IS NULL"),
        'encerrados_ano' => $conta('p.data_encerramento >= ? AND p.data_encerramento <= ?', [substr($h, 0, 4) . '-01-01', substr($h, 0, 4) . '-12-31']),
        'proximos_prazos' => array_map(fn($r) => decora_prazo($r, $cfg), $prazos),
        'prescricoes' => array_map(fn($r) => decora_proc($r, $cfg), $presc),
        'por_situacao' => $grupo('situacao', false), 'por_tipo' => $grupo('tipo', true),
        'por_membro' => array_map(fn($r) => ['nome' => $r['nome'], 'total' => (int)$r['total']], $porMembro),
        'recentes' => array_map(fn($r) => cast_ints($r, ['procedimento_id']), $rec),
    ];
});
rota('GET', '/alertas', 'auth', function ($c) {
    $u = $c['user']; $cfg = get_config(); $h = hoje(); $ab = 'p.situacao NOT IN ' . SQL_ENCERRADAS;
    $p1 = []; $v1 = sql_visivel($u, $p1);
    $prazos = array_map(fn($r) => decora_prazo($r, $cfg), all("SELECT d.*, p.numero, p.assunto, p.sigilo FROM cg_prazos d JOIN cg_procedimentos p ON p.id=d.procedimento_id WHERE $v1 AND $ab AND d.cumprido=0 AND d.data <= ? ORDER BY d.data, d.hora LIMIT 300", array_merge($p1, [soma_dias($h, (int)$cfg['dias_alerta'])])));
    $p2 = []; $v2 = sql_visivel($u, $p2);
    $procs = array_map(fn($r) => decora_proc($r, $cfg), all(SEL_PROC . " WHERE $v2 AND $ab AND p.prazo_conclusao IS NOT NULL AND p.prazo_conclusao <= ? ORDER BY p.prazo_conclusao LIMIT 300", array_merge($p2, [soma_dias($h, (int)$cfg['dias_alerta'])])));
    $p3 = []; $v3 = sql_visivel($u, $p3);
    $presc = array_map(fn($r) => decora_proc($r, $cfg), all(SEL_PROC . " WHERE $v3 AND $ab AND p.prescricao_data IS NOT NULL AND p.prescricao_data <= ? ORDER BY p.prescricao_data LIMIT 300", array_merge($p3, [soma_dias($h, (int)$cfg['dias_alerta_prescricao'])])));
    return ['dias_alerta' => (int)$cfg['dias_alerta'], 'dias_alerta_prescricao' => (int)$cfg['dias_alerta_prescricao'], 'prazos' => $prazos, 'procedimentos' => $procs, 'prescricoes' => $presc, 'total' => count($prazos) + count($procs) + count($presc)];
});

// ---------------- administração ----------------
rota('GET', '/config', 'auth', fn() => get_config());
rota('PUT', '/config', 'admin', function ($c) {
    $b = $c['body'];
    if (isset($b['tipos'])) {
        $tipos = []; $v = [];
        foreach ((array)$b['tipos'] as $t) {
            $n = txt($t['nome'] ?? '', 80); if ($n === '' || isset($v[mb_strtolower($n)])) continue;
            $d = (int)($t['prazo_dias'] ?? 0); if ($d < 0 || $d > 1000) throw bad("Prazo inválido para «$n».");
            $v[mb_strtolower($n)] = 1; $tipos[] = ['nome' => $n, 'prazo_dias' => $d];
        }
        if (!$tipos) throw bad('Informe pelo menos um tipo de procedimento.');
        set_config('tipos', $tipos);
    }
    foreach (['origens' => 80, 'penalidades' => 80] as $k => $max) if (isset($b[$k])) {
        $l = array_values(array_unique(array_filter(array_map(fn($x) => txt($x, $max), (array)$b[$k]), fn($x) => $x !== '')));
        if (!$l) throw bad("A lista de $k não pode ficar vazia.");
        set_config($k, $l);
    }
    if (isset($b['prescricoes'])) {
        $l = [];
        foreach ((array)$b['prescricoes'] as $x) {
            $n = txt($x['nome'] ?? '', 60); if ($n === '') continue;
            $d = (int)($x['dias'] ?? 0); if ($d < 1 || $d > 20000) throw bad("Prazo prescricional inválido para «$n».");
            $l[] = ['nome' => $n, 'dias' => $d];
        }
        set_config('prescricoes', $l);
    }
    foreach (['dias_alerta' => [1, 60], 'dias_alerta_prescricao' => [1, 730]] as $k => [$mi, $ma]) if (isset($b[$k])) {
        $n = filter_var($b[$k], FILTER_VALIDATE_INT);
        if ($n === false || $n < $mi || $n > $ma) throw bad("Valor inválido para $k (de $mi a $ma).");
        set_config($k, $n);
    }
    audit($c['user'], 'config_alterada');
    return get_config();
});
rota('GET', '/auditoria', 'gestor', function ($c) {
    $q = '%' . txt($c['query']['q'] ?? '', 80) . '%';
    return all('SELECT * FROM cg_auditoria WHERE (usuario_nome LIKE ? OR acao LIKE ? OR detalhe LIKE ?) ORDER BY id DESC LIMIT 500', [$q, $q, $q]);
});
rota('GET', '/exportar.csv', 'auth', function ($c) {
    $rows = lista_procedimentos($c['query'], $c['user']);
    $cols = [['numero', 'Número'], ['tipo', 'Tipo'], ['assunto', 'Assunto'], ['origem', 'Origem'], ['situacao', 'Situação'], ['sigilo', 'Sigilo'], ['presidente_nome', 'Presidente'],
        ['data_instauracao', 'Instauração'], ['prazo_conclusao', 'Prazo de conclusão'], ['dias_prazo', 'Dias p/ prazo'], ['prescricao_data', 'Prescrição'], ['dias_prescricao', 'Dias p/ prescrição']];
    $cel = function ($v) { $s = $v === null ? '' : (string)$v; if (preg_match('/^[=+\-@\t\r]/', $s)) $s = "'" . $s; return '"' . str_replace('"', '""', $s) . '"'; };
    $linhas = [implode(';', array_map(fn($x) => $cel($x[1]), $cols))];
    foreach ($rows as $r) $linhas[] = implode(';', array_map(fn($x) => $cel($r[$x[0]] ?? null), $cols));
    audit($c['user'], 'exportacao', count($rows) . ' procedimentos');
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="procedimentos-' . hoje() . '.csv"');
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
    config();
    inicia_sessao();
    $user = usuario_da_sessao();
    if ($r[2] !== 'anon' && !$user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
    if ($r[2] === 'admin' && $user['perfil'] !== 'admin') throw new HttpError(403, 'Acesso restrito ao administrador.');
    if ($r[2] === 'gestor' && !eh_gestor($user)) throw new HttpError(403, 'Acesso restrito à Corregedoria (corregedor ou administrador).');
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
    error_log('[corregedoria] ' . $e);
    responde(500, ['erro' => 'Erro interno do servidor.']);
}
