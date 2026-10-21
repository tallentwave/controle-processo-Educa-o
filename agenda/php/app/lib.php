<?php
declare(strict_types=1);
date_default_timezone_set('America/Sao_Paulo');

const STATUS_EVENTO = ['Agendado', 'Confirmado', 'Realizado', 'Cancelado', 'Adiado'];
const VISIBILIDADES = ['publica', 'participantes', 'privada'];
const RECORRENCIAS = ['nenhuma', 'diaria', 'semanal', 'quinzenal', 'mensal', 'anual'];
const LEMBRETES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];
const PRIORIDADES = ['Baixa', 'Normal', 'Alta', 'Urgente'];
const TIPOS_RECURSO = ['Sala', 'Auditório', 'Veículo', 'Equipamento', 'Outro'];
const CATEGORIAS_PADRAO = [
    ['nome' => 'Reunião', 'cor' => '#1d4ed8'],
    ['nome' => 'Visita a escola', 'cor' => '#16a34a'],
    ['nome' => 'Formação / Capacitação', 'cor' => '#7c3aed'],
    ['nome' => 'Evento / Cerimônia', 'cor' => '#d97706'],
    ['nome' => 'Atendimento / Audiência', 'cor' => '#0891b2'],
    ['nome' => 'Prazo / Entrega', 'cor' => '#dc2626'],
    ['nome' => 'Recesso / Feriado', 'cor' => '#64748b'],
    ['nome' => 'Outros', 'cor' => '#475467'],
];

class HttpError extends Exception
{
    public int $status;
    public bool $instalar = false;
    public array $extra = [];
    public function __construct(int $status, string $msg, array $extra = [])
    {
        parent::__construct($msg);
        $this->status = $status;
        $this->extra = $extra;
    }
}
function bad(string $m): HttpError { return new HttpError(400, $m); }

// ---------- utilitários ----------
function hoje(): string { return date('Y-m-d'); }
function agora_local(): string { return date('Y-m-d H:i:s'); }
function agora(): string { return gmdate('Y-m-d H:i:s'); }
function txt($v, int $max = 500): string
{
    if ($v === null || is_array($v) || is_object($v)) return '';
    return mb_substr(trim((string)$v), 0, $max);
}
function data_ok($v): bool
{
    if (!is_string($v)) return false;
    $d = DateTime::createFromFormat('!Y-m-d', $v);
    return $d !== false && $d->format('Y-m-d') === $v;
}
function hora_ok($v): bool { return is_string($v) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) === 1; }
function soma_dias(string $data, int $n): string { return (new DateTime($data))->modify(($n >= 0 ? '+' : '') . $n . ' days')->format('Y-m-d'); }
function dias_ate(string $de, string $ate): int { return (int)(new DateTime($de))->diff(new DateTime($ate))->format('%r%a'); }
function valida_senha($s): void
{
    if (!is_string($s) || mb_strlen($s) < 8) throw bad('A senha deve ter pelo menos 8 caracteres.');
    if (!preg_match('/[A-Za-z]/', $s) || !preg_match('/\d/', $s)) throw bad('A senha deve conter letras e números.');
}
function cast_ints(array $row, array $campos): array
{
    foreach ($campos as $c) if (array_key_exists($c, $row) && $row[$c] !== null) $row[$c] = (int)$row[$c];
    return $row;
}
function fmt_br(string $dt): string { return substr($dt, 8, 2) . '/' . substr($dt, 5, 2) . '/' . substr($dt, 0, 4); }

