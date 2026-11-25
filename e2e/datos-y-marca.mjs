// Datos y marca del gimnasio (fase 4, bloque 4.6 · D-27), de punta a punta:
//
//  1. El gerente, en «Mi gimnasio», abre «Pedir un cambio a GymFlow»: vacío,
//     cada campo dice qué falta; un teléfono de 3 dígitos lo rechaza la API y
//     el error sale en el pie; el horario de Norte se manda y queda «Pendiente».
//  2. La consola lo ve en su portada («Cambios que pidieron los gimnasios») y
//     en la ficha de la marca; aplica el horario con una respuesta y rechaza
//     otra solicitud (sin respuesta no deja).
//  3. El gerente ve arriba del panel «GymFlow aplicó el cambio que pediste»;
//     en «Mi gimnasio» el horario ya cambió y está la respuesta; el aviso se va.
//  4. Recepción no ve «Mi gimnasio» y la API no le deja pedir cambios.
//
// El horario de Norte es del gimnasio entero: al terminar (pase lo que pase)
// vuelve a como estaba, y lo que esta corrida dejó pendiente se rechaza.
import { recorrido, sedeDe, accion, asentado, aparece, desaparece, sql, letras, CLAVE_PRUEBAS, PANEL, T } from './lib/index.mjs';

