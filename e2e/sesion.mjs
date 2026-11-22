// La sesión (auditoría 8, fase 1.12: 24-04 a 24-08, 24-13 a 24-15). Cuando la
// sesión termina, el panel lleva al login DICIENDO POR QUÉ (`?motivo=`), con
// el aviso arriba del formulario, y al volver a entrar regresa a la pantalla
// donde estaba (`?volver=`). El tope se ve antes de llegar («Tu sesión se
// cierra a las…»). «Mis sesiones» lista las vivas y «Cerrar las demás» las
// cierra de verdad. Salir limpia el navegador. En el portal, el 401 lleva a
// «Activar» con su motivo y regresa a donde estaba.
//
// Sin escribir en gymflow_pruebas (como los guiones de 1.12): el 401 de cada
// motivo y el tope se simulan con page.route sobre la respuesta. Lo único real
// es «Cerrar las demás», y se hace con una cuenta propia de la corrida (se da
// de baja al terminar), para no cerrar la sesión de nadie más.
import { recorrido, socioAlCorriente, invitacionPortal, teclear, elegirContrasena, asentado, aparece, letras, sufijo, PANEL, PORTAL, T } from './lib/index.mjs';

/** Lo que el login dice arriba del formulario, por motivo (lib/sesion.ts del panel). */
const AVISO = {
  vencida: 'Tu sesión terminó',
  inactividad: 'Tu sesión se cerró por inactividad',
  cerrada: 'Tu sesión se cerró',
  'otro-equipo': 'Tu sesión se cerró desde otro equipo',
  todos: 'Se cerró tu sesión en todos los equipos',
  contrasena: 'Tu contraseña cambió',
  'temporal-nueva': 'Te dieron una contraseña temporal nueva',
  baja: 'Tu cuenta se dio de baja',
  permisos: 'Cambió lo que puedes ver',
  bloqueada: 'Tu cuenta se bloqueó por intentos fallidos',
  temporal: 'Primero elige tu contraseña',
  'temporal-vencida': 'Tu contraseña temporal venció',
  suspendido: 'El servicio de tu gimnasio está suspendido',
  'no-liberado': 'El servicio de tu gimnasio todavía no está liberado',
  red: 'Esta red no puede entrar a la consola',
};
/** El 401 a media pantalla, con el `reason` de la API y la palabra que el login debe recibir. */
const A_MEDIA_PANTALLA = [['SESSION_CLOSED_ELSEWHERE', 'otro-equipo'], ['PASSWORD_CHANGED', 'contrasena'], ['PASSWORD_RESET', 'temporal-nueva'], ['ACCOUNT_DEACTIVATED', 'baja']];
const PROPIA = 'Sesion.Propia.2026';

