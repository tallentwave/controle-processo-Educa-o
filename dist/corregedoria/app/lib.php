<?php
declare(strict_types=1);
date_default_timezone_set('America/Sao_Paulo');

const SITUACOES = ['Em análise', 'Instaurado', 'Em instrução', 'Aguardando defesa', 'Em relatório', 'Em julgamento', 'Em recurso', 'Suspenso', 'Concluído', 'Arquivado'];
const ENCERRADAS = ['Concluído', 'Arquivado'];
const SQL_ENCERRADAS = "('Concluído','Arquivado')";
const SIGILOS = ['interno', 'sigiloso'];
const PERFIS = ['admin', 'corregedor', 'membro'];
const FUNCOES = ['Presidente', 'Membro', 'Secretário(a)'];
const PAPEIS = ['Investigado(a)', 'Denunciante', 'Testemunha', 'Vítima', 'Defensor(a)', 'Interessado(a)', 'Outro'];
const TIPOS_ANDAMENTO = ['Despacho', 'Portaria', 'Intimação', 'Oitiva', 'Diligência', 'Juntada', 'Defesa', 'Relatório', 'Decisão', 'Recurso', 'Observação'];
const TIPOS_PRAZO = ['Prazo de defesa', 'Oitiva / Audiência', 'Diligência', 'Relatório', 'Recurso', 'Prorrogação', 'Outro'];
const TIPOS_DOC = ['Portaria', 'Denúncia / Representação', 'Ofício', 'Intimação', 'Termo de depoimento', 'Defesa', 'Relatório', 'Decisão', 'Parecer', 'Outro'];
const CONFIG_PADRAO = [
    'tipos' => [
        ['nome' => 'Denúncia / Representação', 'prazo_dias' => 0],
        ['nome' => 'Investigação Preliminar', 'prazo_dias' => 30],
        ['nome' => 'Sindicância Investigativa', 'prazo_dias' => 30],
        ['nome' => 'Sindicância Acusatória', 'prazo_dias' => 30],
        ['nome' => 'Sindicância Patrimonial', 'prazo_dias' => 30],
        ['nome' => 'PAD – Processo Administrativo Disciplinar', 'prazo_dias' => 60],
        ['nome' => 'PAD – Rito Sumário', 'prazo_dias' => 30],
        ['nome' => 'Termo de Ajustamento de Conduta (TAC)', 'prazo_dias' => 0],
        ['nome' => 'Outros', 'prazo_dias' => 0],
    ],
    'origens' => ['Ouvidoria', 'Denúncia anônima', 'Chefia imediata', 'Ofício de órgão externo', 'Ministério Público', 'Tribunal de Contas', 'De ofício (Corregedoria)', 'Outros'],
    'penalidades' => ['Sem penalidade', 'Advertência', 'Suspensão', 'Demissão', 'Destituição de cargo em comissão', 'Cassação de aposentadoria', 'TAC cumprido', 'Outra'],
    'prescricoes' => [['nome' => 'Advertência', 'dias' => 180], ['nome' => 'Suspensão', 'dias' => 730], ['nome' => 'Demissão / cassação', 'dias' => 1825]],
    'dias_alerta' => 10,
    'dias_alerta_prescricao' => 90,
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
function data_opc(array $b, string $k, string $rotulo): ?string
{
    $v = $b[$k] ?? '';
    if ($v === '' || $v === null) return null;
    if (!data_ok($v)) throw bad("$rotulo inválida.");
    return $v;
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
function lid(): int { return (int)db()->lastInsertId(); }

// ---------- configurações e auditoria ----------
function get_config(): array
{
    $cfg = CONFIG_PADRAO;
    foreach (all('SELECT chave, valor FROM cg_config') as $r) $cfg[$r['chave']] = json_decode($r['valor'], true);
    return $cfg;
}
function set_config(string $chave, $valor): void
{
    $json = json_encode($valor, JSON_UNESCAPED_UNICODE);
    if (one('SELECT 1 FROM cg_config WHERE chave=?', [$chave])) run('UPDATE cg_config SET valor=? WHERE chave=?', [$json, $chave]);
    else run('INSERT INTO cg_config(chave,valor) VALUES(?,?)', [$chave, $json]);
}
function audit(?array $user, string $acao, ?string $detalhe = null): void
{
    run('INSERT INTO cg_auditoria(usuario_id,usuario_nome,acao,detalhe,ip,criado_em) VALUES(?,?,?,?,?,?)',
        [$user['id'] ?? null, $user['nome'] ?? null, $acao, $detalhe !== null ? mb_substr($detalhe, 0, 500) : null, mb_substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45) ?: null, agora()]);
}

// ---------- sessão ----------
function https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function inicia_sessao(): void
{
    session_name('corregsid');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => https(), 'httponly' => true, 'samesite' => 'Strict']);
    ini_set('session.gc_maxlifetime', '14400');
    ini_set('session.use_strict_mode', '1');
    session_start();
}
function pv(array $u): string { return substr(hash('sha256', $u['senha_hash']), 0, 24); }
function abre_sessao(array $u): void
{
    session_regenerate_id(true);
    $_SESSION = ['uid' => (int)$u['id'], 'pv' => pv($u), 'exp' => time() + 14400];
}
function usuario_da_sessao(): ?array
{
    if (empty($_SESSION['uid']) || ($_SESSION['exp'] ?? 0) < time()) return null;
    $u = one('SELECT * FROM cg_usuarios WHERE id=? AND ativo=1', [$_SESSION['uid']]);
    if (!$u || !hash_equals(pv($u), (string)($_SESSION['pv'] ?? ''))) return null;
    return cast_ints($u, ['id', 'ativo', 'trocar_senha']);
}
function publico(array $u): array
{
    return ['id' => (int)$u['id'], 'nome' => $u['nome'], 'login' => $u['login'], 'email' => $u['email'], 'cargo' => $u['cargo'], 'perfil' => $u['perfil'], 'trocar_senha' => (bool)$u['trocar_senha']];
}

