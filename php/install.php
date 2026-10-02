<?php
declare(strict_types=1);
require __DIR__ . '/app/schema.php';
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');

function e($v): string { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }

$ja = instalado();
$erros = [];
$ok = false;
$v = ['host' => 'localhost', 'port' => '3306', 'name' => '', 'user' => '', 'nome' => '', 'login' => 'admin', 'email' => ''];

$req = [
    ['PHP 8.0 ou superior (atual: ' . PHP_VERSION . ')', version_compare(PHP_VERSION, '8.0.0', '>=')],
    ['Extensão PDO MySQL', extension_loaded('pdo_mysql')],
    ['Extensão mbstring', extension_loaded('mbstring')],
    ['Extensão JSON', extension_loaded('json')],
    ['Pasta "app" com permissão de escrita', is_writable(__DIR__ . '/app')],
];
$reqOk = !in_array(false, array_column($req, 1), true);

function msg_erro_bd(Throwable $t): string
{
    $m = $t->getMessage();
    if (strpos($m, '1045') !== false) return 'Usuário ou senha do banco de dados incorretos.';
    if (strpos($m, '2002') !== false || strpos($m, 'getaddrinfo') !== false) return 'Não foi possível conectar ao servidor do banco de dados. Confira o campo "Servidor" (normalmente localhost).';
    if (strpos($m, '1044') !== false || strpos($m, '1049') !== false) return 'O banco de dados não existe ou o usuário não tem permissão nele. Confira o nome do banco e se o usuário está vinculado a ele no painel da hospedagem.';
    return 'Erro: ' . $m;
}

