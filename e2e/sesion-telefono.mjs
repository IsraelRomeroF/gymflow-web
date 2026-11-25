// Las sesiones por lugar (fase 4, bloque 4.1 · D-04) y el relevo del mostrador
// (bloque 4.11), vistos en el navegador:
//
//  1. La dueña entra desde un TELÉFONO (navegador de iPhone: `movil: true`
//     solo cambia el tamaño y el tacto, y el servidor decide el lugar por el
//     navegador al entrar): «Mis sesiones» dice «Queda abierta mientras la uses»
//     y la cookie vale 30 días, no 12 horas.
//  2. Desde la computadora, la misma dueña ve esa sesión como «tu teléfono:
//     queda abierta mientras la uses», y la suya «Se cierra …» (12 h).
//  3. Recepción en un teléfono sigue con su sesión de mostrador: «Se cierra …».
//  4. Recepción tiene «Cambiar de usuario» en el menú de su cuenta: lleva al
//     login con «Sesión cerrada…»; la gerencia no tiene ese renglón.
//
// Al terminar, el teléfono de la dueña sale con «Cerrar sesión» (no deja una
// sesión de 30 días abierta en la base de pruebas). Nadie usa «Cerrar las
// demás»: cerraría las sesiones de la dueña de quien esté mirando las pruebas.
import { recorrido, aparece, PANEL, T } from './lib/index.mjs';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

await recorrido('sesion-telefono', async (r) => {
  let telefono = null;
  r.alFinal(async () => {
    if (!telefono || telefono.isClosed()) return;
    await telefono.evaluate(() => fetch('/api/auth/logout', { method: 'POST' })).catch(() => undefined);
  });

  // ── 1. La dueña en su teléfono ────────────────────────────────────────────
  r.paso('la dueña en su teléfono');
  telefono = await r.como('duena', { movil: true, userAgent: IPHONE });
  const yo = await telefono.evaluate(async () => (await fetch('/api/auth/me')).json());
  r.ok(yo.session?.kind === 'OWNER_PHONE' && yo.session?.renews === true, `el servidor le da la sesión del teléfono de la dueña (${yo.session?.kind})`);
  await telefono.goto(`${PANEL}/seguridad`, { waitUntil: 'networkidle' });
  const frase = telefono.getByTestId('sesion-de-telefono');
  r.ok(await aparece(frase, T.respuesta), '«Mis sesiones» dice «Queda abierta mientras la uses»');
  const texto = (await frase.innerText()).replace(/\s+/g, ' ');
  r.ok(/Si pasan 30 días sin usarla, se cierra \(hoy, eso sería el .+\); y el .+ se cierra aunque la uses/.test(texto) && /Cerrar las demás/.test(texto), `con el día en que se cerraría sin uso, el del tope y qué hacer si lo pierde: «${texto.slice(0, 200)}»`);
  r.ok(await telefono.getByText(/^Se cierra /).count() === 0, 'y no dice «Se cierra a las…»');
  const cookie = (await telefono.context().cookies()).find((c) => c.name === 'gf_session');
  const dias = cookie ? (cookie.expires * 1000 - Date.now()) / 86_400_000 : 0;
  r.ok(dias > 29 && dias <= 30.01, `la cookie vale 30 días (${dias.toFixed(2)})`);
  r.ok(await telefono.getByTestId('enlace-mis-avisos').count() === 1, 'y lleva a «Elegir qué avisos recibo»');
  await r.captura(telefono, 'sesion-telefono-1-duena', { full: true });

  // ── 2. La misma dueña en la computadora ───────────────────────────────────
  r.paso('la dueña en la computadora');
  const compu = await r.como('duena');
  const suya = await compu.evaluate(async () => (await fetch('/api/auth/me')).json());
  r.ok(suya.session?.kind === 'COUNTER' && suya.session?.renews === false, `en la computadora es sesión de mostrador (${suya.session?.kind})`);
  await compu.goto(`${PANEL}/seguridad`, { waitUntil: 'networkidle' });
  const esta = compu.getByTestId('esta-sesion');
  r.ok(await aparece(esta.getByText(/^Se cierra /), T.respuesta) && /Cada sesión dura 12 horas desde que entras/.test(await esta.innerText()), '«Se cierra …»: dura 12 horas');
  const otras = compu.getByTestId('otras-sesiones');
  const todas = otras.getByRole('button', { name: /^Ver todas/ });
  if (await todas.count()) await todas.click();
  r.ok(await aparece(otras.getByText(/tu teléfono: queda abierta mientras la uses \(sin uso, se cierra /).first(), T.respuesta), '«Tus otras sesiones» muestra la del teléfono: «tu teléfono: queda abierta mientras la uses (sin uso, se cierra …)»');

  // ── 3. Recepción en su teléfono: mostrador ────────────────────────────────
  r.paso('recepción en su teléfono');
  const recTel = await r.como('recepcion', { movil: true, userAgent: IPHONE });
  const deRec = await recTel.evaluate(async () => (await fetch('/api/auth/me')).json());
  r.ok(deRec.session?.kind === 'COUNTER' && deRec.session?.renews === false, `recepción en un iPhone: sesión de mostrador (${deRec.session?.kind})`);
  await recTel.goto(`${PANEL}/seguridad`, { waitUntil: 'networkidle' });
  r.ok(await aparece(recTel.getByTestId('esta-sesion').getByText(/^Se cierra /), T.respuesta) && await recTel.getByTestId('sesion-de-telefono').count() === 0, '«Se cierra …», no «Queda abierta mientras la uses»');

  // ── 4. «Cambiar de usuario» ───────────────────────────────────────────────
  r.paso('cambiar de usuario');
  const ger = await r.como('gerencia');
  await ger.locator('.side-user').click();
  await ger.getByRole('menuitem', { name: 'Cerrar sesión' }).waitFor({ timeout: T.ui });
  r.ok(await ger.getByRole('menuitem', { name: 'Cambiar de usuario' }).count() === 0, 'la gerencia no tiene «Cambiar de usuario» en el menú de su cuenta');
  await ger.keyboard.press('Escape');
  const rec = await r.como('recepcion');
  await rec.locator('.side-user').click();
  const cambiar = rec.getByRole('menuitem', { name: 'Cambiar de usuario' });
  r.ok(await aparece(cambiar, T.ui), 'recepción sí lo tiene');
  const renglones = (await rec.getByRole('menu', { name: 'Tu cuenta' }).getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
  r.ok(renglones.indexOf('Cambiar de usuario') === renglones.indexOf('Cerrar sesión') - 1, `justo encima de «Cerrar sesión» (${renglones.join(' · ')})`);
  await r.captura(rec, 'sesion-telefono-2-cambiar-de-usuario');
  await cambiar.click();
  await rec.waitForURL('**/login?relevo=1', { timeout: T.navegacion });
  const aviso = rec.getByTestId('aviso-entrar');
  r.ok(await aparece(aviso, T.respuesta), `el login lo dice: «${(await aviso.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}»`);
  r.ok(await rec.evaluate(() => document.activeElement?.getAttribute('type') === 'email' || /correo/i.test(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? '')), 'y el cursor queda en «Correo»');
  const sinSesion = await rec.evaluate(async () => (await fetch('/api/auth/me')).status);
  r.ok(sinSesion === 401, `la sesión de recepción quedó cerrada (${sinSesion})`);
}, { erroresDePagina: 'informa' });