// ---------- permissões ----------
function eh_gestor(array $u): bool { return in_array($u['perfil'], ['admin', 'corregedor'], true); }
/** Condição SQL: quais procedimentos o usuário pode ver (alias p). Acrescenta parâmetros em $p. */
function sql_visivel(array $u, array &$p): string
{
    if (eh_gestor($u)) return '1=1';
    array_push($p, $u['id'], $u['id']);
    return "(p.sigilo = 'interno' OR p.criado_por = ? OR EXISTS (SELECT 1 FROM cg_comissao cv WHERE cv.procedimento_id = p.id AND cv.usuario_id = ?))";
}
/** gestor | presidente | membro | leitura | null (sem acesso) */
function nivel_acesso(array $u, array $p): ?string
{
    if (eh_gestor($u)) return 'gestor';
    $f = one('SELECT funcao FROM cg_comissao WHERE procedimento_id=? AND usuario_id=?', [$p['id'], $u['id']]);
    if ($f) return $f['funcao'] === 'Presidente' ? 'presidente' : 'membro';
    if ((int)$p['criado_por'] === $u['id']) return 'membro';
    return $p['sigilo'] === 'interno' ? 'leitura' : null;
}
const NIVEIS_GERIR = ['gestor', 'presidente'];
const NIVEIS_ATUAR = ['gestor', 'presidente', 'membro'];
function carrega_proc(array $u, int $id, array $niveis = []): array
{
    $p = one('SELECT * FROM cg_procedimentos WHERE id=?', [$id]);
    $n = $p ? nivel_acesso($u, $p) : null;
    if (!$p || $n === null) throw new HttpError(404, 'Procedimento não encontrado.');
    if ($niveis && !in_array($n, $niveis, true)) throw new HttpError(403, 'Você não tem permissão para esta ação neste procedimento.');
    $p = cast_ints($p, ['id', 'criado_por', 'prorrogacoes']);
    $p['_nivel'] = $n;
    return $p;
}