// ---------- banco de dados ----------
function config_arquivo(): string { return __DIR__ . '/config.php'; }
function instalado(): bool { return is_file(config_arquivo()); }
function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        if (!instalado()) { $e = new HttpError(503, 'O sistema ainda não foi instalado.'); $e->instalar = true; throw $e; }
        $cfg = require config_arquivo();
    }
    return $cfg;
}
function conecta(array $c): PDO
{
    $opt = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
    if (($c['driver'] ?? 'mysql') === 'sqlite') {
        $pdo = new PDO('sqlite:' . $c['sqlite_file'], null, null, $opt);
        $pdo->exec('PRAGMA foreign_keys = ON');
        return $pdo;
    }
    $opt[PDO::ATTR_EMULATE_PREPARES] = false;
    $pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], (int)($c['port'] ?? 3306), $c['name']), $c['user'], $c['pass'], $opt);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) $pdo = conecta(config());
    return $pdo;
}
function run(string $sql, array $p = []): PDOStatement { $s = db()->prepare($sql); $s->execute($p); return $s; }
function all(string $sql, array $p = []): array { return run($sql, $p)->fetchAll(); }
function one(string $sql, array $p = []): ?array { $r = run($sql, $p)->fetch(); return $r === false ? null : $r; }
function cnt(string $sql, array $p = []): int { $r = one($sql, $p); return (int)array_values($r)[0]; }
function in_marks(array $a): string { return implode(',', array_fill(0, count($a), '?')); }
function lid(): int { return (int)db()->lastInsertId(); }

// ---------- configurações e auditoria ----------
function get_config(): array
{
    $cfg = ['categorias' => CATEGORIAS_PADRAO, 'hora_inicio' => 7, 'hora_fim' => 19, 'lembrete_padrao' => 15];
    foreach (all('SELECT chave, valor FROM ag_config') as $r) $cfg[$r['chave']] = json_decode($r['valor'], true);
    return $cfg;
}
function set_config(string $chave, $valor): void
{
    $json = json_encode($valor, JSON_UNESCAPED_UNICODE);
    if (one('SELECT 1 FROM ag_config WHERE chave=?', [$chave])) run('UPDATE ag_config SET valor=? WHERE chave=?', [$json, $chave]);
    else run('INSERT INTO ag_config(chave,valor) VALUES(?,?)', [$chave, $json]);
}
function audit(?array $user, string $acao, ?string $detalhe = null): void
{
    run('INSERT INTO ag_auditoria(usuario_id,usuario_nome,acao,detalhe,criado_em) VALUES(?,?,?,?,?)',
        [$user['id'] ?? null, $user['nome'] ?? null, $acao, $detalhe !== null ? mb_substr($detalhe, 0, 500) : null, agora()]);
}

// ---------- sessão ----------
function https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function inicia_sessao(): void
{
    session_name('agendasid'); // nome próprio: convive com outros sistemas no mesmo domínio
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => https(), 'httponly' => true, 'samesite' => 'Strict']);
    ini_set('session.gc_maxlifetime', '28800');
    ini_set('session.use_strict_mode', '1');
    session_start();
}
function pv(array $u): string { return substr(hash('sha256', $u['senha_hash']), 0, 24); }
function abre_sessao(array $u): void
{
    session_regenerate_id(true);
    $_SESSION = ['uid' => (int)$u['id'], 'pv' => pv($u), 'exp' => time() + 28800];
}
function usuario_da_sessao(): ?array
{
    if (empty($_SESSION['uid']) || ($_SESSION['exp'] ?? 0) < time()) return null;
    $u = one('SELECT * FROM ag_usuarios WHERE id=? AND ativo=1', [$_SESSION['uid']]);
    if (!$u || !hash_equals(pv($u), (string)($_SESSION['pv'] ?? ''))) return null;
    return cast_ints($u, ['id', 'ativo', 'trocar_senha']);
}
function publico(array $u): array
{
    return ['id' => (int)$u['id'], 'nome' => $u['nome'], 'login' => $u['login'], 'email' => $u['email'], 'cargo' => $u['cargo'], 'perfil' => $u['perfil'], 'trocar_senha' => (bool)$u['trocar_senha']];
}