await recorrido('sesion', async (r) => {
  const aviso = (p) => p.getByTestId('aviso-entrar');
  const dice = async (p, texto) => (await aparece(aviso(p), T.ui)) && (await aviso(p).innerText()).includes(texto);

  // 1. Entrar con la pantalla de regreso: tras entrar va a /socios, no al inicio.
  r.paso('volver tras entrar');
  const p = await r.nueva();
  await p.goto(`${PANEL}/login?volver=%2Fsocios`, { waitUntil: 'networkidle' });
  await teclear(p, 'gerencia@demo.mx');
  r.ok(await p.waitForURL((u) => u.pathname === '/socios', { timeout: T.navegacion }).then(() => true, () => false), 'con ?volver=/socios, al entrar regresa a /socios');
  const fin = await p.evaluate(() => localStorage.getItem('gf-sesion-fin'));
  r.ok(!!fin && Number(fin) > Date.now() + 11 * 3600_000, `el login recuerda a qué hora se cierra la sesión (${fin ? new Date(Number(fin)).toLocaleString('es-MX') : 'nada'})`);

  // 2. La sesión muere a media pantalla: 401 con su motivo → login con el aviso y la pantalla.
  for (const [reason, motivo] of A_MEDIA_PANTALLA) {
    r.paso(`401 ${reason}`);
    await p.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
    await p.route('**/api/members/search**', (x) => x.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'UNAUTHENTICATED', message: 'Sesión requerida', reason }) }));
    await p.getByPlaceholder(/Nombre, código o teléfono|Buscar/).first().fill('ana');
    await p.waitForURL((u) => u.pathname === '/login', { timeout: T.respuesta });
    const url = new URL(p.url());
    r.ok(url.searchParams.get('motivo') === motivo && url.searchParams.get('volver') === '/socios', `un 401 ${reason} lleva al login con motivo=${motivo} y volver=/socios (${url.search})`);
    r.ok(await dice(p, AVISO[motivo]), `y el login dice arriba «${AVISO[motivo]}»`);
    if (motivo === 'otro-equipo') await r.captura(p, 'sesion-1-login-con-motivo');
    await p.unroute('**/api/members/search**');
    await teclear(p, 'gerencia@demo.mx');
    r.ok(await p.waitForURL((u) => u.pathname === '/socios', { timeout: T.navegacion }).then(() => true, () => false), 'al volver a entrar regresa a /socios');
  }

  // 3. Cada motivo tiene su aviso en el login (la tabla de 1.12).
  r.paso('los avisos del login');
  const login = await r.nueva();
  const faltan = [];
  for (const [motivo, texto] of Object.entries(AVISO)) {
    await login.goto(`${PANEL}/login?motivo=${motivo}`, { waitUntil: 'networkidle' });
    if (!(await dice(login, texto))) faltan.push(motivo);
  }
  r.ok(faltan.length === 0, `cada motivo dice su aviso arriba del formulario (${Object.keys(AVISO).length} motivos${faltan.length ? `; sin aviso: ${faltan.join(', ')}` : ''})`);
  await login.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
  r.ok(await aviso(login).count() === 0, 'sin motivo, el login no dice nada');

  // 4. El tope a la vista: diez minutos antes, el aviso; a la hora, al login con motivo=vencida y la pantalla.
  r.paso('el tope');
  const conTope = (segundos) => p.route('**/api/auth/me', async (x) => {
    const res = await x.fetch();
    const j = await res.json();
    j.session = { ...j.session, secondsLeft: segundos };
    await x.fulfill({ response: res, body: JSON.stringify(j) });
  });
  await conTope(300);
  await p.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
  r.ok(await aparece(p.getByTestId('aviso-cierre'), T.respuesta) && /Tu sesión se cierra a las \d\d:\d\d/.test(await p.getByTestId('aviso-cierre').innerText()), 'diez minutos antes, el panel dice a qué hora se cierra');
  await r.captura(p, 'sesion-2-aviso-de-cierre');
  await p.unroute('**/api/auth/me');
  await conTope(1);
  await p.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await p.waitForURL((u) => u.pathname === '/login', { timeout: T.respuesta });
  const u2 = new URL(p.url());
  r.ok(u2.searchParams.get('motivo') === 'vencida' && u2.searchParams.get('volver') === '/caja', `al llegar el tope, al login con motivo=vencida y volver=/caja (${u2.search})`);
  await p.unroute('**/api/auth/me');

  // 5. «Mis sesiones» y «Cerrar las demás», de verdad, con una cuenta propia de la corrida.
  r.paso('mis sesiones');
  const g = await r.api('gerencia');
  const s = sufijo();
  const correo = `sesion.${s}@demo.mx`;
  const sedes = await g.get('/branches');
  const alta = await g.post('/users', { email: correo, fullName: `Sara Sesión ${letras(4)}`, phoneE164: null, roleKey: 'RECEPTION', branchIds: [sedes.find((b) => b.code === 'CEN').id], reason: 'Cuenta de un recorrido de prueba' });
  r.alFinal(async () => {
    const u = (await g.get('/users')).users.find((x) => x.email === correo && x.isActive);
    if (u) await g.patch(`/users/${u.id}`, { isActive: false, reason: 'Cuenta de un recorrido de prueba' });
  });
  const a = await r.nueva();
  await a.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
  await teclear(a, correo, alta.temporaryPassword);
  await elegirContrasena(a, PROPIA);
  await a.waitForURL('**/panel', { timeout: T.navegacion });
  const b = await r.nueva({ viewport: { width: 1280, height: 800 } });
  await b.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
  await teclear(b, correo, PROPIA);
  await b.waitForURL('**/panel', { timeout: T.navegacion });
  await a.locator('.side-user').click();
  await a.getByRole('menuitem', { name: 'Mis sesiones' }).click();
  await a.waitForURL('**/seguridad', { timeout: T.respuesta });
  await a.getByTestId('esta-sesion').waitFor({ timeout: T.respuesta });
  r.ok(/Se cierra (a las|el)/.test(await a.getByTestId('esta-sesion').innerText()), '«Mis sesiones» dice a qué hora se cierra esta sesión');
  // El título lo pone el marco después de cargar: se espera a que cambie, con su tope.
  await a.waitForFunction(() => document.title === 'Mis sesiones · GymFlow', null, { timeout: T.ui }).catch(() => undefined);
  r.ok(await a.title() === 'Mis sesiones · GymFlow', `y la pestaña se llama «${await a.title()}»`);
  const otras = a.getByTestId('otras-sesiones');
  await otras.locator('.list-item').first().waitFor({ timeout: T.respuesta });
  r.ok(await otras.locator('.list-item').count() === 1 && await a.getByTestId('cerrar-las-demas').innerText().then((t) => t.includes('(1)')), 'lista la otra sesión viva de la cuenta, con su equipo: «Cerrar las demás (1)»');
  await a.getByTestId('cerrar-las-demas').click();
  const d = a.getByRole('dialog');
  await d.waitFor({ timeout: T.ui });
  r.ok(/deja de recibir tus avisos|dejan de recibir tus avisos/.test(await d.innerText()), 'el diálogo dice que ese equipo deja de recibir los avisos');
  await r.captura(a, 'sesion-3-cerrar-las-demas');
  await d.getByRole('button', { name: 'Cerrar las demás' }).click();
  r.ok(await aparece(otras.getByText('Solo está abierta aquí'), T.respuesta), 'después solo queda la de este equipo');
  // En el otro equipo, lo siguiente que haga lo lleva al login con el porqué y la pantalla.
  await b.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await b.waitForURL((u) => u.pathname === '/login', { timeout: T.respuesta });
  r.ok(new URL(b.url()).searchParams.get('motivo') === 'otro-equipo' && await dice(b, AVISO['otro-equipo']), `en el otro equipo: «${AVISO['otro-equipo']}» (${new URL(b.url()).search})`);

  // 6. Salir: al login (sin parámetros), «Saliste…» y en el navegador solo la apariencia.
  r.paso('salir limpia el navegador');
  await a.evaluate(() => { localStorage.setItem('gf-menu', '{"x":true}'); localStorage.setItem('gf-tema', 'dark'); });
  await a.locator('.side-user').click();
  await a.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await a.waitForURL('**/login', { timeout: T.respuesta });
  r.ok(await dice(a, 'Saliste de GymFlow en este equipo'), 'el login dice «Saliste de GymFlow en este equipo»');
  const quedan = await a.evaluate(() => Object.keys(localStorage).sort());
  r.ok(quedan.every((k) => k === 'gf-tema' || k === 'gf-lateral'), `en el navegador solo queda la apariencia (${quedan.join(', ') || 'nada'})`);

  // 7. Portal: el 401 lleva a «Activar» con motivo y regreso, y el teléfono queda limpio.
  r.paso('portal');
  const socio = await socioAlCorriente(g, { sede: 'CEN' });
  const code = await invitacionPortal(g, socio);
  const tel = await r.nueva({ movil: true, serviceWorkers: 'block', etiqueta: 'portal' });
  await tel.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await tel.getByLabel('Código de activación').fill(code);
  await tel.getByRole('button', { name: /Activar/ }).click();
  await tel.waitForURL(`${PORTAL}/`, { timeout: T.respuesta });
  // Desde la fase 2 (bloque 2.8) Cuenta es una pestaña, y la fecha tope la dice la API (`/portal/sessions`).
  await tel.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Cuenta' }).click();
  r.ok(await aparece(tel.getByTestId('abierto-hasta'), T.respuesta) && /queda abierto hasta el/.test(await tel.getByTestId('abierto-hasta').innerText()), '«Tu cuenta» dice hasta cuándo queda abierto en este teléfono');
  await tel.keyboard.press('Escape');
  await tel.goto(`${PORTAL}/pagos`, { waitUntil: 'networkidle' });
  await tel.evaluate(() => localStorage.setItem('gf-rutina-dia', '2'));
  // Recepción cerró el portal en sus teléfonos: el siguiente pedido da 401 (simulado).
  await tel.route('**/api/portal/**', (x) => x.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'UNAUTHENTICATED', message: 'Sesión requerida' }) }));
  await tel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await tel.waitForURL((u) => u.pathname === '/activar', { timeout: T.respuesta });
  const u3 = new URL(tel.url());
  r.ok(u3.searchParams.get('motivo') === 'cerrada' && u3.searchParams.get('volver') === '/pagos', `a «Activar» con motivo=cerrada y volver=/pagos (${u3.search})`);
  r.ok(await aparece(tel.getByTestId('aviso-activar'), T.ui) && (await tel.getByTestId('aviso-activar').innerText()).includes('Tu sesión en este teléfono se cerró'), '«Activar» dice que la sesión se cerró en este teléfono');
  const limpio = await tel.evaluate(async () => ({ ls: Object.keys(localStorage).sort(), caches: (await caches.keys()).length }));
  r.ok(!limpio.ls.includes('gf-rutina-dia') && !limpio.ls.includes('gf-portal-hasta') && limpio.caches === 0, `el teléfono queda limpio salvo el nombre del gimnasio (${limpio.ls.join(', ')}; ${limpio.caches} cachés)`);
  await r.captura(tel, 'sesion-4-portal-activar-con-motivo');
  // La sesión real sigue viva: «Activar» no pide código y regresa a /pagos.
  await tel.unroute('**/api/portal/**');
  await tel.goto(`${PORTAL}/activar?motivo=cerrada&volver=%2Fpagos`, { waitUntil: 'networkidle' });
  r.ok(await tel.waitForURL((x) => x.pathname === '/pagos', { timeout: T.respuesta }).then(() => true, () => false), 'con la sesión viva, «Activar» regresa a /pagos');
  await tel.evaluate(() => fetch('/api/portal/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
}, { erroresDePagina: 'falla' });
