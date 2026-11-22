// El menú lateral (2026-10; por tarea desde el bloque 2.1: Mostrador · Clases y
// crecimiento · Dinero · Gimnasio · Control): una sección abierta al entrar, se pliega y se
// recuerda, se encoge a iconos, la cuenta en un solo botón y el cajón del
// teléfono. Las esperas son a que termine la animación, no un rato.
import { recorrido, sinAnimaciones, PANEL } from './lib/index.mjs';

await recorrido('menu', async (r) => {
  const enlace = (p, nombre) => p.getByRole('link', { name: nombre, exact: true });
  const ancho = (p) => p.locator('.side').evaluate((e) => Math.round(e.getBoundingClientRect().width));

  // La gerencia ve todo: su menú llega con una sola sección abierta.
  const p = await r.como('gerencia');
  await enlace(p, 'Socios').waitFor();
  r.ok(await enlace(p, 'Tablero').count() === 0 && await enlace(p, 'Bitácora').count() === 0, 'al entrar solo está abierta la primera sección');
  await r.captura(p, 'menu-1-inicial');

  // Una sección se abre y se pliega, y el equipo lo recuerda.
  await p.getByRole('button', { name: /Dinero/ }).click();
  r.ok(await enlace(p, 'Tablero').count() === 1, 'Dinero se despliega');
  await enlace(p, 'Tablero').click();
  await p.waitForURL('**/tablero');
  await p.getByRole('button', { name: /Mostrador/ }).click();
  r.ok(await enlace(p, 'Socios').count() === 0, 'Mostrador se pliega');
  await p.reload({ waitUntil: 'networkidle' });
  await enlace(p, 'Tablero').waitFor();
  r.ok(await enlace(p, 'Socios').count() === 0, 'tras recargar sigue como se dejó');

  // Llegar a una pantalla abre su sección, aunque estuviera plegada.
  await p.goto(`${PANEL}/bitacora`, { waitUntil: 'networkidle' });
  await enlace(p, 'Bitácora').waitFor();
  r.ok(await enlace(p, 'Bitácora').getAttribute('aria-current') === 'page', 'la sección de la pantalla actual se abre sola');
  await p.getByRole('button', { name: /Mostrador/ }).click();

  // El lateral se encoge a iconos y deja el espacio a la pantalla.
  await sinAnimaciones(p);
  r.ok(await ancho(p) === 252, 'el lateral completo mide 252 px');
  await p.getByRole('button', { name: 'Menú' }).click();
  await sinAnimaciones(p);
  r.ok(await ancho(p) === 68, 'encogido mide 68 px');
  r.ok(await enlace(p, 'Socios').count() === 1 && await enlace(p, 'Planes').count() === 1, 'encogido muestra todos los iconos, con su nombre para el lector de pantalla');
  await r.captura(p, 'menu-2-encogido');
  await p.reload({ waitUntil: 'networkidle' });
  await enlace(p, 'Socios').waitFor();
  await sinAnimaciones(p);
  r.ok(await ancho(p) === 68, 'sigue encogido tras recargar');
  await enlace(p, 'Socios').click();
  await p.waitForURL('**/socios');
  r.ok(true, 'los iconos navegan');

  // La cuenta es un solo botón: tema, contraseña y salir están en su menú.
  await p.locator('.side-user').click();
  r.ok(await p.getByRole('menuitem', { name: 'Cambiar contraseña' }).count() === 1 && await p.getByRole('button', { name: /^Tema:/ }).count() === 1, 'el menú de la cuenta tiene tema y contraseña');
  await r.captura(p, 'menu-3-cuenta');
  await p.keyboard.press('Escape');
  r.ok(await p.getByRole('menuitem', { name: 'Cerrar sesión' }).count() === 0, 'Escape lo cierra');
  await p.getByRole('button', { name: 'Menú' }).click();
  await sinAnimaciones(p);
  r.ok(await ancho(p) === 252, 'el mismo botón lo devuelve completo');
  await p.locator('.side-user').click();
  await r.captura(p, 'menu-4-cuenta-completo');
  await p.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await p.waitForURL('**/login');
  r.ok(true, 'cerrar sesión desde el menú de la cuenta');

  // Quien ve una sola sección no tiene nada que plegar.
  for (const puesto of ['recepcion', 'coach']) {
    const x = await r.como(puesto);
    await enlace(x, 'Inicio').waitFor();
    const secciones = await x.locator('.side-group').count();
    const botones = await x.locator('button.side-group-title').count();
    r.ok(secciones > 1 ? botones === secciones : botones === 0, `${puesto}@demo.mx: ${secciones} sección(es), ${botones} plegable(s)`);
  }

  // En el teléfono el botón abre el cajón de siempre.
  const m = await r.como('gerencia', { movil: true, deviceScaleFactor: 1 });
  await m.getByRole('button', { name: 'Menú' }).click();
  await enlace(m, 'Socios').waitFor();
  await sinAnimaciones(m);
  r.ok(await ancho(m) === 272, 'en el teléfono el menú se abre encima, completo');
  await r.captura(m, 'menu-5-movil');
  r.ok(await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'móvil sin desborde');
});
