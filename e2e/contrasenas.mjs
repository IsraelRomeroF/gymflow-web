// Contraseñas temporales (auditoría 8, fase 0.2: A4-N1, 22-03, 24-10). La
// temporal solo sirve para elegir la propia, ahí mismo en /login (paso
// «elegir-contrasena»): sin volver a pedirla, con 12 caracteres y los errores
// en su campo; mientras tanto la sesión no opera nada. Se entrega a su dueño
// (Copiar o WhatsApp a SU celular) y vence a los 7 días: vencida, el login dice
// «venció» y la gerencia da otra.
//
// Una temporal de 8 días no se espera en un recorrido: se recorre su fecha en
// gymflow_pruebas (lib/base.mjs), que es lo que haría el paso del tiempo. A mano:
// dar de alta a alguien y entrar con su temporal 8 días después.
// Fase 1.17a: las dos cuentas de la corrida se dan de baja al terminar (antes
// se quedaban activas en Personal, dos por corrida).
import { recorrido, irPorMenu, elegirContrasena, sql, aparece, PANEL, T } from './lib/index.mjs';

await recorrido('contrasenas', async (r) => {
  const sufijo = Date.now().toString(36).slice(-5);
  // Los nombres de persona no llevan dígitos (la API los rechaza).
  const letras = sufijo.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).toUpperCase();
  const PROPIA = 'Lucia.Propia.2026';
  const lucia = { nombre: `Lucía Temporal ${letras}`, email: `temporal.${sufijo}@demo.mx` };
  const tomas = { nombre: `Tomás Vencida ${letras}`, email: `vencida.${sufijo}@demo.mx` };
  const g0 = await r.api('gerencia');
  r.alFinal(async () => {
    const gente = (await g0.get('/users')).users;
    for (const correo of [lucia.email, tomas.email]) {
      const u = gente.find((x) => x.email === correo && x.isActive);
      if (u) await g0.patch(`/users/${u.id}`, { isActive: false, reason: 'Cuenta de un recorrido de prueba' });
    }
  });

  const g = await r.como('gerencia');

  /** Alta en Personal: devuelve la temporal que se ve UNA vez. */
  async function alta(nombre, email) {
    await irPorMenu(g, 'Personal');
    await g.getByRole('button', { name: 'Dar de alta' }).click();
    const d = g.getByRole('dialog');
    await d.getByLabel('Nombre completo').fill(nombre);
    await d.getByLabel('Correo').fill(email);
    await d.getByRole('button', { name: 'Dar de alta' }).click();
    const clave = g.getByRole('dialog', { name: /^Contraseña temporal de/ });
    await clave.waitFor({ timeout: T.respuesta });
    return { dialogo: clave, temporal: (await clave.locator('.mono').first().innerText()).trim() };
  }
  async function login(email, clave) {
    const p = await r.nueva();
    await p.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
    await p.getByLabel('Correo').fill(email);
    await p.getByLabel('Contraseña').fill(clave);
    await p.getByRole('button', { name: /^Entrar/ }).first().click();
    return p;
  }

  // 1. Entrega a la persona: su temporal, con Copiar y WhatsApp, y cuándo vence.
  r.paso('entrega de la temporal');
  const a = await alta(lucia.nombre, lucia.email);
  r.ok(/^GYM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(a.temporal), `la gerencia ve la temporal una sola vez (${a.temporal})`);
  r.ok(await a.dialogo.getByRole('button', { name: 'Copiar' }).count() === 1 && await a.dialogo.getByRole('button', { name: /WhatsApp/ }).count() === 1, 'se entrega a esa persona: «Copiar» y «WhatsApp» a su celular');
  r.ok(/vence en 7 días/.test(await a.dialogo.innerText()), 'y dice que vence en 7 días');
  await r.captura(g, 'contrasenas-1-entrega');
  await a.dialogo.getByRole('button', { name: 'Ya la entregué' }).click();

  // 2. Primer ingreso: el login pide elegir la propia y la temporal no opera nada.
  r.paso('primer ingreso');
  const p = await login(lucia.email, a.temporal);
  const paso = p.getByTestId('elegir-contrasena');
  await paso.waitFor({ timeout: T.respuesta });
  r.ok(new URL(p.url()).pathname === '/login', 'con la temporal no pasa al panel: se queda en /login');
  r.ok(await paso.getByLabel('Contraseña actual').count() === 0 && await paso.getByLabel('Nueva contraseña').count() === 1 && await paso.getByLabel('Repítela').count() === 1, 'dos campos, sin volver a pedir la temporal');
  const conTemporal = await p.evaluate(async () => ({ socios: (await fetch('/api/members?limit=1')).status, yo: await (await fetch('/api/auth/me')).json() }));
  r.ok(conTemporal.socios === 401 && conTemporal.yo.mustChangePassword === true, `con la temporal la API no deja operar (socios ${conTemporal.socios}) y dice que falta cambiarla`);
  await r.captura(p, 'contrasenas-2-elegir');
  const guardar = paso.getByRole('button', { name: /Guardar y entrar/ });
  const errorDe = (id) => paso.locator(`.field:has(#${id}) .field-error`);
  // Espera a que el error de ese campo diga lo esperado (no lee el que había antes).
  // Si no llega, dice qué había: el texto del campo, si el paso sigue a la vista y dónde está la página.
  const diceError = async (id, re) => (await aparece(errorDe(id).filter({ hasText: re }), T.ui))
    || `dice «${await errorDe(id).innerText().catch(() => '(nada)')}» · paso a la vista: ${await paso.isVisible()} · ${new URL(p.url()).pathname}`;
  await paso.getByLabel('Nueva contraseña').fill('Corta.2026');
  await paso.getByLabel('Repítela').fill('Corta.2026');
  await guardar.click();
  const e1 = await diceError('nueva', /Mínimo 12 caracteres/);
  r.ok(e1 === true, `menos de 12 caracteres: el error sale en su campo${e1 === true ? '' : ` (${e1})`}`);
  await paso.getByLabel('Nueva contraseña').fill(a.temporal);
  await paso.getByLabel('Repítela').fill(a.temporal);
  // Ya hubo un intento, así que el error sale al teclear: se espera a que la pantalla lo refleje antes de
  // guardar (sin esto, leer el campo en el mismo instante del clic fallaba de vez en cuando).
  await aparece(errorDe('nueva').filter({ hasText: /distinta de la temporal/ }), T.ui);
  await guardar.click();
  const e2 = await diceError('nueva', /distinta de la temporal/);
  r.ok(e2 === true, `la nueva no puede ser la temporal${e2 === true ? '' : ` (${e2})`}`);
  await paso.getByLabel('Nueva contraseña').fill(PROPIA);
  await paso.getByLabel('Repítela').fill(`${PROPIA}x`);
  await guardar.click();
  const e3 = await diceError('repetir', /No coincide/);
  r.ok(e3 === true, `si no coinciden, lo dice en «Repítela»${e3 === true ? '' : ` (${e3})`}`);
  r.ok(new URL(p.url()).pathname === '/login', 'con errores no entra');
  await elegirContrasena(p, PROPIA);
  await p.waitForURL('**/panel', { timeout: T.navegacion });
  r.ok(true, 'al guardar la suya entra al panel');
  const viejaOtraVez = await login(lucia.email, a.temporal);
  await viejaOtraVez.getByText('El correo o la contraseña no coinciden').waitFor({ timeout: T.respuesta }).catch(() => undefined);
  r.ok(await viejaOtraVez.getByText('El correo o la contraseña no coinciden').count() === 1 && await viejaOtraVez.getByTestId('elegir-contrasena').count() === 0, 'la temporal ya no sirve para entrar');
  const conLaSuya = await login(lucia.email, PROPIA);
  await conLaSuya.waitForURL('**/panel', { timeout: T.navegacion });
  r.ok(true, 'con la suya entra directo, sin el paso de elegir');

  // 3. La temporal vencida: el login dice «venció» y la gerencia da otra.
  r.paso('temporal vencida');
  const b = await alta(tomas.nombre, tomas.email);
  await b.dialogo.getByRole('button', { name: 'Ya la entregué' }).click();
  const movida = await sql(`update users set "passwordResetAt" = now() - interval '8 days' where lower(email) = lower($1) and "mustChangePassword" returning id`, [tomas.email]);
  r.ok(movida.length === 1, 'pasan 8 días sin que la use');
  const v = await login(tomas.email, b.temporal);
  const aviso = v.getByText(/Tu contraseña temporal venció/);
  r.ok(await aparece(aviso, T.respuesta), `el login dice «${(await aviso.innerText().catch(() => '')).trim()}»`);
  r.ok(await v.getByTestId('elegir-contrasena').count() === 0 && new URL(v.url()).pathname === '/login', 'y no deja elegir contraseña con ella');
  await r.captura(v, 'contrasenas-3-vencida');
  await irPorMenu(g, 'Personal');
  const fila = g.getByRole('row').filter({ hasText: tomas.email });
  await fila.getByRole('button', { name: 'Nueva contraseña' }).click();
  const confirma = g.getByRole('dialog', { name: new RegExp(`¿Nueva contraseña para ${tomas.nombre}`) });
  await confirma.getByLabel('Motivo').fill('Su temporal venció sin usarla');
  await confirma.getByRole('button', { name: 'Generar contraseña' }).click();
  const otra = g.getByRole('dialog', { name: /^Contraseña temporal de/ });
  await otra.waitFor({ timeout: T.respuesta });
  const temporal2 = (await otra.locator('.mono').first().innerText()).trim();
  await otra.getByRole('button', { name: 'Ya la entregué' }).click();
  r.ok(temporal2 !== b.temporal, 'la gerencia le da una temporal nueva');
  const t2 = await login(tomas.email, temporal2);
  r.ok(await aparece(t2.getByTestId('elegir-contrasena'), T.respuesta), 'con la nueva vuelve a elegir la suya en /login');
}, { erroresDePagina: 'falla' });
