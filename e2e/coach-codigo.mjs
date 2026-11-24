// Coach (fase 3, bloque 3.8 · D-28 y D-29), en el navegador:
//
//  1. «Hacerme su coach»: un socio sin coach genera su código en el portal
//     (Rutina → «Generar código para mi coach»), se lo dicta al coach, y el
//     coach lo teclea en su Inicio: «Ya eres coach de …». La API confirma que
//     el socio quedó con ese coach.
//  2. El coach en Clases: no tiene «Agregar al horario» ni «Cancelar sesión»
//     en ninguna sesión; la gerencia sí.
//
// Datos propios: un socio «Zavala…» de la corrida con su portal activado.
// No se prueba el código equivocado ni repetido: cada fallo cuenta contra la
// cuenta del coach sembrado (con varios la API lo deja en espera una hora) y
// las corridas seguidas se lo acabarían.
import { recorrido, socioAlCorriente, invitacionPortal, accion, asentado, aparece, PANEL, PORTAL, T } from './lib/index.mjs';

await recorrido('coach-codigo', async (r) => {
  const g = await r.api('gerencia');
  const socio = await socioAlCorriente(g, { sede: 'CEN' });
  const nombre = `${socio.firstName} ${socio.lastName}`;
  r.nota(`socio de la corrida: ${socio.memberCode}, sin coach`);

  // ── 1. El socio genera su código en el teléfono ───────────────────────────
  r.paso('código en el portal');
  const tel = await r.nueva({ movil: true });
  await tel.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await tel.locator('input').first().fill(await invitacionPortal(g, socio));
  await tel.getByRole('button', { name: /Activar/ }).click();
  await tel.waitForURL(`${PORTAL}/`, { timeout: T.navegacion });
  await tel.getByRole('link', { name: 'Rutina' }).click();
  const tarjeta = tel.getByTestId('codigo-coach');
  r.ok(await aparece(tarjeta, T.navegacion) && await tarjeta.getByText('¿Ya tienes coach?').count() === 1, 'a quien no tiene coach, Rutina le ofrece «¿Ya tienes coach?»');
  const generado = await accion(tel, () => tarjeta.getByRole('button', { name: 'Generar código para mi coach' }).click(), (url) => new URL(url).pathname.endsWith('/portal/coach/code'), { metodo: 'POST', que: 'el código para el coach' });
  const codigo = (await generado.json()).code;
  r.ok(generado.ok() && /^\d{6}$/.test(codigo ?? ''), `genera un código de seis cifras (${generado.status()})`);
  const visto = (await tarjeta.locator('.codigo-coach').innerText()).replace(/\s/g, '');
  r.ok(visto === codigo && /Sirve una sola vez y hasta las \d{1,2}:\d{2}/.test(await tarjeta.innerText()), 'lo enseña en grande, con hasta qué hora sirve y que es de un solo uso');
  await r.captura(tel, 'coach-codigo-1-portal');

  // ── 2. El coach lo teclea en su Inicio ────────────────────────────────────
  r.paso('hacerme su coach');
  const coach = await r.como('coach');
  const yo = await coach.evaluate(async () => (await fetch('/api/auth/me')).json());
  const boton = coach.getByTestId('hacerme-su-coach');
  r.ok(await aparece(boton, T.respuesta), 'el Inicio del coach trae «Hacerme su coach»');
  await boton.click();
  const d = coach.getByRole('dialog', { name: 'Hacerme su coach' });
  const ligar = d.getByRole('button', { name: 'Hacerme su coach' });
  r.ok(await ligar.isDisabled(), 'sin las seis cifras no se puede');
  await d.getByLabel('Código que te dicta el socio').fill(codigo);
  await r.captura(coach, 'coach-codigo-2-teclea');
  const ligado = await accion(coach, () => ligar.click(), '/api/coach/claim', { metodo: 'POST', que: 'ligarse como su coach' });
  r.ok(ligado.ok(), `el código pasa (${ligado.status()})`);
  r.ok(await aparece(d.getByText(`Ya eres coach de ${nombre}`), T.respuesta), `el diálogo dice «Ya eres coach de ${nombre}»`);
  r.ok(await d.getByRole('link', { name: 'Abrir su ficha' }).getAttribute('href') === `/socios/${socio.id}`, 'y ofrece «Abrir su ficha»');
  await r.captura(coach, 'coach-codigo-3-ligado');
  const ficha = await g.get(`/members/${socio.id}`);
  const idCoach = yo.userId ?? yo.user?.id ?? yo.id;
  r.ok(!!ficha.coachUserId && (!idCoach || ficha.coachUserId === idCoach), `por la API, ${socio.memberCode} quedó con ese coach`);
  await d.getByRole('button', { name: 'Cerrar' }).last().click();
  await coach.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await coach.locator('input.input-lg').fill(socio.memberCode).catch(() => undefined);
  r.ok(await aparece(coach.getByText(socio.lastName).first(), T.respuesta), 'y el socio ya sale en «Mis socios» del coach');
  await tel.reload({ waitUntil: 'networkidle' });
  await asentado(tel);
  r.ok(await tel.getByTestId('codigo-coach').count() === 0, 'en el teléfono del socio ya no se ofrece el código: ya tiene coach');

  // ── 3. El coach en Clases: ni cancelar ni armar horario ───────────────────
  r.paso('el coach no cancela');
  await coach.goto(`${PANEL}/clases`, { waitUntil: 'networkidle' });
  await asentado(coach);
  const filasCoach = await coach.locator('li.sesion-fila').count();
  r.ok(await coach.getByRole('button', { name: 'Agregar al horario' }).count() === 0, 'el coach no tiene «Agregar al horario»');
  r.ok(await coach.getByRole('button', { name: /^Más acciones de / }).count() === 0 && await coach.getByText('Cancelar sesión').count() === 0, `ni «Cancelar sesión» en ninguna sesión (${filasCoach} a la vista)`);
  await r.captura(coach, 'coach-codigo-4-clases');
  const ger = await r.como('gerencia');
  await ger.goto(`${PANEL}/clases`, { waitUntil: 'networkidle' });
  await ger.locator('li.sesion-fila').first().waitFor({ timeout: T.respuesta });
  r.ok(await ger.getByRole('button', { name: 'Agregar al horario' }).count() === 1 && await ger.getByRole('button', { name: /^Más acciones de / }).count() >= 1, 'la gerencia sí tiene «Agregar al horario» y «Más acciones» (cancelar) en las sesiones');
});
