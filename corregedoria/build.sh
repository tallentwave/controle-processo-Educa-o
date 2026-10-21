#!/usr/bin/env bash
# Monta o pacote da Corregedoria em dist/corregedoria e dist/sistema-corregedoria-php.zip
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/corregedoria && mkdir -p dist/corregedoria/app
cat public/style.css corregedoria/public/corregedoria.css > dist/corregedoria/style.css
cp corregedoria/public/index.html corregedoria/public/app.js dist/corregedoria/
cp corregedoria/php/api.php corregedoria/php/install.php corregedoria/php/.htaccess corregedoria/php/LEIA-ME.txt dist/corregedoria/
cp corregedoria/php/app/lib.php corregedoria/php/app/schema.php corregedoria/php/app/.htaccess corregedoria/php/app/index.html dist/corregedoria/app/
rm -f dist/sistema-corregedoria-php.zip
(cd dist/corregedoria && python3 - <<'PY'
import os, zipfile
with zipfile.ZipFile('../sistema-corregedoria-php.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk('.'):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, '.'))
PY
)
echo "Pacote gerado: dist/sistema-corregedoria-php.zip"
