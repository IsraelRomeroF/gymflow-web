// Interesados (fase 4, bloque 4.7 · D-31), vistos en el navegador:
//
//  1. Recepción registra un interesado con «¿Qué plan le interesa?»: la fila
//     dice «Le interesa: …».
//  2. «Inscribir» → alta → la venta abre con ESE plan marcado.
//  3. Un interesado de 70 días sin contacto: el aviso de arriba lo cuenta y su
//     fila dice «Se cierra solo…» (el cierre en sí es del job de la noche y no
//     se corre aquí: cerraría a todos los de la base de pruebas).
//  4. El QR de la sucursal (portal `/alta/demo-centro`): «Planes y precios en
//     Centro», con los precios de lista que da la API.
//
// Los interesados son de la corrida (apellido con su sufijo) y al terminar se
// cierran; el socio que nace de «Inscribir» se queda sin membresía (no se vende).
import { recorrido, sedeDe, accion, asentado, aparece, sql, letras, celular, PANEL, PORTAL, API, T } from './lib/index.mjs';

await recorrido('interesados', async (r) => {
  const g = await r.api('gerencia');
  const L = letras(5);
  const APELLIDO = `Zavala ${L}`;
  const cen = await sedeDe(g, 'CEN');
  r.alFinal(async () => {
    const { items } = await g.get('/prospects?limit=200&open=true');
    for (const p of items.filter((x) => x.lastName === APELLIDO && x.status !== 'LOST' && x.status !== 'CONVERTED')) {
      await g.post(`/prospects/${p.id}/close`, { reasonCode: 'OTRO', note: 'Fin del recorrido' });
    }
  });

  // ── 1. Interesado con plan de interés ─────────────────────────────────────
  r.paso('plan de interés');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  await rec.getByRole('button', { name: 'Nuevo prospecto' }).first().click();
  const d = rec.getByRole('dialog');
  await d.getByLabel('Nombre').fill('Marisol');
  await d.getByLabel('Apellidos').fill(APELLIDO);
  await d.getByLabel('Celular').fill(celular());
  const select = d.getByLabel('¿Qué plan le interesa?');
  await select.locator('option').nth(1).waitFor({ state: 'attached', timeout: T.respuesta });
  const opciones = await select.locator('option').evaluateAll((os) => os.map((o) => ({ value: o.value, texto: o.textContent.trim() })).filter((o) => o.value));
  // El segundo plan de la lista (el primero suele ser el que abre por omisión): así se nota que la venta abre con el elegido.
  const elegido = opciones[1] ?? opciones[0];
  r.ok(opciones.length >= 2 && opciones.every((o) => /\$[\d,]+/.test(o.texto)), `«¿Qué plan le interesa?» trae los planes de la sucursal con su precio (${opciones.length}: «${opciones.slice(0, 3).map((o) => o.texto).join('», «')}»…)`);
  await select.selectOption(elegido.value);
  const planNombre = elegido.texto.split(' · ')[0];
  await r.captura(rec, 'interesados-1-plan');
  await accion(rec, () => d.getByRole('button', { name: 'Registrar' }).click(), '/api/prospects', { metodo: 'POST', que: 'el interesado' });
  const fila = rec.getByRole('row', { name: new RegExp(`Marisol ${APELLIDO}`) });
  await fila.waitFor({ timeout: T.respuesta });
  r.ok((await fila.getByTestId('plan-de-interes').innerText()).trim() === `Le interesa: ${planNombre}`, `la fila dice «Le interesa: ${planNombre}»`);

  // ── 2. «Inscribir»: la venta abre con ese plan ────────────────────────────
  r.paso('inscribir');
  await fila.getByRole('button', { name: 'Inscribir' }).click();
  const alta = rec.getByRole('dialog');
  r.ok((await alta.locator('#sf-fn').inputValue()) === 'Marisol' && (await alta.locator('#sf-ln').inputValue()) === APELLIDO, 'el alta nace con sus datos');
  await alta.getByRole('button', { name: 'Leer texto' }).first().waitFor({ timeout: T.respuesta });
  for (const c of await alta.getByRole('switch').all()) if (!(await c.isChecked())) await c.check();
  await alta.getByRole('button', { name: 'Dar de alta' }).click();
  await rec.waitForURL(new RegExp(`/socios/[0-9a-f-]{36}\\?vender=1&plan=${elegido.value}`), { timeout: T.navegacion });
  r.ok(true, 'al dar de alta lleva a la ficha con la venta abierta y el plan que preguntó en la dirección');
  const venta = rec.getByRole('dialog');
  const marcado = venta.locator('button.choice[aria-pressed="true"]');
  await marcado.first().waitFor({ timeout: T.respuesta });
  r.ok((await marcado.count()) === 1 && (await marcado.innerText()).includes(planNombre), `la venta amanece con «${planNombre}» marcado`);
  await r.captura(rec, 'interesados-2-venta-con-su-plan');
  await rec.keyboard.press('Escape');
  const convertido = (await g.get(`/prospects?limit=200&view=closed`)).items.find((x) => x.lastName === APELLIDO && x.firstName === 'Marisol');
  r.ok(convertido?.status === 'CONVERTED', `el interesado queda inscrito (${convertido?.status})`);

  // ── 3. El aviso del cierre solo ───────────────────────────────────────────
  r.paso('cierre solo');
  const antes = await g.get('/prospects/auto-close');
  const viejo = await g.post('/prospects', { firstName: 'Teodoro', lastName: APELLIDO, phoneE164: `+52${celular()}`, branchId: cen.id });
  // Lo único que la API no deja: que hayan pasado 70 días desde que se registró.
  await sql(`update prospects set "createdAt" = now() - interval '70 days' where id = $1`, [viejo.id]);
  const despues = await g.get('/prospects/auto-close');
  r.ok(despues.due === antes.due + 1, `la API lo cuenta para el cierre solo (${antes.due} → ${despues.due})`);
  await rec.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  const aviso = rec.getByTestId('aviso-cierre-solo');
  r.ok(await aparece(aviso, T.respuesta) && /se van? a cerrar solos?/.test(await aviso.innerText()) && /60 días o más sin contacto/.test(await aviso.innerText()), `arriba: «${(await aviso.innerText().catch(() => '')).split('\n')[0]}»`);
  const suya = rec.getByRole('row', { name: new RegExp(`Teodoro ${APELLIDO}`) });
  await suya.waitFor({ timeout: T.respuesta });
  const insignia = suya.getByTestId('se-cierra-solo');
  r.ok(await aparece(insignia, T.ui) && /Se cierra solo/.test(await insignia.innerText()), `su fila: «${(await insignia.innerText().catch(() => '')).trim()}»`);
  await r.captura(rec, 'interesados-3-cierre-solo');
  // Contactarlo lo saca de la cuenta.
  await suya.getByRole('button', { name: 'Contactar' }).click();
  const c = rec.getByRole('dialog');
  await c.getByRole('radio', { name: 'Llamada' }).click();
  await c.getByRole('radio', { name: 'No contestó', exact: true }).click();
  await accion(rec, () => c.getByRole('button', { name: 'Registrar contacto' }).click(), `/api/prospects/${viejo.id}/follow-ups`, { metodo: 'POST', que: 'el contacto' });
  await asentado(rec);
  const luego = await g.get('/prospects/auto-close');
  r.ok(luego.due === antes.due, `contactarlo lo saca de la cuenta (${despues.due} → ${luego.due})`);

  // ── 4. El QR de la sucursal: planes y precios ─────────────────────────────
  r.paso('planes en el QR');
  const forma = await (await fetch(`${API}/intake/demo-centro/form`)).json();
  const tel = await r.nueva({ movil: true });
  await tel.goto(`${PORTAL}/alta/demo-centro`, { waitUntil: 'networkidle' });
  const planes = tel.getByTestId('planes-de-la-sede');
  await planes.waitFor({ timeout: T.respuesta });
  // textContent: el título va en versalitas por estilo (innerText lo daría en mayúsculas).
  const titulo = (await planes.locator('#planes-alta-titulo').textContent()).trim();
  r.ok(titulo === `Planes y precios en ${cen.name}`, `«${titulo}»`);
  const filas = await planes.locator('li.planes-alta-fila').evaluateAll((ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ').trim()));
  const pesosSin = (c) => `$${(Number(c) / 100).toLocaleString('en-US')}`;
  const deLaApi = (forma.plans ?? []).map((p) => ({ nombre: p.name, precio: pesosSin(p.priceCents) }));
  r.ok(deLaApi.length > 0 && filas.length === deLaApi.length && deLaApi.every((p, i) => filas[i].includes(p.nombre) && filas[i].includes(p.precio)), `cada plan con su precio de lista, igual que la API (${filas.slice(0, 2).join(' | ')})`);
  r.ok(/tu plan lo eliges en recepción/.test(await planes.innerText()), 'y dice que el plan se elige en recepción');
  const arriba = await tel.evaluate(() => {
    const p = document.querySelector('[data-testid="planes-de-la-sede"]');
    const datos = [...document.querySelectorAll('h1, h2, p, legend')].find((e) => /Tus datos/.test(e.textContent ?? ''));
    return !!p && !!datos && (p.compareDocumentPosition(datos) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  r.ok(arriba, 'van arriba de «Tus datos»');
  await r.captura(tel, 'interesados-4-qr-planes', { full: true });
}, { erroresDePagina: 'informa' });