// ---------- procedimentos ----------
function situacao_prazo(array $p, int $dias): string
{
    if (in_array($p['situacao'], ENCERRADAS, true)) return 'encerrado';
    if (empty($p['prazo_conclusao'])) return 'sem_prazo';
    $d = dias_ate(hoje(), $p['prazo_conclusao']);
    return $d < 0 ? 'vencido' : ($d === 0 ? 'hoje' : ($d <= $dias ? 'proximo' : 'no_prazo'));
}
function situacao_prescricao(array $p, int $dias): string
{
    if (in_array($p['situacao'], ENCERRADAS, true) || empty($p['prescricao_data'])) return 'sem';
    $d = dias_ate(hoje(), $p['prescricao_data']);
    return $d < 0 ? 'prescrito' : ($d <= $dias ? 'critico' : 'ok');
}
function decora_proc(array $p, array $cfg): array
{
    $p = cast_ints($p, ['id', 'criado_por', 'prorrogacoes', 'comissao_n']);
    $h = hoje();
    $p['dias_prazo'] = !empty($p['prazo_conclusao']) ? dias_ate($h, $p['prazo_conclusao']) : null;
    $p['dias_prescricao'] = !empty($p['prescricao_data']) ? dias_ate($h, $p['prescricao_data']) : null;
    $p['sit_prazo'] = situacao_prazo($p, (int)$cfg['dias_alerta']);
    $p['sit_prescricao'] = situacao_prescricao($p, (int)$cfg['dias_alerta_prescricao']);
    $p['encerrado'] = in_array($p['situacao'], ENCERRADAS, true);
    return $p;
}
const SEL_PROC = "SELECT p.*,
    (SELECT u.nome FROM cg_comissao c JOIN cg_usuarios u ON u.id = c.usuario_id WHERE c.procedimento_id = p.id AND c.funcao = 'Presidente' LIMIT 1) AS presidente_nome,
    (SELECT COUNT(*) FROM cg_comissao c2 WHERE c2.procedimento_id = p.id) AS comissao_n,
    (SELECT MIN(d.data) FROM cg_prazos d WHERE d.procedimento_id = p.id AND d.cumprido = 0) AS proximo_prazo
    FROM cg_procedimentos p";

function lista_procedimentos(array $q, array $u): array
{
    $cfg = get_config(); $h = hoje(); $p = []; $w = [sql_visivel($u, $p)];
    if (!empty($q['q'])) {
        $w[] = '(p.numero LIKE ? OR p.assunto LIKE ? OR p.portaria LIKE ? OR EXISTS (SELECT 1 FROM cg_partes pt WHERE pt.procedimento_id = p.id AND pt.nome LIKE ?))';
        $l = '%' . txt($q['q'], 100) . '%'; array_push($p, $l, $l, $l, $l);
    }
    $st = $q['situacao'] ?? '';
    if (in_array($st, SITUACOES, true)) { $w[] = 'p.situacao = ?'; $p[] = $st; }
    elseif ($st === 'abertos') $w[] = 'p.situacao NOT IN ' . SQL_ENCERRADAS;
    elseif ($st === 'encerrados') $w[] = 'p.situacao IN ' . SQL_ENCERRADAS;
    if (!empty($q['tipo'])) { $w[] = 'p.tipo = ?'; $p[] = txt($q['tipo'], 80); }
    if (in_array($q['sigilo'] ?? '', SIGILOS, true)) { $w[] = 'p.sigilo = ?'; $p[] = $q['sigilo']; }
    if (($q['meus'] ?? '') === '1') {
        $w[] = '(p.criado_por = ? OR EXISTS (SELECT 1 FROM cg_comissao cm WHERE cm.procedimento_id = p.id AND cm.usuario_id = ?))';
        array_push($p, $u['id'], $u['id']);
    }
    $aberto = 'p.situacao NOT IN ' . SQL_ENCERRADAS;
    switch ($q['alerta'] ?? '') {
        case 'prazo_vencido': $w[] = "$aberto AND p.prazo_conclusao IS NOT NULL AND p.prazo_conclusao < ?"; $p[] = $h; break;
        case 'prazo_proximo': $w[] = "$aberto AND p.prazo_conclusao >= ? AND p.prazo_conclusao <= ?"; array_push($p, $h, soma_dias($h, (int)$cfg['dias_alerta'])); break;
        case 'prescricao': $w[] = "$aberto AND p.prescricao_data IS NOT NULL AND p.prescricao_data <= ?"; $p[] = soma_dias($h, (int)$cfg['dias_alerta_prescricao']); break;
        case 'sem_prazo': $w[] = "$aberto AND p.prazo_conclusao IS NULL"; break;
    }
    $sql = SEL_PROC . ' WHERE ' . implode(' AND ', $w)
        . ' ORDER BY (p.situacao IN ' . SQL_ENCERRADAS . ') ASC, (p.prazo_conclusao IS NULL) ASC, p.prazo_conclusao ASC, p.id DESC LIMIT 2000';
    return array_map(fn($r) => decora_proc($r, $cfg), all($sql, $p));
}

