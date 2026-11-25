#!/usr/bin/env bash
# Regresión del navegador contra el perfil de PRUEBAS (gymflow_pruebas).
#   bash e2e/regresion.sh                               todos, tras regenerar la base de pruebas
#   FLOWS="control remota" bash e2e/regresion.sh        solo esos (también la regenera)
#   SIN_REGENERAR=1 bash e2e/regresion.sh               todos, sobre las pruebas que ya corren
#   SIN_REGENERAR=1 FLOWS="dinero adeudo" bash e2e/regresion.sh
#   node e2e/adeudo.mjs                                 uno solo, a mano (exporta LD_LIBRARY_PATH
#                                                       como abajo si el sistema no trae las bibliotecas)
# Corre contra el perfil de PRUEBAS (API 4001, portal 4002, panel 4003): el uso
# real (3001-3003, gymflow_local) ni se apaga ni se toca (auditoría 8, fase 0.1).
#
# Desde la fase 1.17a cada recorrido prepara lo suyo (socios, clases, cuentas y
# sucursales con el sufijo de la corrida, por la API: e2e/lib/datos.mjs) y deja
# como estaba lo que comparte con los demás (el mes que cierra, el horario de
# clases, la pausa de firmas, los módulos, los turnos de caja). Por eso ya no
# hace falta regenerar la base para repetir uno, ni importa el orden: el de
# abajo solo agrupa por tema. La base de arranque y cómo se espera cada cosa
# están en e2e/lib/ y en gymflow-docs/.../fase1/1.17a-recorridos.md.
#
# Fase 2 (bloque 2.14): los nueve recorridos de las pantallas nuevas van al
# final de la lista (fase2/2.14-recorridos.md). `mensajes` es el último a
# propósito: corre el job `outbound.generate`, que arma mensajes para todo el
# gimnasio de pruebas y deja la campana del panel con cuenta.
#
# Fase 3 (bloque 3.13): los recorridos de lo que construyó la fase 3 van
# antes de `mensajes` (fase3/3.13-recorridos.md): dinero-socio, cajon,
# entrada-reglas, precios, direccion-cierre, altas-familia, coach-codigo,
# apoderado y cuenta-gymflow. `cajon` y
# `direccion-cierre` abren su propio turno en «Caja 2 Centro» y lo cortan;
# `entrada-reglas` enciende la regla del rostro y la apaga; `direccion-cierre`
# cierra el mes pasado y lo vuelve a abrir.
#
# Fase 4 (bloque 4.12): los recorridos de la fase 4 van también antes de
# `mensajes` (fase4/4.12-recorridos.md): cortes, plazos, nomina,
# datos-y-marca, interesados, portal-contacto, avisos-duena,
# sesion-telefono, plataforma-cobro, portal-precios-rostro y deudores.
# `cortes` y `avisos-duena` abren su turno en «Caja 2 Centro» y lo cortan;
# `plazos` deja los plazos de fábrica; `datos-y-marca` devuelve el horario de
# Norte; `avisos-duena` corre el corredor de 15 minutos de pruebas
# (`pnpm jobs:pruebas:15min`) y vuelve a encender el aviso que apagó.
set -u
S=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$S/shots" "$S/archivos"
# Ninguna espera a ciegas (27-11): un recorrido espera a que pase algo, con un
# tope de lib/entorno.mjs. La regla se revisa antes de correr nada.
if grep -n "waitForTimeout" "$S"/*.mjs "$S"/lib/*.mjs; then
  echo "Hay esperas a ciegas (waitForTimeout) en los recorridos de arriba: espera la respuesta o la condición (lib/esperas.mjs)."
  exit 1
fi
# A dónde van los recorridos (los .mjs leen lo mismo en destino.mjs).
export GYMFLOW_E2E_PANEL=${GYMFLOW_E2E_PANEL:-http://localhost:4003}
export GYMFLOW_E2E_PORTAL=${GYMFLOW_E2E_PORTAL:-http://localhost:4002}
export GYMFLOW_E2E_API=${GYMFLOW_E2E_API:-http://127.0.0.1:4001}
# Todos los recorridos entran desde la misma IP y con las mismas cuentas en
# pocos minutos: con los topes reales (30 intentos por persona y 100 por red
# cada 5 minutos) los últimos se quedarían fuera. La API de pruebas hereda
# estos valores al arrancar; el uso real conserva los suyos.
export AUTH_ATTEMPTS_PER_IP=${AUTH_ATTEMPTS_PER_IP:-500}
export AUTH_ATTEMPTS_PER_NETWORK=${AUTH_ATTEMPTS_PER_NETWORK:-5000}
# Lo mismo con la activación del portal (10 por IP cada 5 minutos): una docena
# de recorridos, y las capturas de quien revisa pantallas (captura.sh
# --portal-socio), activan teléfonos desde 127.0.0.1; con el tope real el
# siguiente recibe 429. env.ts lo deja configurable justo para esto.
export PORTAL_ENROLL_ATTEMPTS=${PORTAL_ENROLL_ATTEMPTS:-500}
es_pruebas() { curl -s --max-time 10 "$GYMFLOW_E2E_API/health" | grep -q '"perfil":"pruebas"'; }
if [ -n "${SIN_REGENERAR:-}" ] && es_pruebas; then
  echo "Sin regenerar: se usan las pruebas que ya corren ($GYMFLOW_E2E_PANEL)."
else
  bash ~/gymflow-docs/scripts/gymflow.sh pruebas > $S/reset.log 2>&1 || { echo "reset falló"; tail -20 $S/reset.log; exit 1; }
fi
# Nunca contra otra API que la de pruebas: los recorridos crean socios y cobros.
es_pruebas || { echo "La API de $GYMFLOW_E2E_API no es la de pruebas; no se corre nada."; exit 1; }
# Calentar: Next en desarrollo compila cada ruta la primera vez que se pide,
# y mientras compila detiene también el proxy hacia la API. Sin esto, el
# primer flujo que toca una pantalla nueva falla por tiempo, no por un error.
for r in /login /panel /caja /punto-de-venta /socios /socios/00000000-0000-7000-8000-000000000000 /altas /prospectos /clases /rutinas /tablero /retencion /planes /productos /personal /sucursales /modulos /seguridad /plataforma /plataforma/precios /plataforma/planes /plataforma/seguridad /plataforma/00000000-0000-7000-8000-000000000000 /plataforma/factura/00000000-0000-7000-8000-000000000000 /arranque /autorizaciones /bitacora /movimientos /personal/roles /biometria /acceso /consentimientos /importar /recibo/00000000-0000-7000-8000-000000000000 /precios /gimnasio /mensajes /recibo/estado/00000000-0000-7000-8000-000000000000 /recibo/venta/00000000-0000-7000-8000-000000000000 /cuenta-gymflow /avisos /tablero/deudores /plataforma/cobranza; do
  curl -s -o /dev/null --max-time 120 "$GYMFLOW_E2E_PANEL$r"
done
for r in / /activar /pagos /pagos/precios /cuenta /clases /asistencia /rutina /alta/00000000-0000-7000-8000-000000000000; do
  curl -s -o /dev/null --max-time 120 "$GYMFLOW_E2E_PORTAL$r"
done
# La base de pruebas para lib/base.mjs (adelantar el reloj de UN registro, o
# deshacer lo que el recorrido cerró). Solo acepta gymflow_pruebas.
export PGURL=$(grep '^DATABASE_URL_MIGRATOR' ~/gymflow-backend/.env | cut -d= -f2- | tr -d '"' | sed -E 's#/gymflow_[a-z_]+\?schema=public#/gymflow_pruebas#')
cd $S
# Sin permisos de administrador, las bibliotecas de Chromium viven en la
# caché del usuario (las deja ahí preparar.sh).
LIBS=${GYMFLOW_E2E_LIBS:-$HOME/.cache/gymflow-e2e/libs/usr/lib/x86_64-linux-gnu}
[ -d "$LIBS" ] && export LD_LIBRARY_PATH=$LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
fallos=0
for f in ${FLOWS:-padron mostrador mostrador-espera movil desborde menu modulos personal sucursales plataforma plataforma-ux cobranza dinero adeudo privacidad movimientos carga roles llave bloque3 bloque4 control permisos remota duena direccion contrasenas sesion antiguedad ventas membresia portal portal-ux avisos diseno importar importar-seguro caja altas flow clases crecimiento prospectos rutinas firmas escalera cumplimiento primer-uso mostrador-tarjeta ficha captacion clases-ciclo coach-dia direccion-precios plataforma-ficha firma-franja dinero-socio cajon entrada-reglas precios direccion-cierre altas-familia coach-codigo apoderado cuenta-gymflow cortes plazos nomina datos-y-marca interesados portal-contacto avisos-duena sesion-telefono plataforma-cobro portal-precios-rostro deudores mensajes}; do
  timeout 400 node $f.mjs > out-$f.log 2>&1; rc=$?
  oks=$(grep -c "^ok" out-$f.log); malos=$(grep -c "FALLÓ\|DESBORDA" out-$f.log)
  [ $rc -ne 0 ] && fallos=$((fallos+1))
  printf "%-17s exit %-3s ok %-3s fallos %s\n" $f $rc $oks $malos
  # Qué falló y, si fue por la API, qué petición no respondió o respondió con error.
  [ $rc -ne 0 ] && grep -m6 "FALLÓ\|Error\|DESBORDA\|sin respuesta:\|respondió con error\|recompiló" out-$f.log | cut -c1-240
done
echo "flujos con error: $fallos"
# Los servidores de pruebas se quedan encendidos para revisar lo que falló;
# el uso real nunca se apagó. Se apagan con: bash ~/gymflow-docs/scripts/gymflow.sh stop pruebas
echo "Pruebas encendidas en $GYMFLOW_E2E_PANEL; el uso real no se tocó."
[ $fallos -eq 0 ]
