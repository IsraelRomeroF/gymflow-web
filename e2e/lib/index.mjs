// La base común de los recorridos (auditoría 8, fase 1.17a). Ver README en
// fase1/1.17a-recorridos.md y la cabecera de cada archivo:
//   entorno   destino (solo pruebas), idioma es-MX, zona CDMX, topes T.*, cuentas
//   navegador Chromium y contextos con idioma y zona fijos
//   acceso    entrar(p, 'recepcion'), elegirContrasena, motivoDeExcepcion
//   menu      abrirMenu, irPorMenu
//   cobro     elegirCaja (cuando el cobro pide elegir el turno)
//   esperas   respuesta, accion, respuestas, asentado, cuadros, hasta, aparece
//   red       qué petición sigue sin respuesta (lento vs colgado)
//   informe   ok / FALLÓ / nota, captura
//   api       sesionApi('gerencia') para preparar y comprobar por la API
//   datos     socios, membresías, clases y retiros propios de cada corrida
//   base      sql() contra gymflow_pruebas; leer() de solo lectura
//   recorrido el arranque y cierre de cada recorrido
export * from './entorno.mjs';
export * from './navegador.mjs';
export * from './acceso.mjs';
export * from './menu.mjs';
export * from './cobro.mjs';
export * from './esperas.mjs';
export * from './red.mjs';
export * from './informe.mjs';
export * from './api.mjs';
export * from './datos.mjs';
export * from './base.mjs';
export * from './recorrido.mjs';
