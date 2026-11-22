// Captación (fase 2, bloque 2.4; recorrido del bloque 2.14). El buscador de
// identidad avisa, al capturar un interesado, de que ese celular ya es de un
// socio y lleva a su ficha; un interesado nuevo nace «sin contactar», su etapa
// sale del contacto que se le registra, e «Inscribir» lo da de alta y lo saca
// de seguimiento en UNA operación (`POST /prospects/:id/enroll`): queda en
// «Cerrados» como inscrito, ligado a su ficha, y el buscador ya lo conoce como
// socio.
//
// Datos propios: un socio «Zavala …» (el duplicado) y un interesado «Zavala …»
// de esta corrida, que termina inscrito. Si el recorrido se corta antes, el
// interesado se cierra como perdido. Nada compartido cambia.
import { recorrido, crearSocio, celular, letras, accion, aparece, desaparece, asentado, PANEL, T } from './lib/index.mjs';

await recorrido('captacion', async (r) => {
  const g = await r.api('gerencia');
  const L = letras(5);
  const nombre = `Regina${letras(4).toLowerCase()}`;
  const apellidos = `Zavala ${L}`;
  const completo = `${nombre} ${apellidos}`;
  const telInteresado = celular();
  const buscarSuyo = async () => (await g.get(`/prospects?limit=200&q=${encodeURIComponent(nombre)}`)).items.find((x) => x.firstName === nombre);
  r.alFinal(async () => {
    const suyo = await buscarSuyo().catch(() => null);
    if (suyo && suyo.status !== 'LOST' && suyo.status !== 'CONVERTED') await g.post(`/prospects/${suyo.id}/close`, { reasonCode: 'OTRO', note: 'Fin del recorrido' });
  });

  // El «duplicado»: un socio de esta corrida, con su celular.
  const telSocio = celular();
  const socio = await crearSocio(g, { nombre: 'Octavio', apellidos: `Zavala ${letras(5)}`, telefono: telSocio });
  const nombreSocio = `${socio.firstName} ${socio.lastName}`;

  // ── 1. El buscador de identidad avisa de un duplicado ─────────────────────
  r.paso('el buscador de identidad avisa');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  await rec.getByRole('button', { name: 'Nuevo prospecto' }).first().click();
  let d = rec.getByRole('dialog');
  await accion(rec, () => d.getByLabel('Celular').fill(telSocio), '/api/members/check-duplicates', { metodo: 'POST', que: 'la pregunta «¿ya existe?»' });
  const yaExiste = d.getByTestId('ya-existe');
  r.ok(await aparece(yaExiste, T.respuesta), 'al teclear un celular que ya es de un socio, el diálogo avisa «Personas que ya existen»');
  const filaSocio = yaExiste.locator('[data-kind="MEMBER"]').filter({ hasText: nombreSocio });
  r.ok(await filaSocio.count() === 1 && await filaSocio.getByText('Ya es socio').count() === 1, `dice quién es y que ya es socio (${nombreSocio})`);
  const irFicha = filaSocio.getByRole('link', { name: /Ver su ficha/ });
  r.ok(await irFicha.count() === 1 && (await irFicha.getAttribute('href'))?.endsWith(`/socios/${socio.id}`), 'y ofrece «Ver su ficha», que lleva a la ficha de ese socio');
  await r.captura(rec, 'captacion-1-ya-existe');

  // ── 2. Un interesado nuevo ────────────────────────────────────────────────
  r.paso('interesado nuevo');
  // Con un celular que nadie tiene, el aviso se va.
  await accion(rec, () => d.getByLabel('Celular').fill(telInteresado), '/api/members/check-duplicates', { metodo: 'POST', que: 'la pregunta «¿ya existe?»' });
  r.ok(await desaparece(yaExiste, T.respuesta), 'con un celular que nadie tiene, el aviso desaparece');
  await d.getByLabel('Nombre').fill(nombre);
  await d.getByLabel('Apellidos').fill(apellidos);
  await accion(rec, () => d.getByRole('button', { name: 'Registrar' }).click(), /\/api\/prospects$/, { metodo: 'POST', que: 'registrar al interesado' });
  const fila = rec.getByRole('row', { name: new RegExp(nombre) });
  r.ok(await aparece(fila, T.respuesta), 'el interesado nuevo aparece en la bandeja');
  r.ok(await fila.getAttribute('data-etapa') === 'NEW' && await fila.getByRole('button', { name: 'Contactar' }).count() === 1 && await fila.getByRole('button', { name: 'Inscribir' }).count() === 1,
    'nace como nuevo, con «Contactar» e «Inscribir» a la vista');
  const recien = await buscarSuyo();
  r.ok(recien?.queue === 'UNCONTACTED', `para la API está en la cola de «sin contactar» (${recien?.queue})`);

  // ── 3. El contacto pone la etapa ──────────────────────────────────────────
  r.paso('contacto');
  await fila.getByRole('button', { name: 'Contactar' }).click();
  d = rec.getByRole('dialog');
  await d.getByRole('radio', { name: 'En persona' }).click();
  await d.getByRole('radio', { name: 'Le interesa', exact: true }).click();
  await d.getByRole('button', { name: 'Mañana' }).click();
  await accion(rec, () => d.getByRole('button', { name: 'Registrar contacto' }).click(), /\/api\/prospects\/[^/]+\/follow-ups$/, { metodo: 'POST', que: 'el contacto con el interesado' });
  await d.waitFor({ state: 'hidden', timeout: T.ui });
  r.ok(await aparece(fila.getByText('Visitó', { exact: true }), T.respuesta), 'un contacto en persona lo pasa a «Visitó», sin elegir la etapa a mano');
  r.ok(await aparece(fila.getByTestId('ultimo-contacto').filter({ hasText: 'Le interesa' }), T.respuesta) && await fila.getByText(/Próximo:/).count() === 1, 'la fila dice el último contacto («Le interesa») y cuándo vuelve a tocar');
  await r.captura(rec, 'captacion-2-contactado');

  // ── 4. «Inscribir»: alta y salida de seguimiento en una operación ─────────
  r.paso('inscribir');
  await fila.getByRole('button', { name: 'Inscribir' }).click();
  d = rec.getByRole('dialog');
  r.ok(await aparece(d.getByTestId('viene-de-interesado')), 'la inscripción dice que viene de interesado y que al darlo de alta sale de seguimiento');
  r.ok(await d.getByLabel('Nombre(s)').inputValue() === nombre && await d.getByLabel('Apellidos').inputValue() === apellidos && await d.locator('#sf-ph').inputValue() === telInteresado,
    'trae su nombre, sus apellidos y su celular ya puestos');
  await d.getByRole('button', { name: 'Leer texto' }).first().waitFor({ timeout: T.respuesta });
  for (const c of await d.getByRole('switch').all()) await c.check();
  await r.captura(rec, 'captacion-3-inscribir');
  const resp = await accion(rec, () => d.getByRole('button', { name: 'Dar de alta' }).click(), /\/api\/prospects\/[^/]+\/enroll$/, { metodo: 'POST', que: 'inscribir al interesado' });
  r.ok(resp.status() < 300, `el alta y la conversión son una sola petición (POST …/enroll → ${resp.status()})`);
  await rec.waitForURL('**/socios/**', { timeout: T.navegacion });
  const memberId = new URL(rec.url()).pathname.split('/').pop();
  r.ok(await aparece(rec.getByRole('heading', { name: completo }).first(), T.respuesta), 'inscribir lleva a la ficha del socio nuevo');
  const ya = await buscarSuyo();
  r.ok(ya?.status === 'CONVERTED' && ya?.convertedMemberId === memberId, `para la API el interesado quedó inscrito y ligado a esa ficha (${ya?.status})`);

  // ── 5. Queda en «Cerrados», y el buscador ya lo conoce como socio ─────────
  r.paso('cerrados y buscador');
  // La ficha abre con la venta: se cierra sin vender (no es de este recorrido).
  if (await aparece(rec.getByRole('dialog'), T.ui)) await rec.keyboard.press('Escape');
  await rec.goto(`${PANEL}/prospectos`, { waitUntil: 'networkidle' });
  await asentado(rec);
  r.ok(await rec.getByRole('row', { name: new RegExp(nombre) }).count() === 0, 'ya no está en seguimiento');
  await rec.getByRole('button', { name: /^Cerrados/ }).click();
  const cerrada = rec.getByRole('row', { name: new RegExp(nombre) });
  r.ok(await aparece(cerrada, T.respuesta) && await cerrada.getAttribute('data-etapa') === 'CONVERTED' && await cerrada.getByText(/^Se inscribió (justo ahora|hace )/).count() === 1 && await cerrada.getByRole('button', { name: 'Ver ficha' }).count() === 1,
    'en «Cerrados» dice cuándo se inscribió y ofrece «Ver ficha»');
  await r.captura(rec, 'captacion-4-cerrados');
  await rec.getByRole('button', { name: 'Nuevo prospecto' }).first().click();
  d = rec.getByRole('dialog');
  await accion(rec, () => d.getByLabel('Celular').fill(telInteresado), '/api/members/check-duplicates', { metodo: 'POST', que: 'la pregunta «¿ya existe?»' });
  const suFila = d.getByTestId('ya-existe').locator('[data-kind]').filter({ hasText: completo });
  r.ok(await aparece(suFila.first(), T.respuesta) && await suFila.count() === 1 && await suFila.getAttribute('data-kind') === 'MEMBER',
    'quien intente capturarlo otra vez como interesado lo encuentra una sola vez, y como socio');
  await d.getByRole('button', { name: 'Cancelar', exact: true }).click();
}, { erroresDePagina: 'falla' });
