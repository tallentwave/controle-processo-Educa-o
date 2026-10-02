<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

/** Instruções de criação das tabelas (MySQL/MariaDB em produção; SQLite só para testes). */
function schema_sql(string $driver): array
{
    $my = $driver !== 'sqlite';
    $id = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $fim = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $idx = fn(string $n, string $c) => $my ? ", INDEX $n ($c)" : '';
    return [
        "CREATE TABLE IF NOT EXISTS usuarios (
            id $id, nome VARCHAR(120) NOT NULL, login VARCHAR(40) NOT NULL, email VARCHAR(120) NULL, cargo VARCHAR(120) NULL,
            perfil VARCHAR(10) NOT NULL, senha_hash VARCHAR(255) NOT NULL, trocar_senha TINYINT NOT NULL DEFAULT 1,
            ativo TINYINT NOT NULL DEFAULT 1, criado_em DATETIME NOT NULL, ultimo_acesso DATETIME NULL, UNIQUE (login)
        )$fim",
        "CREATE TABLE IF NOT EXISTS processos (
            id $id, numero VARCHAR(60) NOT NULL, assunto VARCHAR(300) NOT NULL, tipo VARCHAR(200) NULL, interessado VARCHAR(200) NULL,
            origem VARCHAR(200) NULL, descricao TEXT NULL, prioridade VARCHAR(10) NOT NULL DEFAULT 'Normal',
            status VARCHAR(20) NOT NULL DEFAULT 'Aberto', data_abertura DATE NOT NULL, prazo DATE NULL, data_conclusao DATE NULL,
            responsavel_id INT NULL, criado_por INT NULL, criado_em DATETIME NOT NULL, atualizado_em DATETIME NOT NULL,
            UNIQUE (numero)" . $idx('idx_prazo', 'prazo') . $idx('idx_status', 'status') . ",
            FOREIGN KEY (responsavel_id) REFERENCES usuarios(id), FOREIGN KEY (criado_por) REFERENCES usuarios(id)
        )$fim",
        "CREATE TABLE IF NOT EXISTS movimentacoes (
            id $id, processo_id INT NOT NULL, usuario_id INT NULL, tipo VARCHAR(20) NOT NULL, texto TEXT NOT NULL, criado_em DATETIME NOT NULL"
            . $idx('idx_mov_proc', 'processo_id') . ",
            FOREIGN KEY (processo_id) REFERENCES processos(id) ON DELETE CASCADE
        )$fim",
        "CREATE TABLE IF NOT EXISTS auditoria (
            id $id, usuario_id INT NULL, usuario_nome VARCHAR(120) NULL, acao VARCHAR(60) NOT NULL, detalhe VARCHAR(500) NULL, criado_em DATETIME NOT NULL
        )$fim",
        "CREATE TABLE IF NOT EXISTS config (chave VARCHAR(60) NOT NULL PRIMARY KEY, valor TEXT NOT NULL)$fim",
        "CREATE TABLE IF NOT EXISTS tentativas (chave VARCHAR(64) NOT NULL PRIMARY KEY, n INT NOT NULL, ate INT NOT NULL)$fim",
    ];
}

/**
 * Cria as tabelas, o administrador e grava app/config.php.
 * $cfg: driver, host, port, name, user, pass (ou sqlite_file). $admin: nome, login, email, senha, trocar_senha.
 */
function instala(array $cfg, array $admin): void
{
    $pdo = conecta($cfg);
    foreach (schema_sql($cfg['driver'] ?? 'mysql') as $sql) $pdo->exec($sql);
    $existe = $pdo->query("SELECT COUNT(*) FROM usuarios WHERE perfil='admin'")->fetchColumn();
    if ((int)$existe > 0) throw new RuntimeException('Este banco de dados já contém um administrador. Use um banco vazio ou remova as tabelas antigas.');
    $st = $pdo->prepare("INSERT INTO usuarios(nome,login,email,cargo,perfil,senha_hash,trocar_senha,ativo,criado_em) VALUES(?,?,?,?, 'admin', ?, ?, 1, ?)");
    $st->execute([$admin['nome'], $admin['login'], $admin['email'] ?: null, 'Administrador do sistema',
        password_hash($admin['senha'], PASSWORD_DEFAULT), (int)($admin['trocar_senha'] ?? 0), agora()]);
    $conteudo = "<?php\n// Gerado pelo instalador. Não compartilhe este arquivo.\nreturn " . var_export($cfg, true) . ";\n";
    if (file_put_contents(config_arquivo(), $conteudo, LOCK_EX) === false) throw new RuntimeException('Não foi possível gravar o arquivo app/config.php. Verifique as permissões da pasta app.');
    @chmod(config_arquivo(), 0600);
}