// ---------- recorrência ----------
/** k-ésima ocorrência (k=0 é a original) mantendo o horário; dia que não existe no mês vira o último dia. */
function nesima(DateTime $ini, string $rec, int $k): DateTime
{
    $d = clone $ini;
    if ($k === 0) return $d;
    switch ($rec) {
        case 'diaria': return $d->modify("+$k days");
        case 'semanal': return $d->modify('+' . (7 * $k) . ' days');
        case 'quinzenal': return $d->modify('+' . (14 * $k) . ' days');
        case 'mensal':
        case 'anual':
            $meses = $rec === 'mensal' ? $k : 12 * $k;
            $y = (int)$ini->format('Y'); $m = (int)$ini->format('n') + $meses; $dia = (int)$ini->format('j');
            $y += intdiv($m - 1, 12); $m = (($m - 1) % 12) + 1;
            $dia = min($dia, (int)(new DateTime(sprintf('%04d-%02d-01', $y, $m)))->format('t'));
            return $d->setDate($y, $m, $dia);
    }
    return $d;
}
/** Ocorrências de $ev que tocam o intervalo de datas [$de, $ate]. Retorna lista de [inicio, fim, ocorrencia]. */
function ocorrencias(array $ev, string $de, string $ate, array $excecoes = []): array
{
    $ini = new DateTime($ev['inicio']);
    $dur = (new DateTime($ev['fim']))->getTimestamp() - $ini->getTimestamp();
    $rec = $ev['recorrencia'];
    $limite = $rec === 'nenhuma' ? null : ($ev['recorre_ate'] ?: $ini->format('Y-m-d'));
    $ini_faixa = "$de 00:00:00";
    $out = [];
    for ($k = 0; $k < 1500; $k++) {
        $cur = nesima($ini, $rec, $k);
        $dia = $cur->format('Y-m-d');
        if ($dia > $ate) break;
        if ($limite !== null && $dia > $limite) break;
        $fim = (clone $cur)->modify("+$dur seconds");
        if ($fim->format('Y-m-d H:i:s') >= $ini_faixa && !isset($excecoes[$dia])) {
            $out[] = ['inicio' => $cur->format('Y-m-d H:i:s'), 'fim' => $fim->format('Y-m-d H:i:s'), 'ocorrencia' => $dia];
        }
        if ($rec === 'nenhuma') break;
    }
    return $out;
}
function excecoes_de(array $ids): array
{
    if (!$ids) return [];
    $map = [];
    foreach (all('SELECT evento_id, data FROM ag_excecoes WHERE evento_id IN (' . in_marks($ids) . ')', array_values($ids)) as $r) $map[(int)$r['evento_id']][$r['data']] = true;
    return $map;
}

// ---------- eventos ----------
const SEL_EVENTO = 'SELECT e.*, c.nome AS criador_nome, r.nome AS recurso_nome, pm.resposta AS minha_resposta,
    (SELECT COUNT(*) FROM ag_participantes px WHERE px.evento_id = e.id) AS participantes_n
    FROM ag_eventos e LEFT JOIN ag_usuarios c ON c.id = e.criado_por LEFT JOIN ag_recursos r ON r.id = e.recurso_id
    LEFT JOIN ag_participantes pm ON pm.evento_id = e.id AND pm.usuario_id = ?';

/** Condição SQL de visibilidade (usa e. e acrescenta 2 parâmetros: id e id). */
function sql_visivel(array $u, array &$p): string
{
    $p[] = $u['id'];
    $adm = $u['perfil'] === 'admin' ? "OR e.visibilidade = 'participantes'" : '';
    $p[] = $u['id'];
    return "(e.visibilidade = 'publica' OR e.criado_por = ? $adm OR (e.visibilidade = 'participantes'
        AND EXISTS (SELECT 1 FROM ag_participantes pv WHERE pv.evento_id = e.id AND pv.usuario_id = ?)))";
}
function pode_ver(array $u, array $e): bool
{
    if ((int)$e['criado_por'] === $u['id'] || $e['visibilidade'] === 'publica') return true;
    if ($e['visibilidade'] === 'privada') return false;
    return $u['perfil'] === 'admin' || (bool)one('SELECT 1 FROM ag_participantes WHERE evento_id=? AND usuario_id=?', [$e['id'], $u['id']]);
}
function pode_editar_evento(array $u, array $e): bool { return $u['perfil'] === 'admin' || (int)$e['criado_por'] === $u['id']; }