if (!$ja && $_SERVER['REQUEST_METHOD'] === 'POST' && $reqOk) {
    foreach ($v as $k => $_) if (isset($_POST[$k])) $v[$k] = trim((string)$_POST[$k]);
    $pass = (string)($_POST['pass'] ?? '');
    $senha = (string)($_POST['senha'] ?? '');
    if ($v['name'] === '' || $v['user'] === '') $erros[] = 'Informe o nome do banco de dados e o usuário do banco.';
    if ($v['nome'] === '') $erros[] = 'Informe o nome do administrador.';
    if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $v['login'])) $erros[] = 'O login deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).';
    if ($v['email'] !== '' && !filter_var($v['email'], FILTER_VALIDATE_EMAIL)) $erros[] = 'E-mail inválido.';
    try { valida_senha($senha); } catch (HttpError $x) { $erros[] = $x->getMessage(); }
    if ($senha !== (string)($_POST['senha2'] ?? '')) $erros[] = 'As senhas do administrador não conferem.';
    if (!$erros) {
        $cfg = ['driver' => 'mysql', 'host' => $v['host'] ?: 'localhost', 'port' => (int)($v['port'] ?: 3306), 'name' => $v['name'], 'user' => $v['user'], 'pass' => $pass];
        try {
            instala($cfg, ['nome' => $v['nome'], 'login' => $v['login'], 'email' => $v['email'], 'senha' => $senha, 'trocar_senha' => 0]);
            $ok = true;
            @unlink(__FILE__); // o instalador se apaga ao terminar
        } catch (PDOException $t) { $erros[] = msg_erro_bd($t); }
        catch (Throwable $t) { $erros[] = $t->getMessage(); }
    }
}
$apagou = $ok && !is_file(__FILE__);
?><!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instalação – Controle de Processos</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#0f1b3d,#1d4ed8);min-height:100vh;padding:24px 14px;color:#17202e}
.box{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:30px;box-shadow:0 20px 50px rgba(0,0,0,.3)}
h1{margin:0 0 4px;font-size:1.4rem}.s{color:#64708a;margin:0 0 22px}h2{font-size:1rem;margin:24px 0 10px;padding-top:16px;border-top:1px solid #e3e8f0}
label{display:block;font-weight:600;font-size:.86rem;margin:12px 0 4px}input{width:100%;border:1px solid #cdd5e3;border-radius:9px;padding:10px 12px;font:inherit}
input:focus{outline:2px solid #93b4ff;border-color:#1d4ed8}.row{display:grid;grid-template-columns:1fr 110px;gap:12px}
.hint{color:#64708a;font-size:.8rem;margin-top:3px}
button,.btn{display:inline-block;background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:12px 22px;font:inherit;font-weight:700;cursor:pointer;margin-top:22px;text-decoration:none}
button:disabled{opacity:.5;cursor:not-allowed}
.err{background:#fee2e2;color:#991b1b;border-radius:9px;padding:10px 14px;margin-bottom:14px}.err ul{margin:0;padding-left:18px}
.ok{background:#dcfce7;color:#166534;border-radius:9px;padding:12px 14px}.warn{background:#fef3c7;color:#92400e;border-radius:9px;padding:12px 14px;margin-top:12px}
.req li{list-style:none;padding:3px 0}.req{padding:0;margin:0}.y::before{content:"✅ "}.n::before{content:"❌ "}
</style></head><body><div class="box">
<h1>Instalação do sistema</h1><p class="s">Controle de Processos – Secretaria Municipal de Educação</p>

<?php if ($ja && !$ok): ?>
  <div class="ok"><b>O sistema já está instalado.</b></div>
  <div class="warn">Por segurança, <b>apague o arquivo <code>install.php</code></b> do servidor.</div>
  <a class="btn" href="./">Ir para o sistema</a>

<?php elseif ($ok): ?>
  <div class="ok"><b>Instalação concluída com sucesso!</b><br>As tabelas foram criadas e o administrador <b><?= e($v['login']) ?></b> está pronto para uso.</div>
  <?php if (!$apagou): ?><div class="warn"><b>Importante:</b> apague agora o arquivo <code>install.php</code> do servidor (o instalador não conseguiu se apagar sozinho).</div>
  <?php else: ?><p class="hint">O instalador foi removido automaticamente do servidor.</p><?php endif; ?>
  <div class="warn" id="rw" style="display:none"><b>Atenção:</b> o endereço <code>/api</code> não respondeu. Verifique se o arquivo <code>.htaccess</code> foi enviado junto (arquivos que começam com ponto ficam ocultos no gerenciador).</div>
  <a class="btn" href="./">Entrar no sistema</a>
  <script>fetch('api/me',{headers:{'X-Requested-With':'fetch'}}).then(r=>r.json()).catch(()=>{document.getElementById('rw').style.display='block'})</script>

<?php else: ?>
  <ul class="req"><?php foreach ($req as [$t, $b]): ?><li class="<?= $b ? 'y' : 'n' ?>"><?= e($t) ?></li><?php endforeach; ?></ul>
  <?php if (!$reqOk): ?><div class="err" style="margin-top:14px">Corrija os itens marcados com ❌ no painel da hospedagem e recarregue esta página.</div><?php endif; ?>
  <?php if ($erros): ?><div class="err" style="margin-top:14px"><ul><?php foreach ($erros as $m): ?><li><?= e($m) ?></li><?php endforeach; ?></ul></div><?php endif; ?>

  <form method="post" autocomplete="off">
    <h2>1. Banco de dados MySQL</h2>
    <p class="hint">Crie o banco e o usuário no painel da hospedagem (Bancos de dados → MySQL) e informe os dados abaixo.</p>
    <div class="row"><div><label>Servidor</label><input name="host" value="<?= e($v['host']) ?>" required></div><div><label>Porta</label><input name="port" value="<?= e($v['port']) ?>" required></div></div>
    <label>Nome do banco de dados</label><input name="name" value="<?= e($v['name']) ?>" required placeholder="ex.: u123456789_processos">
    <label>Usuário do banco</label><input name="user" value="<?= e($v['user']) ?>" required placeholder="ex.: u123456789_admin">
    <label>Senha do banco</label><input name="pass" type="password" autocomplete="new-password">

    <h2>2. Administrador do sistema</h2>
    <label>Nome completo</label><input name="nome" value="<?= e($v['nome']) ?>" required>
    <div class="row" style="grid-template-columns:1fr 1fr"><div><label>Login</label><input name="login" value="<?= e($v['login']) ?>" required></div><div><label>E-mail (opcional)</label><input name="email" type="email" value="<?= e($v['email']) ?>"></div></div>
    <label>Senha</label><input name="senha" type="password" required minlength="8" autocomplete="new-password"><div class="hint">Mínimo de 8 caracteres, com letras e números.</div>
    <label>Repita a senha</label><input name="senha2" type="password" required autocomplete="new-password">
    <button <?= $reqOk ? '' : 'disabled' ?>>Instalar sistema</button>
  </form>
<?php endif; ?>
</div></body></html>