await recorrido('datos-y-marca', async (r) => {
  const g = await r.api('gerente');
  const rcp = await r.api('recepcion');
  const pla = await r.api('plataforma');
  await pla.post('/platform/reauth', { password: CLAVE_PRUEBAS });
  const L = letras(4);
  const nor = await sedeDe(g, 'NOR');
  const [{ horario: horarioDeAntes, org }] = await sql(`select b."openingHours" as horario, b."organizationId" as org from branches b where b.id = $1`, [nor.id]);
  const HORARIO = `Lunes a viernes de 6:00 a 22:00; sábado de 8:00 a 14:00 (${L})`;
  const RESPUESTA = `Listo, ya quedó el horario nuevo (${L})`;
  const OTRO = `Contratar el módulo de clases para Norte (${L})`;

  /** Lo que esta corrida (u otra que se cayó) dejó pendiente en estos dos datos: se rechaza por la consola. */
  const rechazarPendientes = async () => {
    const { requests } = await pla.get('/platform/change-requests');
    for (const s of requests.filter((x) => x.organizationId === org && x.status === 'PENDING' && (x.field === 'BRANCH_HOURS' || x.field === 'OTHER' || x.field === 'PHONE'))) {
      await pla.post(`/platform/change-requests/${s.id}/reject`, { response: 'Cierre de un recorrido de prueba' });
    }
  };
  await rechazarPendientes();
  r.alFinal(async () => {
    await rechazarPendientes();
    await sql(`update branches set "openingHours" = $2 where id = $1`, [nor.id, horarioDeAntes]);
  });

  // ── 1. El gerente pide el cambio ──────────────────────────────────────────
  r.paso('pedir el cambio');
  const ger = await r.como('gerente');
  await ger.goto(`${PANEL}/gimnasio`, { waitUntil: 'networkidle' });
  await ger.getByRole('button', { name: 'Pedir un cambio a GymFlow' }).click();
  const d = ger.getByRole('dialog', { name: 'Pedir un cambio a GymFlow' });
  await d.getByTestId('pedir-cambio').waitFor({ timeout: T.ui });
  await d.getByLabel('Qué dato').selectOption({ label: 'Teléfono del gimnasio' });
  await d.getByRole('button', { name: 'Mandar solicitud' }).click();
  r.ok(await aparece(d.getByText('Escribe el valor nuevo.'), T.ui) && await d.getByText('Di por qué cambia: GymFlow lo lee antes de aplicarlo.').count() === 1, 'vacío no se manda: el valor y el motivo dicen qué les falta');
  await d.getByLabel('Valor nuevo').fill('123');
  await d.getByLabel('Por qué cambia').fill('Cambió el número');
  const malo = await accion(ger, () => d.getByRole('button', { name: 'Mandar solicitud' }).click(), '/api/gym-change-requests', { metodo: 'POST', que: 'el teléfono inválido' });
  r.ok(malo.status() >= 400 && malo.status() < 500, `un teléfono de 3 dígitos no pasa (${malo.status()})`);
  const pie = d.getByTestId('error-del-dialogo');
  r.ok(await aparece(pie, T.ui) && /10 dígitos|teléfono|celular/i.test(await pie.innerText()), `y el error sale en el pie del diálogo: «${(await pie.innerText().catch(() => '')).trim().slice(0, 140)}»`);
  await d.getByLabel('Qué dato').selectOption({ label: 'Horario de una sucursal' });
  await d.getByLabel('De qué sucursal').selectOption({ label: nor.name });
  r.ok(await aparece(d.getByTestId('pc-hoy'), T.ui), `dice cómo está hoy: «${(await d.getByTestId('pc-hoy').innerText()).trim().slice(0, 120)}»`);
  await d.getByLabel('Valor nuevo').fill(HORARIO);
  await d.getByRole('group', { name: 'De un toque' }).getByRole('button', { name: 'Cambiamos de horario' }).click();
  await r.captura(ger, 'datos-y-marca-1-pedir');
  const pedida = await accion(ger, () => d.getByRole('button', { name: 'Mandar solicitud' }).click(), '/api/gym-change-requests', { metodo: 'POST', que: 'la solicitud' });
  r.ok(pedida.ok(), `la solicitud sale (${pedida.status()})`);
  r.ok(await aparece(ger.getByText('Solicitud enviada a GymFlow. El dato cambia cuando la apliquen.'), T.respuesta), 'avisa «Solicitud enviada a GymFlow. El dato cambia cuando la apliquen.»');
  await asentado(ger);
  const lista = ger.getByTestId('solicitudes-a-gymflow');
  const mia = lista.locator('li[data-solicitud]').filter({ hasText: HORARIO });
  r.ok(await aparece(mia, T.respuesta) && await mia.getAttribute('data-solicitud') === 'PENDING' && /GymFlow todavía no contesta\. El dato sigue como estaba\./.test(await mia.innerText()), 'queda «Pendiente» en «Solicitudes a GymFlow»: el dato sigue como estaba');
  r.ok(!(await ger.getByTestId('contacto-de-sucursales').innerText()).includes(HORARIO), 'pedirlo no cambia el horario');
  // Otra, por la API, para el camino de «Rechazar».
  await g.post('/gym-change-requests', { field: 'OTHER', branchId: null, value: OTRO, reason: 'Lo queremos para la sucursal nueva' });

  // ── 2. La consola aplica una y rechaza la otra ────────────────────────────
  r.paso('la consola');
  const p = await r.como('plataforma');
  const portada = p.getByTestId('solicitudes-pendientes');
  await portada.waitFor({ timeout: T.respuesta });
  const enPortada = portada.locator('li[data-solicitud-pendiente="BRANCH_HOURS"]').filter({ hasText: HORARIO });
  r.ok(await aparece(enPortada, T.respuesta) && (await enPortada.innerText()).includes('Gimnasio Demo'), 'la portada de la consola trae «Cambios que pidieron los gimnasios» con la solicitud');
  await enPortada.getByRole('link', { name: 'Ver solicitud' }).click();
  await p.waitForURL(`**/plataforma/${org}**`, { timeout: T.navegacion });
  const solicitudes = p.getByTestId('solicitudes-de-cambio');
  const fila = solicitudes.locator('li[data-solicitud="PENDING"]').filter({ hasText: HORARIO });
  await fila.waitFor({ timeout: T.respuesta });
  r.ok(/Héctor Salinas/.test(await fila.innerText()), 'en la ficha de la marca, con quién la pidió');
  r.ok(await p.getByTestId('ficha-de-marca').count() === 1, 'la ficha trae «Datos y marca»');
  await fila.getByRole('button', { name: 'Aplicar' }).click();
  const ap = p.getByRole('dialog', { name: new RegExp(`^Aplicar: Horario de una sucursal · ${nor.name}`) });
  await ap.getByTestId('aplicar-solicitud').waitFor({ timeout: T.ui });
  r.ok((await ap.locator('#as-valor').inputValue()) === HORARIO, 'el diálogo trae el valor pedido, para corregirlo si hace falta');
  await ap.getByLabel('Respuesta para quien la pidió (opcional)').fill(RESPUESTA);
  await r.captura(p, 'datos-y-marca-2-aplicar');
  const aplicada = await accion(p, () => ap.getByRole('button', { name: 'Aplicar cambio' }).click(), /\/api\/platform\/change-requests\/[^/]+\/apply$/, { metodo: 'POST', que: 'aplicar' });
  r.ok(aplicada.ok(), `se aplica (${aplicada.status()})`);
  r.ok(await aparece(p.getByText('Cambio aplicado: quien lo pidió ya lo ve en su panel.'), T.respuesta), 'avisa «Cambio aplicado: quien lo pidió ya lo ve en su panel.»');
  await asentado(p);
  r.ok(await aparece(solicitudes.locator('li[data-solicitud="APPLIED"]').filter({ hasText: HORARIO }), T.respuesta), 'queda «Aplicada» en la ficha');
  const otra = solicitudes.locator('li[data-solicitud="PENDING"]').filter({ hasText: OTRO });
  await otra.getByRole('button', { name: 'Rechazar' }).click();
  const rz = p.getByRole('dialog', { name: /^Rechazar: Otro dato/ });
  await rz.getByRole('button', { name: 'Rechazar solicitud' }).click();
  r.ok(await aparece(rz.getByText('Di por qué no se aplica: quien la pidió lee tu respuesta.'), T.ui), 'rechazar sin respuesta no deja: la pide');
  await rz.getByLabel('Respuesta para quien la pidió').fill(`Eso se contrata con tu asesor (${L})`);
  await accion(p, () => rz.getByRole('button', { name: 'Rechazar solicitud' }).click(), /\/api\/platform\/change-requests\/[^/]+\/reject$/, { metodo: 'POST', que: 'rechazar' });
  r.ok(await aparece(solicitudes.locator('li[data-solicitud="REJECTED"]').filter({ hasText: OTRO }), T.respuesta), 'queda «Rechazada»');

  // ── 3. El gerente ve la respuesta ─────────────────────────────────────────
  r.paso('el gerente ve la respuesta');
  await ger.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
  const aviso = ger.getByTestId('aviso-solicitud');
  r.ok(await aparece(aviso, T.respuesta), 'arriba del panel sale el aviso de la respuesta de GymFlow');
  const textoAviso = (await aviso.innerText()).replace(/\s+/g, ' ');
  r.ok(/GymFlow (no )?aplicó el cambio que pediste/.test(textoAviso) && (textoAviso.includes(RESPUESTA) || textoAviso.includes('Eso se contrata con tu asesor')) && /Y 1 respuesta más/.test(textoAviso), `«${textoAviso.slice(0, 220)}»`);
  await r.captura(ger, 'datos-y-marca-3-aviso');
  await aviso.getByRole('link', { name: 'Ver en Mi gimnasio' }).click();
  await ger.waitForURL('**/gimnasio', { timeout: T.navegacion });
  const sedeNorte = ger.getByTestId('contacto-de-sucursales').locator('li').filter({ hasText: nor.name });
  r.ok(await aparece(sedeNorte.getByText(HORARIO), T.respuesta), `en «Mi gimnasio» el horario de ${nor.name} ya es el nuevo`);
  const aplicadaPanel = ger.getByTestId('solicitudes-a-gymflow').locator('li[data-solicitud="APPLIED"]').filter({ hasText: HORARIO });
  r.ok((await aplicadaPanel.getByTestId('respuesta-de-gymflow').innerText()).includes(RESPUESTA), 'y la respuesta de GymFlow está en su solicitud');
  const rechazadaPanel = ger.getByTestId('solicitudes-a-gymflow').locator('li[data-solicitud="REJECTED"]').filter({ hasText: OTRO });
  r.ok((await rechazadaPanel.getByTestId('respuesta-de-gymflow').innerText()).includes('Eso se contrata con tu asesor'), 'la rechazada también, con su porqué');
  await asentado(ger);
  await ger.goto(`${PANEL}/panel`, { waitUntil: 'networkidle' });
  await asentado(ger);
  r.ok(await desaparece(ger.getByTestId('aviso-solicitud'), T.respuesta), 'abierta «Mi gimnasio», el aviso ya no sale');

  // ── 4. Recepción ──────────────────────────────────────────────────────────
  r.paso('recepción');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/gimnasio`, { waitUntil: 'networkidle' });
  r.ok(await aparece(rec.getByText('Tu rol no ve esta pantalla'), T.respuesta), 'recepción en /gimnasio: «Tu rol no ve esta pantalla»');
  r.ok(await rec.getByTestId('aviso-solicitud').count() === 0, 'y a ella no le sale ningún aviso');
  const ajena = await rcp.crudo('POST', '/gym-change-requests', { field: 'PHONE', branchId: null, value: '5512345678', reason: 'Lo intenta recepción' });
  r.ok(ajena.status === 403, `la API no le deja pedir cambios (${ajena.status})`);
}, { erroresDePagina: 'informa' });
