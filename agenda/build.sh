#!/usr/bin/env bash
# Monta o pacote da Agenda em dist/agenda e dist/sistema-agenda-php.zip
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/agenda && mkdir -p dist/agenda/app
cat public/style.css agenda/public/agenda.css > dist/agenda/style.css
cp agenda/public/index.html agenda/public/app.js dist/agenda/
cp agenda/php/api.php agenda/php/install.php agenda/php/.htaccess agenda/php/LEIA-ME.txt dist/agenda/
cp agenda/php/app/lib.php agenda/php/app/schema.php agenda/php/app/.htaccess agenda/php/app/index.html dist/agenda/app/
rm -f dist/sistema-agenda-php.zip
(cd dist/agenda && python3 - <<'PY'
import os, zipfile
with zipfile.ZipFile('../sistema-agenda-php.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('.'):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, '.'))
PY
)
echo "Pacote gerado: dist/sistema-agenda-php.zip"
