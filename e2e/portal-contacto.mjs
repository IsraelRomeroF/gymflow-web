// El socio cambia su contacto desde el portal (fase 4, bloque 4.8 · D-36).
// Sale del guion con que el bloque lo miró a mano (fase4/4.8-capturas/mirar.mjs.txt),
// con socios propios de la corrida:
//
//  1. «Tus datos» enseña el celular y el correo a medias y dice qué NO se cambia.
//  2. Cambiar el celular: vacío, cada campo dice qué falta; con el celular de
//     antes equivocado, el error sale en su campo; bien escrito, cambia.
//  3. Poner el celular de otro socio: pide quién responde, sin decir de quién es.
//  4. Correo y contacto de emergencia.
//  5. El tope (3 cambios de celular en 30 días): la hoja lo dice y no ofrece «Guardar».
//  6. La campana del socio: «Tu celular cambió».
//  7. Recepción: el renglón en «Hoy te toca», el aviso en la ficha con el
//     antes y el después, y «Ya lo confirmé con …» lo quita.
//
// Los dos socios son de la corrida; si se cae a medias, lo que quede por
// confirmar se confirma por la API (no se queda en el Inicio de recepción).
import { recorrido, crearSocio, invitacionPortal, celular, aparece, desaparece, PANEL, PORTAL, T } from './lib/index.mjs';