function lista_ocorrencias(array $u, string $de, string $ate, array $f = []): array
{
    $p = [$u['id']];
    $w = ['e.inicio <= ?', "((e.recorrencia = 'nenhuma' AND e.fim >= ?) OR (e.recorrencia <> 'nenhuma' AND e.recorre_ate >= ?))"];
    array_push($p, "$ate 23:59:59", "$de 00:00:00", $de);
    $w[] = sql_visivel($u, $p);
    if (!empty($f['categoria'])) { $w[] = 'e.categoria = ?'; $p[] = txt($f['categoria'], 60); }
    if (!empty($f['recurso']) && ctype_digit((string)$f['recurso'])) { $w[] = 'e.recurso_id = ?'; $p[] = (int)$f['recurso']; }
    if (!empty($f['meus'])) {
        $w[] = "(e.criado_por = ? OR EXISTS (SELECT 1 FROM ag_participantes pq WHERE pq.evento_id = e.id AND pq.usuario_id = ? AND pq.resposta <> 'recusado'))";
        array_push($p, $u['id'], $u['id']);
    }
    $rows = all(SEL_EVENTO . ' WHERE ' . implode(' AND ', $w) . ' ORDER BY e.inicio LIMIT 3000', $p);
    $exc = excecoes_de(array_map(fn($r) => (int)$r['id'], array_filter($rows, fn($r) => $r['recorrencia'] !== 'nenhuma')));
    $out = [];
    foreach ($rows as $e) {
        $e = cast_ints($e, ['id', 'recurso_id', 'criado_por', 'dia_inteiro', 'lembrete_min', 'participantes_n']);
        foreach (ocorrencias($e, $de, $ate, $exc[$e['id']] ?? []) as $o) {
            $out[] = [
                'id' => $e['id'], 'ocorrencia' => $o['ocorrencia'], 'inicio' => $o['inicio'], 'fim' => $o['fim'],
                'dia_inteiro' => $e['dia_inteiro'], 'titulo' => $e['titulo'], 'categoria' => $e['categoria'], 'status' => $e['status'],
                'local' => $e['local'], 'recurso_id' => $e['recurso_id'], 'recurso_nome' => $e['recurso_nome'], 'visibilidade' => $e['visibilidade'],
                'recorrencia' => $e['recorrencia'], 'lembrete_min' => $e['lembrete_min'], 'criado_por' => $e['criado_por'], 'criador_nome' => $e['criador_nome'],
                'minha_resposta' => $e['minha_resposta'], 'participantes_n' => $e['participantes_n'],
            ];
        }
    }
    usort($out, fn($a, $b) => [$a['inicio'], $a['titulo']] <=> [$b['inicio'], $b['titulo']]);
    return $out;
}

