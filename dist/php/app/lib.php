<?php
declare(strict_types=1);

const STATUS_LISTA = ['Aberto', 'Em andamento', 'Aguardando', 'Concluído', 'Arquivado'];
const ABERTOS = ['Aberto', 'Em andamento', 'Aguardando'];
const SQL_ABERTOS = "('Aberto','Em andamento','Aguardando')";
const PRIORIDADES = ['Baixa', 'Normal', 'Alta', 'Urgente'];
const TIPOS_PADRAO = ['Transporte escolar', 'Merenda escolar', 'Matrícula / Transferência', 'Recursos humanos', 'Infraestrutura / Reforma', 'Material didático', 'Convênio / Contrato', 'Denúncia / Ouvidoria', 'Outros'];

class HttpError extends Exception
{
    public int $status;
    public bool $instalar = false;
    public function __construct(int $status, string $msg)
    {
        parent::__construct($msg);
        $this->status = $status;
    }
}
function bad(string $m): HttpError { return new HttpError(400, $m); }

// ---------- utilitários ----------
function hoje(): string { return (new DateTime('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d'); }
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

// ---------- configurações e auditoria ----------
function get_config(): array
{
    $cfg = ['dias_alerta' => 5, 'tipos' => TIPOS_PADRAO];
    foreach (all('SELECT chave, valor FROM config') as $r) $cfg[$r['chave']] = json_decode($r['valor'], true);
    return $cfg;
}
function set_config(string $chave, $valor): void
{
    $json = json_encode($valor, JSON_UNESCAPED_UNICODE);
    if (one('SELECT 1 FROM config WHERE chave=?', [$chave])) run('UPDATE config SET valor=? WHERE chave=?', [$json, $chave]);
    else run('INSERT INTO config(chave,valor) VALUES(?,?)', [$chave, $json]);
}
function audit(?array $user, string $acao, ?string $detalhe = null): void
{
    run('INSERT INTO auditoria(usuario_id,usuario_nome,acao,detalhe,criado_em) VALUES(?,?,?,?,?)',
        [$user['id'] ?? null, $user['nome'] ?? null, $acao, $detalhe, agora()]);
}

// ---------- sessão ----------
function https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function inicia_sessao(): void
{
    session_name('procsid');
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
    $u = one('SELECT * FROM usuarios WHERE id=? AND ativo=1', [$_SESSION['uid']]);
    // a senha mudou (troca/redefinição) ou o usuário foi desativado: a sessão deixa de valer
    if (!$u || !hash_equals(pv($u), (string)($_SESSION['pv'] ?? ''))) return null;
    return cast_ints($u, ['id', 'ativo', 'trocar_senha']);
}
function publico(array $u): array
{
    return ['id' => (int)$u['id'], 'nome' => $u['nome'], 'login' => $u['login'], 'email' => $u['email'], 'cargo' => $u['cargo'], 'perfil' => $u['perfil'], 'trocar_senha' => (bool)$u['trocar_senha']];
}

// ---------- processos ----------
function situacao(array $p, int $diasAlerta): string
{
    if (!in_array($p['status'], ABERTOS, true)) return 'encerrado';
    if ($p['dias_restantes'] === null) return 'sem_prazo';
    if ($p['dias_restantes'] < 0) return 'vencido';
    if ($p['dias_restantes'] === 0) return 'hoje';
    if ($p['dias_restantes'] <= $diasAlerta) return 'proximo';
    return 'no_prazo';
}
function decora(array $rows, array $cfg): array
{
    $h = hoje();
    return array_map(function ($p) use ($cfg, $h) {
        $p = cast_ints($p, ['id', 'responsavel_id', 'criado_por']);
        $p['dias_restantes'] = $p['prazo'] ? dias_ate($h, $p['prazo']) : null;
        $p['situacao'] = situacao($p, (int)$cfg['dias_alerta']);
        return $p;
    }, $rows);
}
const BASE_SELECT = 'SELECT p.*, r.nome AS responsavel_nome FROM processos p LEFT JOIN usuarios r ON r.id = p.responsavel_id';

function lista_processos(array $q, array $user): array
{
    $cfg = get_config(); $h = hoje();
    $w = []; $p = [];
    if (!empty($q['q'])) {
        $w[] = '(p.numero LIKE ? OR p.assunto LIKE ? OR p.interessado LIKE ? OR p.origem LIKE ?)';
        $like = '%' . txt($q['q'], 100) . '%';
        array_push($p, $like, $like, $like, $like);
    }
    $st = $q['status'] ?? '';
    if (in_array($st, STATUS_LISTA, true)) { $w[] = 'p.status=?'; $p[] = $st; }
    elseif ($st === 'abertos') $w[] = 'p.status IN ' . SQL_ABERTOS;
    if (!empty($q['tipo'])) { $w[] = 'p.tipo=?'; $p[] = txt($q['tipo'], 200); }
    if (in_array($q['prioridade'] ?? '', PRIORIDADES, true)) { $w[] = 'p.prioridade=?'; $p[] = $q['prioridade']; }
    $resp = $q['responsavel'] ?? '';
    if ($resp === 'meus') { $w[] = 'p.responsavel_id=?'; $p[] = $user['id']; }
    elseif ($resp !== '' && ctype_digit((string)$resp)) { $w[] = 'p.responsavel_id=?'; $p[] = (int)$resp; }
    $aberto = 'p.status IN ' . SQL_ABERTOS . ' AND p.prazo IS NOT NULL';
    switch ($q['prazo'] ?? '') {
        case 'vencidos': $w[] = "$aberto AND p.prazo < ?"; $p[] = $h; break;
        case 'hoje': $w[] = "$aberto AND p.prazo = ?"; $p[] = $h; break;
        case 'alerta': $w[] = "$aberto AND p.prazo >= ? AND p.prazo <= ?"; array_push($p, $h, soma_dias($h, (int)$cfg['dias_alerta'])); break;
        case 'sem': $w[] = 'p.status IN ' . SQL_ABERTOS . ' AND p.prazo IS NULL'; break;
    }
    $sql = BASE_SELECT . ($w ? ' WHERE ' . implode(' AND ', $w) : '')
        . ' ORDER BY (p.status IN ' . SQL_ABERTOS . ') DESC, (p.prazo IS NULL) ASC, p.prazo ASC, p.id DESC LIMIT 2000';
    return decora(all($sql, $p), $cfg);
}
function pode_editar(array $u, array $p): bool
{
    return $u['perfil'] === 'admin' || (int)$p['responsavel_id'] === $u['id'] || (int)$p['criado_por'] === $u['id'];
}
function add_mov(int $pid, ?int $uid, string $tipo, string $texto): void
{
    run('INSERT INTO movimentacoes(processo_id,usuario_id,tipo,texto,criado_em) VALUES(?,?,?,?,?)', [$pid, $uid, $tipo, $texto, agora()]);
}
function numero_unico(string $numero, int $ignorarId = 0): void
{
    if (one('SELECT 1 FROM processos WHERE LOWER(numero)=LOWER(?) AND id<>?', [$numero, $ignorarId]))
        throw bad("Já existe um processo cadastrado com o número $numero.");
}
function valida_processo(array $b, bool $parcial = false): array
{
    $d = [];
    $tem = fn($k) => array_key_exists($k, $b);
    if (!$parcial || $tem('numero')) { $d['numero'] = txt($b['numero'] ?? '', 60); if ($d['numero'] === '') throw bad('Informe o número do processo (1Doc).'); }
    if (!$parcial || $tem('assunto')) { $d['assunto'] = txt($b['assunto'] ?? '', 300); if ($d['assunto'] === '') throw bad('Informe o assunto do processo.'); }
    foreach (['tipo', 'interessado', 'origem'] as $k) if (!$parcial || $tem($k)) $d[$k] = txt($b[$k] ?? '', 200) ?: null;
    if (!$parcial || $tem('descricao')) $d['descricao'] = txt($b['descricao'] ?? '', 5000) ?: null;
    if (!$parcial || $tem('prioridade')) {
        $d['prioridade'] = $b['prioridade'] ?? '' ?: 'Normal';
        if (!in_array($d['prioridade'], PRIORIDADES, true)) throw bad('Prioridade inválida.');
    }
    if (!$parcial || $tem('data_abertura')) {
        $d['data_abertura'] = ($b['data_abertura'] ?? '') ?: hoje();
        if (!data_ok($d['data_abertura'])) throw bad('Data de abertura inválida.');
    }
    if (!$parcial || $tem('prazo')) {
        $d['prazo'] = ($b['prazo'] ?? '') ?: null;
        if ($d['prazo'] !== null && !data_ok($d['prazo'])) throw bad('Prazo inválido.');
    }
    if ($tem('responsavel_id')) {
        $d['responsavel_id'] = !empty($b['responsavel_id']) ? (int)$b['responsavel_id'] : null;
        if ($d['responsavel_id'] && !one('SELECT 1 FROM usuarios WHERE id=? AND ativo=1', [$d['responsavel_id']])) throw bad('Responsável inválido.');
    }
    return $d;
}