await recorrido('portal-contacto', async (r) => {
  const g = await r.api('gerencia');
  const rcp = await r.api('recepcion');
  const telA = celular();
  const telB = celular();
  const telNuevo = celular();
  const telCuarto = celular();
  const a = await crearSocio(g, { telefono: telA });
  const b = await crearSocio(g, { telefono: telB });
  r.alFinal(async () => {
    const { changes } = await rcp.get(`/members/${a.id}/contact-changes`);
    if (changes.some((c) => !c.reviewedAt)) await rcp.post(`/members/${a.id}/contact-changes/review`, {});
  });
  const pedazo = (t) => `•• •••• ${t.slice(-4)}`;

  // ── 1. Tus datos ──────────────────────────────────────────────────────────
  r.paso('tus datos');
  const p = await r.nueva({ movil: true });
  await p.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await p.locator('input').first().fill(await invitacionPortal(g, a));
  await p.getByRole('button', { name: /Activar/ }).click();
  await p.waitForURL(`${PORTAL}/`, { timeout: T.navegacion });
  await p.goto(`${PORTAL}/cuenta`, { waitUntil: 'networkidle' });
  const datos = p.getByTestId('tus-datos');
  await datos.getByText('Celular').first().waitFor({ timeout: T.respuesta });
  r.ok(await p.getByTestId('dato-celular').getByText(pedazo(telA)).count() === 1, `el celular se ve a medias («${pedazo(telA)}»)`);
  r.ok(!(await datos.innerText()).includes(telA), 'el número completo no está en pantalla');
  r.ok(await p.getByTestId('dato-correo').getByText('Sin correo').count() === 1, 'sin correo lo dice');
  r.ok(/Tu nombre, tu fecha de nacimiento, tu CURP, tu plan y tu coach no se cambian desde el teléfono/.test(await p.getByTestId('lo-que-no-cambias').innerText()), 'dice lo que NO se cambia desde el teléfono');
  await r.captura(p, 'portal-contacto-1-tus-datos', { full: true });

  // ── 2. Cambiar el celular ─────────────────────────────────────────────────
  r.paso('cambiar el celular');
  await p.getByTestId('dato-celular').getByRole('button', { name: 'Cambiar' }).click();
  const hoja = p.getByTestId('hoja-celular');
  await hoja.waitFor({ timeout: T.ui });
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(hoja.getByText('Escribe los 10 dígitos de tu celular nuevo.'), T.ui), 'vacío: cada campo dice qué le falta');
  await p.getByLabel('Tu celular nuevo').fill(telNuevo);
  await p.getByLabel('Tu celular actual, completo').fill(telA === '5500000001' ? '5500000002' : '5500000001');
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(hoja.getByText(/Ese no es el celular que tenemos registrado/), T.respuesta), 'con el celular de antes equivocado, el error sale en su campo');
  await r.captura(p, 'portal-contacto-2-confirmacion-fallida');
  await p.getByLabel('Tu celular actual, completo').fill(`${telA.slice(0, 2)} ${telA.slice(2, 6)} ${telA.slice(6)}`);
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(p.getByText('Listo: tu celular ya cambió. Recepción recibió el aviso.'), T.respuesta), 'bien escrito (con espacios), cambia: «Listo: tu celular ya cambió. Recepción recibió el aviso.»');
  r.ok(await aparece(p.getByTestId('dato-celular').getByText(pedazo(telNuevo)), T.respuesta), 'y la tarjeta enseña la terminación nueva');
  const enLaFicha = await g.get(`/members/${a.id}`);
  r.ok(enLaFicha.phoneE164 === `+52${telNuevo}`, 'la ficha del socio ya tiene el celular nuevo');

  // ── 3. El celular de otro socio ───────────────────────────────────────────
  r.paso('celular de otro socio');
  await p.getByTestId('dato-celular').getByRole('button', { name: 'Cambiar' }).click();
  await p.getByLabel('Tu celular nuevo').fill(telB);
  await p.getByLabel('Tu celular actual, completo').fill(telNuevo);
  await p.getByRole('button', { name: 'Guardar' }).click();
  const enUso = p.getByTestId('celular-en-uso');
  await enUso.waitFor({ timeout: T.respuesta });
  const textoEnUso = await enUso.innerText();
  r.ok(!textoEnUso.includes(b.firstName) && !textoEnUso.includes(b.lastName) && !textoEnUso.includes(b.memberCode), 'pide quién responde por ese número sin decir de quién es');
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(enUso.getByText('Dinos quién responde por ese número.'), T.ui), 'sin elegir, lo pide');
  await enUso.getByRole('button', { name: 'Yo: es mi número' }).click();
  await r.captura(p, 'portal-contacto-3-celular-en-uso');
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(p.getByText(/quedó anotado que lo compartes/), T.respuesta) && await aparece(p.getByTestId('celular-compartido'), T.respuesta), 'se guarda diciendo quién responde, y la pantalla lo dice sin nombres');

  // ── 4. Correo y contacto de emergencia ────────────────────────────────────
  r.paso('correo y emergencia');
  const correo = `socio.${a.memberCode.toLowerCase().replace(/[^a-z0-9]/g, '')}@correo.invalid`;
  await p.getByTestId('dato-correo').getByRole('button', { name: 'Agregar' }).click();
  await p.getByTestId('hoja-correo').waitFor({ timeout: T.ui });
  await p.getByLabel('Tu correo nuevo').fill(correo);
  await p.getByLabel('Tu celular actual, completo').fill(telB);
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(p.getByText('Listo: tu correo ya cambió. Recepción recibió el aviso.'), T.respuesta), 'el correo se agrega con la confirmación del celular');
  r.ok(await aparece(p.getByTestId('dato-correo').getByText(`${correo.slice(0, 2)}•••@correo.invalid`), T.respuesta), 'y se ve a medias');
  await p.getByTestId('dato-emergencia').getByRole('button', { name: 'Agregar' }).click();
  await p.getByTestId('hoja-emergencia').waitFor({ timeout: T.ui });
  await p.getByLabel('Su nombre').fill('Rosa Luna Prueba');
  await p.getByLabel('Su teléfono').fill('9911112222');
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(p.getByText('Listo: tu contacto de emergencia quedó guardado.'), T.respuesta), 'el contacto de emergencia se guarda sin confirmación');
  r.ok(await aparece(p.getByTestId('dato-emergencia').getByText(/Rosa Luna Prueba · 99 1111 2222/), T.respuesta), 'y se ve completo');

  // ── 5. El tope ────────────────────────────────────────────────────────────
  r.paso('tope');
  await p.getByTestId('dato-celular').getByRole('button', { name: 'Cambiar' }).click();
  await p.getByLabel('Tu celular nuevo').fill(telCuarto);
  await p.getByLabel('Tu celular actual, completo').fill(telB);
  await p.getByRole('button', { name: 'Guardar' }).click();
  r.ok(await aparece(p.getByText('Listo: tu celular ya cambió. Recepción recibió el aviso.'), T.respuesta), 'el tercer cambio de celular pasa');
  await p.getByTestId('dato-celular').getByText(pedazo(telCuarto)).waitFor({ timeout: T.respuesta });
  await p.getByTestId('dato-celular').getByRole('button', { name: 'Cambiar' }).click();
  r.ok(await aparece(p.getByText(/Ya cambiaste tu celular 3 veces en 30 días/), T.respuesta), 'el cuarto: «Ya cambiaste tu celular 3 veces en 30 días…»');
  r.ok(await p.getByRole('button', { name: 'Guardar' }).count() === 0, 'y la hoja no ofrece «Guardar»');
  await r.captura(p, 'portal-contacto-4-tope');
  await p.getByRole('button', { name: 'Cancelar' }).click();

  // ── 6. La campana del socio ───────────────────────────────────────────────
  r.paso('campana');
  await p.goto(`${PORTAL}/`, { waitUntil: 'networkidle' });
  const campana = p.getByRole('button', { name: /Avisos/ }).first();
  if (await campana.count()) await campana.click();
  r.ok(await aparece(p.getByText('Tu celular cambió').first(), T.respuesta), 'el socio ve en su campana «Tu celular cambió»');

  // ── 7. Recepción ──────────────────────────────────────────────────────────
  r.paso('recepción');
  const rec = await r.como('recepcion');
  const renglon = rec.locator('[data-asunto="contactChanges"]');
  r.ok(await aparece(renglon, T.respuesta), '«Hoy te toca» de recepción trae el renglón del cambio de contacto');
  r.ok(/cambió su celular o su correo desde su teléfono|cambiaron su celular o su correo/i.test(await renglon.innerText()), `«${(await renglon.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160)}»`);
  await rec.goto(`${PANEL}/socios/${a.id}`, { waitUntil: 'networkidle' });
  const aviso = rec.getByTestId('contacto-cambiado');
  await aviso.waitFor({ timeout: T.respuesta });
  const texto = await aviso.innerText();
  r.ok(/cambió sus datos de contacto desde su teléfono/.test(texto) && texto.includes(correo), 'la ficha dice qué cambió, con el antes y el después');
  // El aviso de «celular compartido» habla del celular que tiene HOY: el último cambio (el del tope) ya no es compartido.
  r.ok(texto.replace(/\s/g, '').includes(telB) && !/también es el de otro socio/.test(texto), 'lista también el paso por el celular compartido, y no lo da por compartido hoy (su último celular es solo suyo)');
  await aviso.scrollIntoViewIfNeeded();
  await r.captura(rec, 'portal-contacto-5-ficha');
  await aviso.getByRole('button', { name: /Ya lo confirmé con/ }).click();
  r.ok(await desaparece(aviso, T.respuesta), '«Ya lo confirmé con …» quita el aviso');
  const { changes } = await rcp.get(`/members/${a.id}/contact-changes`);
  r.ok(changes.length >= 4 && changes.every((c) => c.reviewedAt), `y la API los da por confirmados (${changes.length})`);
}, { erroresDePagina: 'informa' });
