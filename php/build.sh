#!/usr/bin/env bash
# Monta o pacote para hospedagem PHP em dist/php e dist/controle-processos-php.zip
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/php && mkdir -p dist/php/app
cp public/index.html public/style.css public/app.js dist/php/
cp php/api.php php/install.php php/.htaccess php/LEIA-ME.txt dist/php/
cp php/app/lib.php php/app/schema.php php/app/.htaccess php/app/index.html dist/php/app/
rm -f dist/controle-processos-php.zip
(cd dist/php && python3 - <<'PY'
import os, zipfile
with zipfile.ZipFile('../controle-processos-php.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('.'):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, '.'))
PY
)
echo "Pacote gerado: dist/controle-processos-php.zip"
