#!/usr/bin/env bash
# Captura de pantalla con el Chromium de los recorridos. Opciones: ver captura.mjs.
# Apunta a las pruebas (panel 4003, portal 4002, API 4001) o a GYMFLOW_E2E_PANEL/PORTAL/API; nunca al uso real.
S=$(cd "$(dirname "$0")" && pwd)
LIBS=${GYMFLOW_E2E_LIBS:-$HOME/.cache/gymflow-e2e/libs/usr/lib/x86_64-linux-gnu}
[ -d "$LIBS" ] && export LD_LIBRARY_PATH=$LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
cd "$S" && exec node captura.mjs "$@"
