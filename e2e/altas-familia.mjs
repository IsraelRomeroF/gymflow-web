// Altas (fase 3, bloque 3.4 · D-09, D-10 y D-11), en el navegador:
//
//  1. Celular compartido: recepción da de alta a la hija con el celular de su
//     mamá (que ya es socia). Al teclearlo aparece «Comparte celular», no deja
//     dar de alta sin decir quién responde por el número, se elige a la mamá y
//     las dos fichas lo dicen.
//  2. Alta mínima y «Completar datos»: esa alta llevó solo nombre y celular; la
//     ficha dice «Faltan datos» y «Completar datos» ofrece SOLO lo que quedó
//     vacío (no el celular, que ya está).
//  3. Menor por QR: un muchacho de 15 o 16 años llena el formulario en su
//     teléfono, escribe a su tutor y la pantalla le dice «Falta que venga tu
//     papá, mamá o tutor». En la bandeja su alta dice «Falta su tutor» y
//     «Aprobar» está apagado hasta que el tutor firma en el mostrador; la
//     ficha queda con «Su tutor: … · firmó el …».
//
// Datos propios: la mamá «Zavala…» por la API; la hija y el menor nacen en la
// pantalla con nombres de la corrida. Nada compartido cambia.
import { recorrido, socioAlCorriente, celular, letras, hoy, accion, asentado, aparece, PANEL, PORTAL, T } from './lib/index.mjs';

