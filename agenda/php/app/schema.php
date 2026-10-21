<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

/** Tabelas com prefixo ag_ (podem conviver no mesmo banco de outros sistemas). MySQL/MariaDB em produção; SQLite só nos testes. */
function schema_sql(string $driver): array
{
    $my = $driver !== 'sqlite';
    $id = $my ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $fim = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $idx = fn(string $n, string $c) => $my ? ", INDEX $n ($c)" : '';
    return [
        "CREATE TABLE IF NOT EXISTS ag_usuarios (
            id $id, nome VARCHAR(120) NOT NULL, login VARCHAR(40) NOT NULL, email VARCHAR(120) NULL, cargo VARCHAR(120) NULL,
            perfil VARCHAR(10) NOT NULL, senha_hash VARCHAR(255) NOT NULL, trocar_senha TINYINT NOT NULL DEFAULT 1,
            ativo TINYINT NOT NULL DEFAULT 1, criado_em DATETIME NOT NULL, ultimo_acesso DATETIME NULL, UNIQUE (login)
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_recursos (
            id $id, nome VARCHAR(120) NOT NULL, tipo VARCHAR(20) NOT NULL DEFAULT 'Sala', ativo TINYINT NOT NULL DEFAULT 1
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_eventos (
            id $id, titulo VARCHAR(200) NOT NULL, descricao TEXT NULL, categoria VARCHAR(60) NOT NULL, local VARCHAR(200) NULL,
            recurso_id INT NULL, inicio DATETIME NOT NULL, fim DATETIME NOT NULL, dia_inteiro TINYINT NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'Agendado', visibilidade VARCHAR(15) NOT NULL DEFAULT 'publica',
            recorrencia VARCHAR(10) NOT NULL DEFAULT 'nenhuma', recorre_ate DATE NULL, lembrete_min INT NULL,
            convidados_externos VARCHAR(500) NULL, criado_por INT NOT NULL, criado_em DATETIME NOT NULL, atualizado_em DATETIME NOT NULL"
            . $idx('idx_inicio', 'inicio') . $idx('idx_recurso', 'recurso_id') . ",
            FOREIGN KEY (recurso_id) REFERENCES ag_recursos(id), FOREIGN KEY (criado_por) REFERENCES ag_usuarios(id)
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_participantes (
            evento_id INT NOT NULL, usuario_id INT NOT NULL, resposta VARCHAR(10) NOT NULL DEFAULT 'pendente',
            PRIMARY KEY (evento_id, usuario_id),
            FOREIGN KEY (evento_id) REFERENCES ag_eventos(id) ON DELETE CASCADE, FOREIGN KEY (usuario_id) REFERENCES ag_usuarios(id)
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_excecoes (
            evento_id INT NOT NULL, data DATE NOT NULL, PRIMARY KEY (evento_id, data),
            FOREIGN KEY (evento_id) REFERENCES ag_eventos(id) ON DELETE CASCADE
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_tarefas (
            id $id, titulo VARCHAR(200) NOT NULL, descricao TEXT NULL, prazo DATE NULL, prioridade VARCHAR(10) NOT NULL DEFAULT 'Normal',
            concluida TINYINT NOT NULL DEFAULT 0, concluida_em DATETIME NULL, responsavel_id INT NULL, criado_por INT NOT NULL,
            criado_em DATETIME NOT NULL, atualizado_em DATETIME NOT NULL" . $idx('idx_prazo', 'prazo') . ",
            FOREIGN KEY (responsavel_id) REFERENCES ag_usuarios(id), FOREIGN KEY (criado_por) REFERENCES ag_usuarios(id)
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_contatos (
            id $id, nome VARCHAR(150) NOT NULL, cargo VARCHAR(120) NULL, orgao VARCHAR(150) NULL, telefone VARCHAR(40) NULL,
            celular VARCHAR(40) NULL, email VARCHAR(120) NULL, observacoes VARCHAR(1000) NULL, criado_por INT NOT NULL, criado_em DATETIME NOT NULL
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_auditoria (
            id $id, usuario_id INT NULL, usuario_nome VARCHAR(120) NULL, acao VARCHAR(60) NOT NULL, detalhe VARCHAR(500) NULL, criado_em DATETIME NOT NULL
        )$fim",
        "CREATE TABLE IF NOT EXISTS ag_config (chave VARCHAR(60) NOT NULL PRIMARY KEY, valor TEXT NOT NULL)$fim",
        "CREATE TABLE IF NOT EXISTS ag_tentativas (chave VARCHAR(64) NOT NULL PRIMARY KEY, n INT NOT NULL, ate INT NOT NULL)$fim",
    ];
}

/** Cria as tabelas, o administrador e grava app/config.php. */
function instala(array $cfg, array $admin): void
{
    $pdo = conecta($cfg);
    foreach (schema_sql($cfg['driver'] ?? 'mysql') as $sql) $pdo->exec($sql);
    $existe = $pdo->query("SELECT COUNT(*) FROM ag_usuarios WHERE perfil='admin'")->fetchColumn();
    if ((int)$existe > 0) throw new RuntimeException('Este banco de dados já contém uma instalação da Agenda com administrador. Use outro banco ou remova as tabelas que começam com "ag_".');
    $st = $pdo->prepare("INSERT INTO ag_usuarios(nome,login,email,cargo,perfil,senha_hash,trocar_senha,ativo,criado_em) VALUES(?,?,?,?, 'admin', ?, ?, 1, ?)");
    $st->execute([$admin['nome'], $admin['login'], $admin['email'] ?: null, 'Administrador do sistema',
        password_hash($admin['senha'], PASSWORD_DEFAULT), (int)($admin['trocar_senha'] ?? 0), agora()]);
    foreach ([['Auditório', 'Auditório'], ['Sala de reuniões', 'Sala'], ['Veículo oficial', 'Veículo']] as [$n, $t])
        $pdo->prepare('INSERT INTO ag_recursos(nome,tipo,ativo) VALUES(?,?,1)')->execute([$n, $t]);
    $conteudo = "<?php\n// Gerado pelo instalador. Não compartilhe este arquivo.\nreturn " . var_export($cfg, true) . ";\n";
    if (file_put_contents(config_arquivo(), $conteudo, LOCK_EX) === false) throw new RuntimeException('Não foi possível gravar o arquivo app/config.php. Verifique as permissões da pasta app.');
    @chmod(config_arquivo(), 0600);
}
