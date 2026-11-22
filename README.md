# @gymflow/web

Panel web de GymFlow (Next.js 16, React 19): mostrador, socios, caja, clases,
reportes y administración. El portal del socio es otro repositorio
(`gymflow-portal`).

```bash
pnpm install
pnpm dev        # http://localhost:3003
pnpm verify     # typecheck + lint
```

Habla con `gymflow-backend` por HTTP. No comparte código con él: lo único que
cruza es el contrato de la API. Las peticiones a `/api` se reenvían a
`API_URL` (por defecto `http://127.0.0.1:3001`).

## Secciones y módulos (`modules/`)

Cada pantalla del panel se declara **una vez** en `modules/registro.ts`: a qué
módulo pertenece, qué permiso la abre, de quién es y con qué palabras se
encuentra. De esa lista salen el menú, la puerta que protege cada ruta
(`components/puerta.tsx`), el buscador (Ctrl K) y los accesos rápidos del inicio.

- **Una pantalla nueva** = su carpeta en `app/(panel)/` + una entrada en el registro.
- El módulo es la clave del catálogo de la API (`@gymflow/core`, ADR-036). Si
  el gimnasio lo tiene apagado, la sección no aparece para nadie y su ruta
  muestra "X está apagado en tu gimnasio". `useSession().activo('classes')`
  dice si un módulo está encendido, para esconder lo que una pantalla muestra
  de otra (una pestaña de la ficha del socio, una tarjeta del Tablero).
- Lo cambia la gerencia general en **Dirección → Módulos**.
- Una ruta sin entrada propia en el menú cuelga de otra sección con `rutas`
  (`/arranque`, la lista de primer arranque, vive bajo Inicio).

## Plataforma (`app/(plataforma)/`)

Marco aparte para quien opera GymFlow, sin ninguna pantalla del panel
(ADR-037): `/plataforma` lista los gimnasios (plan, servicio, cobro) y da de
alta nuevos; `/plataforma/[id]` es el CRUD de cada uno: editar la marca,
asignar o cambiar **plan**, liberar o suspender el servicio, contratar
agregados, dar cuentas con cualquier **puesto del catálogo** y **cobrar**
(tarjeta Cobro); `/plataforma/planes` define los paquetes de módulos con su
precio (ADR-039); `/plataforma/precios` fija el precio suelto de cada módulo
y `/plataforma/factura/[id]` muestra el comprobante (interno, no CFDI;
ADR-038). Los puestos y los planes vigentes llegan en `/platform/me`
(`usePlataforma().roles` / `.plans`); los diálogos del cobro están en
`plataforma/cobro.tsx`.

## Primer arranque (`components/arranque.tsx`)

`GET /organization/setup` dice qué le falta a un gimnasio para abrir. La
tarjeta "Para empezar" sale en el inicio de la gerencia mientras falte algo
obligatorio y `/arranque` tiene la lista completa (ADR-038).

## Recorridos de navegador (`e2e/`)

Cada archivo `e2e/*.mjs` recorre el panel (y el portal) como lo haría una
persona, contra la base de pruebas automáticas (gymflow_pruebas, gimnasios ficticios), e imprime `ok:` o `FALLÓ:` por cada
comprobación.

```bash
pnpm e2e:preparar                 # una vez por máquina: baja Chromium y sus bibliotecas
pnpm e2e                          # regenera la base de pruebas y corre todos los recorridos
FLOWS="control remota" pnpm e2e   # solo algunos
```

- Necesita los seis repositorios como carpetas hermanas y PostgreSQL arriba:
  `regresion.sh` llama a `gymflow-docs/scripts/gymflow.sh reset`, que
  regenera `gymflow_pruebas` y levanta API (3001), portal (3002) y panel (3003).
- El orden de los recorridos importa y está fijo en `regresion.sh`.
- Las capturas quedan en `e2e/shots/` y la salida de cada recorrido en
  `e2e/out-<nombre>.log`; ninguna de las dos se versiona.
- `mfa.mjs` y `visual.mjs` no forman parte de la regresión: el primero pide
  la API con `MFA_REQUIRED=true` y el segundo solo saca capturas.
- Todavía no corren en CI: hace falta levantar ahí la API y la base.