function valida_proc(array $b, array $cfg): array
{
    $d = [];
    $d['numero'] = txt($b['numero'] ?? '', 60);
    if ($d['numero'] === '') throw bad('Informe o número do procedimento (1Doc).');
    $d['assunto'] = txt($b['assunto'] ?? '', 300);
    if ($d['assunto'] === '') throw bad('Informe o assunto resumido do procedimento.');
    $d['tipo'] = txt($b['tipo'] ?? '', 80);
    if ($d['tipo'] === '') throw bad('Informe o tipo do procedimento.');
    $d['origem'] = txt($b['origem'] ?? '', 80) ?: null;
    $d['descricao'] = txt($b['descricao'] ?? '', 8000) ?: null;
    $d['portaria'] = txt($b['portaria'] ?? '', 80) ?: null;
    $d['data_fato'] = data_opc($b, 'data_fato', 'Data do fato');
    $d['data_ciencia'] = data_opc($b, 'data_ciencia', 'Data de ciência');
    $d['data_instauracao'] = data_opc($b, 'data_instauracao', 'Data de instauração');
    $d['prazo_conclusao'] = data_opc($b, 'prazo_conclusao', 'Prazo de conclusão');
    $d['prescricao_data'] = data_opc($b, 'prescricao_data', 'Data da prescrição');
    $d['prescricao_base'] = txt($b['prescricao_base'] ?? '', 120) ?: null;
    $d['sigilo'] = $b['sigilo'] ?? 'interno';
    if (!in_array($d['sigilo'], SIGILOS, true)) throw bad('Nível de sigilo inválido.');
    $d['situacao'] = $b['situacao'] ?? 'Em análise';
    if (!in_array($d['situacao'], SITUACOES, true)) throw bad('Situação inválida.');
    if ($d['data_instauracao'] && $d['prazo_conclusao'] && $d['prazo_conclusao'] < $d['data_instauracao']) throw bad('O prazo de conclusão não pode ser anterior à instauração.');
    if ($d['data_fato'] && $d['data_ciencia'] && $d['data_ciencia'] < $d['data_fato']) throw bad('A ciência não pode ser anterior à data do fato.');
    return $d;
}
function numero_unico(string $n, int $ignorar = 0): void
{
    if (one('SELECT 1 FROM cg_procedimentos WHERE LOWER(numero)=LOWER(?) AND id<>?', [$n, $ignorar])) throw bad("Já existe um procedimento com o número $n.");
}
function add_andamento(int $pid, ?int $uid, string $tipo, string $texto, ?string $data = null): void
{
    run('INSERT INTO cg_andamentos(procedimento_id,usuario_id,tipo,data,texto,criado_em) VALUES(?,?,?,?,?,?)', [$pid, $uid, $tipo, $data ?: hoje(), $texto, agora()]);
}
function decora_prazo(array $r, array $cfg): array
{
    $r = cast_ints($r, ['id', 'procedimento_id', 'cumprido']);
    $r['dias'] = dias_ate(hoje(), $r['data']);
    $r['situacao'] = $r['cumprido'] ? 'cumprido' : ($r['dias'] < 0 ? 'vencido' : ($r['dias'] === 0 ? 'hoje' : ($r['dias'] <= (int)$cfg['dias_alerta'] ? 'proximo' : 'no_prazo')));
    return $r;
}
