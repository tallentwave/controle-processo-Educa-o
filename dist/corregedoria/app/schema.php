<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

/** Tabelas com prefixo cg_ (podem conviver no mesmo banco de outros sistemas). MySQL/MariaDB em produção; SQLite só nos testes. */
function schema_sql(string $driver): array
{
    $my = $driver !== 'sqlite';
    $id = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $fim = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $idx = fn(string $n, string $c) => $my ? ", INDEX $n ($c)" : '';
    return [
        "CREATE TABLE IF NOT EXISTS cg_usuarios (
            id $id, nome VARCHAR(120) NOT NULL, login VARCHAR(40) NOT NULL, email VARCHAR(120) NULL, cargo VARCHAR(120) NULL,
            perfil VARCHAR(12) NOT NULL, senha_hash VARCHAR(255) NOT NULL, trocar_senha TINYINT NOT NULL DEFAULT 1,
            ativo TINYINT NOT NULL DEFAULT 1, criado_em DATETIME NOT NULL, ultimo_acesso DATETIME NULL, UNIQUE (login)
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_procedimentos (
            id $id, numero VARCHAR(60) NOT NULL, tipo VARCHAR(80) NOT NULL, origem VARCHAR(80) NULL, assunto VARCHAR(300) NOT NULL,
            descricao TEXT NULL, data_fato DATE NULL, data_ciencia DATE NULL, data_instauracao DATE NULL, portaria VARCHAR(80) NULL,
            sigilo VARCHAR(10) NOT NULL DEFAULT 'interno', situacao VARCHAR(30) NOT NULL DEFAULT 'Em análise',
            prazo_conclusao DATE NULL, prorrogacoes INT NOT NULL DEFAULT 0, prescricao_data DATE NULL, prescricao_base VARCHAR(120) NULL,
            penalidade VARCHAR(80) NULL, decisao TEXT NULL, data_decisao DATE NULL, data_encerramento DATE NULL,
            criado_por INT NOT NULL, criado_em DATETIME NOT NULL, atualizado_em DATETIME NOT NULL, UNIQUE (numero)"
            . $idx('idx_situacao', 'situacao') . $idx('idx_prazo', 'prazo_conclusao') . ",
            FOREIGN KEY (criado_por) REFERENCES cg_usuarios(id)
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_comissao (
            procedimento_id INT NOT NULL, usuario_id INT NOT NULL, funcao VARCHAR(20) NOT NULL DEFAULT 'Membro',
            PRIMARY KEY (procedimento_id, usuario_id),
            FOREIGN KEY (procedimento_id) REFERENCES cg_procedimentos(id) ON DELETE CASCADE, FOREIGN KEY (usuario_id) REFERENCES cg_usuarios(id)
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_partes (
            id $id, procedimento_id INT NOT NULL, papel VARCHAR(30) NOT NULL, nome VARCHAR(150) NOT NULL, documento VARCHAR(40) NULL,
            cargo VARCHAR(120) NULL, contato VARCHAR(150) NULL, observacao VARCHAR(500) NULL" . $idx('idx_partes_proc', 'procedimento_id') . ",
            FOREIGN KEY (procedimento_id) REFERENCES cg_procedimentos(id) ON DELETE CASCADE
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_andamentos (
            id $id, procedimento_id INT NOT NULL, usuario_id INT NULL, tipo VARCHAR(20) NOT NULL, data DATE NOT NULL, texto TEXT NOT NULL, criado_em DATETIME NOT NULL"
            . $idx('idx_and_proc', 'procedimento_id') . ",
            FOREIGN KEY (procedimento_id) REFERENCES cg_procedimentos(id) ON DELETE CASCADE
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_prazos (
            id $id, procedimento_id INT NOT NULL, tipo VARCHAR(30) NOT NULL, descricao VARCHAR(200) NOT NULL, data DATE NOT NULL, hora VARCHAR(5) NULL,
            cumprido TINYINT NOT NULL DEFAULT 0, cumprido_em DATETIME NULL, criado_por INT NULL, criado_em DATETIME NOT NULL"
            . $idx('idx_prazo_data', 'data') . $idx('idx_prazo_proc', 'procedimento_id') . ",
            FOREIGN KEY (procedimento_id) REFERENCES cg_procedimentos(id) ON DELETE CASCADE
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_documentos (
            id $id, procedimento_id INT NOT NULL, titulo VARCHAR(200) NOT NULL, tipo VARCHAR(40) NULL, numero_doc VARCHAR(60) NULL, data DATE NULL,
            link VARCHAR(500) NULL, observacao VARCHAR(500) NULL, criado_por INT NULL, criado_em DATETIME NOT NULL" . $idx('idx_doc_proc', 'procedimento_id') . ",
            FOREIGN KEY (procedimento_id) REFERENCES cg_procedimentos(id) ON DELETE CASCADE
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_auditoria (
            id $id, usuario_id INT NULL, usuario_nome VARCHAR(120) NULL, acao VARCHAR(60) NOT NULL, detalhe VARCHAR(500) NULL, ip VARCHAR(45) NULL, criado_em DATETIME NOT NULL
        )$fim",
        "CREATE TABLE IF NOT EXISTS cg_config (chave VARCHAR(60) NOT NULL PRIMARY KEY, valor TEXT NOT NULL)$fim",
        "CREATE TABLE IF NOT EXISTS cg_tentativas (chave VARCHAR(64) NOT NULL PRIMARY KEY, n INT NOT NULL, ate INT NOT NULL)$fim",
    ];
}

/** Cria as tabelas, o administrador e grava app/config.php. */
function instala(array $cfg, array $admin): void
{
    $pdo = conecta($cfg);
    foreach (schema_sql($cfg['driver'] ?? 'mysql') as $sql) $pdo->exec($sql);
    $existe = $pdo->query("SELECT COUNT(*) FROM cg_usuarios WHERE perfil='admin'")->fetchColumn();
    if ((int)$existe > 0) throw new RuntimeException('Este banco de dados já contém uma instalação da Corregedoria com administrador. Use outro banco ou remova as tabelas que começam com "cg_".');
    $st = $pdo->prepare("INSERT INTO cg_usuarios(nome,login,email,cargo,perfil,senha_hash,trocar_senha,ativo,criado_em) VALUES(?,?,?,?, 'admin', ?, ?, 1, ?)");
    $st->execute([$admin['nome'], $admin['login'], $admin['email'] ?: null, 'Administrador do sistema',
        password_hash($admin['senha'], PASSWORD_DEFAULT), (int)($admin['trocar_senha'] ?? 0), agora()]);
    $conteudo = "<?php\n// Gerado pelo instalador. Não compartilhe este arquivo.\nreturn " . var_export($cfg, true) . ";\n";
    if (file_put_contents(config_arquivo(), $conteudo, LOCK_EX) === false) throw new RuntimeException('Não foi possível gravar o arquivo app/config.php. Verifique as permissões da pasta app.');
    @chmod(config_arquivo(), 0600);
}