function valida_evento(array $b, array $cfg): array
{
    $d = [];
    $d['titulo'] = txt($b['titulo'] ?? '', 200);
    if ($d['titulo'] === '') throw bad('Informe o título do compromisso.');
    $d['categoria'] = txt($b['categoria'] ?? '', 60) ?: 'Outros';
    $d['status'] = $b['status'] ?? 'Agendado';
    if (!in_array($d['status'], STATUS_EVENTO, true)) throw bad('Situação inválida.');
    $d['visibilidade'] = $b['visibilidade'] ?? 'publica';
    if (!in_array($d['visibilidade'], VISIBILIDADES, true)) throw bad('Visibilidade inválida.');
    $d['local'] = txt($b['local'] ?? '', 200) ?: null;
    $d['descricao'] = txt($b['descricao'] ?? '', 5000) ?: null;
    $d['convidados_externos'] = txt($b['convidados_externos'] ?? '', 500) ?: null;
    $d['dia_inteiro'] = !empty($b['dia_inteiro']) ? 1 : 0;

    $di = $b['data_inicio'] ?? ''; $df = ($b['data_fim'] ?? '') ?: $di;
    if (!data_ok($di) || !data_ok($df)) throw bad('Informe datas válidas.');
    if ($d['dia_inteiro']) {
        if ($df < $di) throw bad('A data final não pode ser anterior à inicial.');
        $d['inicio'] = "$di 00:00:00"; $d['fim'] = "$df 23:59:59";
    } else {
        $hi = $b['hora_inicio'] ?? ''; $hf = $b['hora_fim'] ?? '';
        if (!hora_ok($hi) || !hora_ok($hf)) throw bad('Informe horários válidos (HH:MM).');
        $d['inicio'] = "$di $hi:00"; $d['fim'] = "$df $hf:00";
        if ($d['fim'] <= $d['inicio']) throw bad('O término deve ser depois do início.');
    }
    $d['recorrencia'] = $b['recorrencia'] ?? 'nenhuma';
    if (!in_array($d['recorrencia'], RECORRENCIAS, true)) throw bad('Recorrência inválida.');
    $d['recorre_ate'] = null;
    if ($d['recorrencia'] !== 'nenhuma') {
        $ate = $b['recorre_ate'] ?? '';
        if (!data_ok($ate)) throw bad('Informe até quando o compromisso se repete.');
        if ($ate < $di) throw bad('O fim da repetição não pode ser anterior ao início.');
        if ($ate > soma_dias($di, 366 * 3)) throw bad('A repetição pode durar no máximo 3 anos.');
        $dur = strtotime($d['fim']) - strtotime($d['inicio']);
        $passo = ['diaria' => 86400, 'semanal' => 604800, 'quinzenal' => 1209600, 'mensal' => 2419200, 'anual' => 31536000][$d['recorrencia']];
        if ($dur >= $passo) throw bad('A duração do compromisso é maior que o intervalo da repetição.');
        $d['recorre_ate'] = $ate;
    }
    $l = $b['lembrete_min'] ?? null;
    $d['lembrete_min'] = ($l === null || $l === '') ? null : (int)$l;
    if ($d['lembrete_min'] !== null && !in_array($d['lembrete_min'], LEMBRETES, true)) throw bad('Lembrete inválido.');
    $d['recurso_id'] = !empty($b['recurso_id']) ? (int)$b['recurso_id'] : null;
    if ($d['recurso_id'] && !one('SELECT 1 FROM ag_recursos WHERE id=? AND ativo=1', [$d['recurso_id']])) throw bad('Recurso inválido ou desativado.');
    $part = [];
    foreach ((array)($b['participantes'] ?? []) as $pid) {
        $pid = (int)$pid;
        if ($pid > 0 && !in_array($pid, $part, true)) $part[] = $pid;
    }
    if ($part) {
        $ok = array_map(fn($r) => (int)$r['id'], all('SELECT id FROM ag_usuarios WHERE ativo=1 AND id IN (' . in_marks($part) . ')', $part));
        if (count($ok) !== count($part)) throw bad('Participante inválido.');
    }
    $d['participantes'] = $d['visibilidade'] === 'privada' ? [] : $part;
    return $d;
}

