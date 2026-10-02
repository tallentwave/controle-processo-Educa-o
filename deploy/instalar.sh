#!/usr/bin/env bash
# Instalação em VPS Ubuntu/Debian. Execute como root:
#   DOMINIO=processos.exemplo.gov.br bash instalar.sh      (com HTTPS automático)
#   bash instalar.sh                                       (sem domínio: acesso por http://IP:3000)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tallentwave/controle-processo-educa-o.git}"
BRANCH="${BRANCH:-claude/stoic-dirac-akvnqw}"
DOMINIO="${DOMINIO:-}"
APP_DIR=/opt/processos/app
DATA_DIR=/var/lib/processos
BACKUP_DIR=/var/backups/processos

[ "$(id -u)" -eq 0 ] || { echo "Execute como root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Instalando pacotes básicos"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg

echo "==> Instalando Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Usuário de serviço e pastas"
id processos >/dev/null 2>&1 || useradd --system --home /opt/processos --shell /usr/sbin/nologin processos
mkdir -p /opt/processos "$DATA_DIR" "$BACKUP_DIR"
chown processos:processos "$DATA_DIR"

echo "==> Baixando o sistema ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout -q "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R root:root "$APP_DIR"

if [ -n "$DOMINIO" ]; then HOST=127.0.0.1; SEGURO=1; else HOST=0.0.0.0; SEGURO=0; fi

echo "==> Criando serviço systemd"
cat > /etc/systemd/system/processos.service <<UNIT
[Unit]
Description=Controle de Processos - Secretaria de Educacao
After=network.target

[Service]
User=processos
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning server.js
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=$HOST
Environment=DATA_DIR=$DATA_DIR
Environment=COOKIE_SECURE=$SEGURO
Environment=TRUST_PROXY=$SEGURO
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now processos
systemctl restart processos

echo "==> Backup diário (03:00) e comando de atualização"
cat > /usr/local/bin/processos-backup <<BK
#!/usr/bin/env bash
set -e
DEST=$BACKUP_DIR/processos-\$(date +%F).db
rm -f "\$DEST"
$(command -v node) --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('$DATA_DIR/processos.db').exec(\"VACUUM INTO '\$DEST'\")" 
find $BACKUP_DIR -name 'processos-*.db' -mtime +30 -delete
BK
chmod +x /usr/local/bin/processos-backup
echo "0 3 * * * root /usr/local/bin/processos-backup" > /etc/cron.d/processos-backup

cat > /usr/local/bin/processos-atualizar <<UP
#!/usr/bin/env bash
set -e
processos-backup
git -C $APP_DIR fetch origin $BRANCH
git -C $APP_DIR reset --hard origin/$BRANCH
systemctl restart processos
echo "Sistema atualizado."
UP
chmod +x /usr/local/bin/processos-atualizar

if [ -n "$DOMINIO" ]; then
  echo "==> Instalando Caddy (HTTPS automático) para $DOMINIO"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
  printf '%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMINIO" > /etc/caddy/Caddyfile
  systemctl enable --now caddy && systemctl reload caddy
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp; [ -n "$DOMINIO" ] && { ufw allow 80/tcp; ufw allow 443/tcp; } || ufw allow 3000/tcp
fi

sleep 2
systemctl is-active --quiet processos && echo "OK: serviço no ar." || { echo "ERRO: veja 'journalctl -u processos -n 50'"; exit 1; }
if [ -n "$DOMINIO" ]; then echo "Acesse: https://$DOMINIO"; else echo "Acesse: http://$(hostname -I | awk '{print $1}'):3000"; fi
echo "Login inicial: admin / admin123 (a troca de senha é obrigatória no primeiro acesso)."
