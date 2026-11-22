#!/usr/bin/env bash
# Deja lista la máquina para correr los recorridos: baja el Chromium sin
# interfaz y, si al sistema le faltan bibliotecas y no hay permisos de
# administrador, las extrae en la caché del usuario.
set -eu
cd "$(dirname "$0")/.."
pnpm exec playwright-core install chromium-headless-shell

EXE=$(node -e "import('./e2e/navegador.mjs').then((m) => console.log(m.exe))")
LIBS=$HOME/.cache/gymflow-e2e/libs
export LD_LIBRARY_PATH=$LIBS/usr/lib/x86_64-linux-gnu
if ldd "$EXE" | grep -q "not found"; then
  echo "Faltan bibliotecas del sistema; se extraen en $LIBS"
  TMP=$(mktemp -d)
  (cd "$TMP" && (apt-get download libnspr4 libnss3 libasound2t64 || apt-get download libnspr4 libnss3 libasound2))
  mkdir -p "$LIBS"
  for f in "$TMP"/*.deb; do dpkg-deb -x "$f" "$LIBS"; done
  rm -rf "$TMP"
fi
if ldd "$EXE" | grep "not found"; then
  echo "Siguen faltando las bibliotecas de arriba: instálalas con el gestor de paquetes."
  exit 1
fi
echo "Listo: $EXE"