/** Procura conflitos do evento $d (ainda não salvo) com reservas de recurso e agendas das pessoas. */
function acha_conflitos(array $d, int $criadorId, int $ignorarId, array $usuario): array
{
    if ($d['status'] === 'Cancelado') return ['recurso' => [], 'pessoas' => []];
    $de = substr($d['inicio'], 0, 10);
    $ate = $d['recorre_ate'] ?: substr($d['fim'], 0, 10);
    $meus = ocorrencias($d + ['id' => 0], $de, $ate);
    $pessoas = array_values(array_unique(array_merge([$criadorId], $d['participantes'])));
    $c = ['e.id <> ?', "e.status <> 'Cancelado'", 'e.inicio <= ?', "((e.recorrencia = 'nenhuma' AND e.fim >= ?) OR (e.recorrencia <> 'nenhuma' AND e.recorre_ate >= ?))"];
    $p = [$ignorarId, $ate . ' 23:59:59', $de . ' 00:00:00', $de];
    $alvos = [];
    if ($d['recurso_id']) { $alvos[] = 'e.recurso_id = ?'; $p[] = $d['recurso_id']; }
    $alvos[] = 'e.criado_por IN (' . in_marks($pessoas) . ')'; array_push($p, ...$pessoas);
    $alvos[] = "EXISTS (SELECT 1 FROM ag_participantes pp WHERE pp.evento_id = e.id AND pp.resposta <> 'recusado' AND pp.usuario_id IN (" . in_marks($pessoas) . '))'; array_push($p, ...$pessoas);
    $c[] = '(' . implode(' OR ', $alvos) . ')';
    $cands = all('SELECT e.* FROM ag_eventos e WHERE ' . implode(' AND ', $c) . ' LIMIT 500', $p);
    $exc = excecoes_de(array_map(fn($r) => (int)$r['id'], $cands));
    $nomes = [];
    foreach (all('SELECT id, nome FROM ag_usuarios WHERE id IN (' . in_marks($pessoas) . ')', $pessoas) as $r) $nomes[(int)$r['id']] = $r['nome'];
    $partDe = [];
    if ($cands) foreach (all("SELECT evento_id, usuario_id FROM ag_participantes WHERE resposta <> 'recusado' AND evento_id IN (" . in_marks(array_column($cands, 'id')) . ')', array_map('intval', array_column($cands, 'id'))) as $r) $partDe[(int)$r['evento_id']][] = (int)$r['usuario_id'];
    $res = ['recurso' => [], 'pessoas' => []];
    foreach ($cands as $e) {
        $theirs = ocorrencias($e, $de, $ate, $exc[(int)$e['id']] ?? []);
        $envolvidos = array_values(array_intersect($pessoas, array_merge([(int)$e['criado_por']], $partDe[(int)$e['id']] ?? [])));
        $mesmoRecurso = $d['recurso_id'] && (int)$e['recurso_id'] === $d['recurso_id'];
        $titulo = ($e['visibilidade'] === 'publica' || (int)$e['criado_por'] === $usuario['id']) ? '«' . $e['titulo'] . '»' : 'outro compromisso';
        foreach ($theirs as $o) {
            foreach ($meus as $m) {
                if (!($m['inicio'] < $o['fim'] && $o['inicio'] < $m['fim'])) continue;
                $quando = fmt_br($o['inicio']) . ' ' . ($e['dia_inteiro'] ? '(dia inteiro)' : 'das ' . substr($o['inicio'], 11, 5) . ' às ' . substr($o['fim'], 11, 5));
                if ($mesmoRecurso && count($res['recurso']) < 5) $res['recurso'][] = "O recurso já está reservado em $quando.";
                foreach ($envolvidos as $uid) if (count($res['pessoas']) < 10) $res['pessoas'][] = ($nomes[$uid] ?? 'Participante') . " já tem $titulo em $quando.";
                continue 2;
            }
        }
        if (count($res['recurso']) >= 5 && count($res['pessoas']) >= 10) break;
    }
    $res['recurso'] = array_values(array_unique($res['recurso']));
    $res['pessoas'] = array_values(array_unique($res['pessoas']));
    return $res;
}