await recorrido('altas-familia', async (r) => {
  const g = await r.api('gerencia');
  const L = letras(4).toLowerCase();
  const telMama = celular();
  const mama = await socioAlCorriente(g, { sede: 'CEN', telefono: telMama });
  const nombreMama = `${mama.firstName} ${mama.lastName}`;
  r.nota(`datos de la corrida: la mamá es ${mama.memberCode}`);
  const rec = await r.como('recepcion');

  // ── 1. La hija, con el celular de la mamá ─────────────────────────────────
  r.paso('celular compartido');
  const hija = `Sofía Z${L}`;
  await rec.goto(`${PANEL}/socios`, { waitUntil: 'networkidle' });
  await rec.locator('input.input-lg').fill(hija);
  await rec.getByRole('button', { name: new RegExp(`Registrar a «${hija}»`) }).first().click();
  const dlg = rec.getByRole('dialog');
  await dlg.locator('#sf-fn').waitFor({ timeout: T.ui });
  r.ok(await dlg.locator('#sf-en').count() === 0 && await dlg.getByTestId('mas-datos').count() === 1, 'el alta pide lo mínimo: el contacto de emergencia está detrás de «Agregar más datos»');
  await dlg.locator('#sf-ph').fill(telMama);
  const comparte = dlg.getByTestId('elegir-responsable');
  r.ok(await aparece(comparte, T.respuesta) && (await comparte.innerText()).includes(nombreMama), `al teclear el celular de la mamá aparece «Comparte celular» y la nombra: «${(await comparte.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 130)}…»`);
  r.ok(await comparte.getByText('¿Quién responde por ese número?').count() === 1, 'y pregunta «¿Quién responde por ese número?»');
  for (const c of await dlg.getByRole('switch').all()) await c.check();
  await r.captura(rec, 'altas-familia-1-comparte');
  // Sin responsable no se da de alta: o el botón está apagado, o el formulario lo dice y no navega.
  const darDeAlta = dlg.getByRole('button', { name: 'Dar de alta' });
  let altas = 0;
  const cuenta = (res) => { if (res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/members' && res.status() < 300) altas++; };
  rec.on('response', cuenta);
  if (await darDeAlta.isEnabled()) { await darDeAlta.click(); await asentado(rec); }
  r.ok(altas === 0 && await dlg.locator('#sf-fn').count() === 1, 'sin decir quién responde por el número no se da de alta');
  await comparte.getByRole('radio', { name: nombreMama }).click();
  const alta = await accion(rec, () => darDeAlta.click(), (url) => new URL(url).pathname === '/api/members', { metodo: 'POST', que: 'el alta de la hija' });
  rec.off('response', cuenta);
  r.ok(alta.ok(), `eligiendo a la mamá, el alta pasa (${alta.status()})`);
  const hijaId = (await alta.json()).id;
  await rec.waitForURL('**/socios/**', { timeout: T.respuesta });
  await rec.getByRole('dialog').getByText('Mensualidad', { exact: true }).waitFor({ timeout: T.respuesta });
  await rec.keyboard.press('Escape');
  const renglon = rec.getByTestId('celular-compartido');
  r.ok(await aparece(renglon.getByText(/Comparte celular con/), T.respuesta) && (await renglon.innerText()).includes(nombreMama) && /Responsable del número/.test(await renglon.innerText()),
    `la ficha de la hija dice: «${(await renglon.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 170)}»`);
  await r.captura(rec, 'altas-familia-2-ficha-hija');

  // ── 2. Alta mínima: «Completar datos» ─────────────────────────────────────
  r.paso('completar datos');
  const faltan = rec.getByTestId('faltan-datos');
  r.ok(await aparece(faltan, T.respuesta) && /contacto de emergencia/i.test(await faltan.innerText()), `la ficha dice lo que el alta mínima dejó vacío: «${(await faltan.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}»`);
  await faltan.getByRole('button', { name: 'Completar datos' }).click();
  const cd = rec.getByRole('dialog', { name: 'Completar datos' });
  await cd.locator('#cd-en').waitFor({ timeout: T.ui });
  r.ok(await cd.locator('#cd-ph').count() === 0 && await cd.locator('#cd-bd').count() === 1 && await cd.locator('#cd-ep').count() === 1, 'el diálogo ofrece solo lo vacío: nacimiento y contacto de emergencia, no el celular');
  r.ok(await cd.getByRole('button', { name: 'Guardar' }).isDisabled(), 'sin escribir nada no hay qué guardar');
  await cd.locator('#cd-en').fill(nombreMama);
  await cd.locator('#cd-ep').fill(telMama);
  await r.captura(rec, 'altas-familia-3-completar');
  const completado = await accion(rec, () => cd.getByRole('button', { name: 'Guardar' }).click(), new RegExp(`/api/members/${hijaId}/`), { metodo: 'POST', que: 'completar datos' });
  r.ok(completado.ok() && await aparece(rec.getByText('Datos completados'), T.respuesta), `recepción completa el contacto de emergencia (${completado.status()})`);
  await asentado(rec);
  const quedan = await faltan.innerText().catch(() => '');
  r.ok(!/contacto de emergencia/i.test(quedan), `y la ficha deja de pedirlo${quedan ? ` (sigue pendiente: «${quedan.replace(/\s+/g, ' ').trim()}»)` : ''}`);

  await rec.goto(`${PANEL}/socios/${mama.id}`, { waitUntil: 'networkidle' });
  r.ok(await aparece(rec.getByTestId('celular-compartido').getByText(/Comparte celular con/), T.respuesta) && (await rec.getByTestId('celular-compartido').innerText()).includes(`Z${L}`), 'la ficha de la mamá también dice con quién comparte el celular');

  // ── 3. Menor por QR ───────────────────────────────────────────────────────
  r.paso('menor en su teléfono');
  const tel = await r.nueva({ movil: true });
  await tel.goto(`${PORTAL}/alta/demo-centro`, { waitUntil: 'networkidle' });
  await tel.getByLabel('Nombre(s)').waitFor({ timeout: T.respuesta });
  const menor = `Emilio${L}`;
  const TUTOR = `Ricardo Zavala ${letras(4)}`;
  await tel.getByLabel('Nombre(s)').fill(menor);
  await tel.getByLabel('Apellidos').fill('Zavala Menor');
  // Quince o dieciséis años, según el día en que se corra.
  await tel.locator('#bd').fill(`15/06/${Number(hoy().slice(0, 4)) - 16}`);
  await tel.locator('#bd').blur();
  const datosTutor = tel.getByTestId('datos-del-tutor');
  r.ok(await aparece(datosTutor, T.ui), 'con un nacimiento de menor, el formulario pide los datos de su papá, mamá o tutor');
  await tel.locator('#tn').fill(TUTOR);
  await tel.locator('#tp').fill(celular());
  await tel.getByLabel('Celular', { exact: true }).fill(celular());
  r.ok(await tel.getByText(/datos de salud/i).count() === 0 || await tel.locator('#hn').count() === 0, 'a un menor no se le pregunta nada de salud');
  const checks = tel.getByRole('checkbox');
  for (let i = 0; i < await checks.count(); i++) await checks.nth(i).check();
  r.ok(await tel.locator('#hn').count() === 0, 'ni aceptando todo aparece la pregunta de salud');
  await r.captura(tel, 'altas-familia-4-menor', { full: true });
  const enviado = await accion(tel, () => tel.getByRole('button', { name: 'Enviar mis datos' }).click(), (url) => /\/intake/.test(new URL(url).pathname), { metodo: 'POST', que: 'el alta del menor' });
  r.ok(enviado.ok(), `el formulario se envía (${enviado.status()})`);
  r.ok(await aparece(tel.getByTestId('falta-tu-tutor'), T.respuesta) && await tel.getByText('Falta que venga tu papá, mamá o tutor').count() === 1, 'y le dice «Falta que venga tu papá, mamá o tutor»');
  const folio = (await tel.getByTestId('folio-alta').locator('.folio-alta-codigo').innerText()).trim();
  await r.captura(tel, 'altas-familia-5-falta-tu-tutor');

  r.paso('el tutor firma en el mostrador');
  await rec.goto(`${PANEL}/altas`, { waitUntil: 'networkidle' });
  await rec.getByLabel('Buscar alta').fill(folio);
  await rec.getByText(menor).first().click();
  await rec.getByRole('heading', { name: new RegExp(menor) }).waitFor({ timeout: T.respuesta });
  const falta = rec.getByTestId('falta-su-tutor');
  r.ok(await aparece(falta.getByText('Falta su tutor', { exact: true }), T.respuesta), `en la bandeja (folio ${folio}) el alta dice «Falta su tutor»`);
  const aprobar = rec.getByRole('button', { name: /^Aprobar/ });
  r.ok(await aprobar.isDisabled() && await rec.getByTestId('espera-tutor').count() === 1, '«Aprobar» está apagado: «Para aprobar, que firme su tutor (arriba).»');
  r.ok(await falta.locator('#tu-nombre').inputValue() === TUTOR, 'el nombre del tutor que escribió el menor llega propuesto');
  await r.captura(rec, 'altas-familia-6-falta-su-tutor', { full: true });
  await falta.getByRole('switch').first().check();
  r.ok(await aprobar.isEnabled(), 'cuando el tutor acepta en el mostrador, «Aprobar» se enciende');
  const aprobada = await accion(rec, () => aprobar.click(), /\/api\/intakes?\/[^/]+\/approve|\/api\/member-intakes\/[^/]+\/approve|\/approve$/, { metodo: 'POST', que: 'la aprobación del alta' });
  r.ok(aprobada.ok() && await aparece(rec.getByText('Alta aprobada'), T.respuesta), `el alta se aprueba con la firma del tutor (${aprobada.status()})`);
  const nuevo = (await g.get(`/members?q=${encodeURIComponent(menor)}`)).members?.[0] ?? (await g.get(`/members?search=${encodeURIComponent(menor)}`)).members?.[0];
  r.ok(!!nuevo, `el menor ya es socio (${nuevo?.memberCode ?? 'no se encontró por la API'})`);
  if (nuevo) {
    await rec.goto(`${PANEL}/socios/${nuevo.id}`, { waitUntil: 'networkidle' });
    const rt = rec.getByTestId('celular-compartido');
    r.ok(await aparece(rt.getByText(/Su tutor/), T.respuesta) && (await rt.innerText()).includes(TUTOR) && /firmó el/.test(await rt.innerText()), `su ficha dice: «${(await rt.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160)}»`);
    await r.captura(rec, 'altas-familia-7-ficha-menor');
  }
});