// ---------- tarefas ----------
function situacao_tarefa(array $t): string
{
    if ((int)$t['concluida']) return 'concluida';
    if (!$t['prazo']) return 'sem_prazo';
    $d = dias_ate(hoje(), $t['prazo']);
    return $d < 0 ? 'atrasada' : ($d === 0 ? 'hoje' : ($d <= 3 ? 'proxima' : 'no_prazo'));
}
function decora_tarefa(array $t): array
{
    $t = cast_ints($t, ['id', 'concluida', 'responsavel_id', 'criado_por']);
    $t['dias_restantes'] = $t['prazo'] ? dias_ate(hoje(), $t['prazo']) : null;
    $t['situacao'] = situacao_tarefa($t);
    return $t;
}
function pode_tarefa(array $u, array $t): bool
{
    return $u['perfil'] === 'admin' || (int)$t['criado_por'] === $u['id'] || (int)$t['responsavel_id'] === $u['id'];
}

// ---------- iCalendar ----------
function ics_txt(string $s): string { return str_replace(["\\", ';', ',', "\r\n", "\n", "\r"], ["\\\\", '\;', '\,', '\n', '\n', '\n'], $s); }
function ics_dt(string $dt): string { return str_replace(['-', ':', ' '], ['', '', 'T'], $dt); }
function gera_ics(array $ocs, array $detalhes = []): string
{
    $L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sistemas360//Agenda Secretaria de Educacao//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Agenda da Educação'];
    $stamp = gmdate('Ymd\THis\Z');
    foreach ($ocs as $o) {
        $L[] = 'BEGIN:VEVENT';
        $L[] = 'UID:ev' . $o['id'] . '-' . $o['ocorrencia'] . '@agenda';
        $L[] = "DTSTAMP:$stamp";
        if ($o['dia_inteiro']) {
            $L[] = 'DTSTART;VALUE=DATE:' . str_replace('-', '', substr($o['inicio'], 0, 10));
            $L[] = 'DTEND;VALUE=DATE:' . str_replace('-', '', soma_dias(substr($o['fim'], 0, 10), 1));
        } else {
            $L[] = 'DTSTART:' . ics_dt($o['inicio']);
            $L[] = 'DTEND:' . ics_dt($o['fim']);
        }
        $L[] = 'SUMMARY:' . ics_txt($o['titulo']);
        $loc = trim(($o['local'] ?? '') . ($o['recurso_nome'] ? ' (' . $o['recurso_nome'] . ')' : ''));
        if ($loc !== '') $L[] = 'LOCATION:' . ics_txt($loc);
        if (!empty($detalhes[$o['id']])) $L[] = 'DESCRIPTION:' . ics_txt($detalhes[$o['id']]);
        $L[] = 'CATEGORIES:' . ics_txt($o['categoria']);
        $L[] = 'STATUS:' . ($o['status'] === 'Cancelado' ? 'CANCELLED' : ($o['status'] === 'Confirmado' ? 'CONFIRMED' : 'TENTATIVE'));
        if ($o['lembrete_min'] !== null) { $L[] = 'BEGIN:VALARM'; $L[] = 'ACTION:DISPLAY'; $L[] = 'DESCRIPTION:' . ics_txt($o['titulo']); $L[] = 'TRIGGER:-PT' . (int)$o['lembrete_min'] . 'M'; $L[] = 'END:VALARM'; }
        $L[] = 'END:VEVENT';
    }
    $L[] = 'END:VCALENDAR';
    // dobra linhas com mais de 75 caracteres (RFC 5545)
    $out = [];
    foreach ($L as $l) {
        while (strlen($l) > 74) { $cut = 74; while ($cut > 0 && (ord($l[$cut]) & 0xC0) === 0x80) $cut--; $out[] = substr($l, 0, $cut); $l = ' ' . substr($l, $cut); }
        $out[] = $l;
    }
    return implode("\r\n", $out) . "\r\n";
}
