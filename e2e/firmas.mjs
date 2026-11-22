// Firmas a distancia (auditoría 8, fase 0.9: 20-01, 29-01, 29-03, 29-04, 29-06).
// Rechazo: el gerente pide un retiro al teléfono de la dueña, ella no lo
// autoriza con un motivo y el mostrador lo ve sin registrar nada. Vencimiento:
// solo cuando el servidor dice que venció. Cierre de mes: el gerente lo pide al
// teléfono y la dueña lo firma desde /autorizaciones; el mes se cierra solo.
//
// La vigencia de una solicitud (10 minutos) no se acorta sin tocar código: no
// hay variable que la lea (pendiente de 0.1). Para no esperar 10 minutos, el
// recorrido adelanta el reloj de ESA solicitud en gymflow_pruebas (lib/base.mjs):
// es justo lo que haría el paso del tiempo. A mano: pedir y esperar 10 minutos.
//
// Ya no necesita la base regenerada (fase 1.17a): el mes pasado que cierra lo
// vuelve a abrir al terminar (borra en gymflow_pruebas el cierre que hizo), y
// si al empezar ya estaba cerrado —una corrida que no terminó—, lo abre antes.
// Así se repite, y `cumplimiento` puede cerrar ese mes por su cuenta.
import { recorrido, respuesta, respuestas, asentado, aparece, sql, hoy, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('firmas', async (r) => {
  const json = (p, url, init) => p.evaluate(async ([u, i]) => { const x = await fetch(u, i); return { status: x.status, body: await x.json().catch(() => null) }; }, [url, init]);
  const solicitud = (p) => respuesta(p, '/api/approvals/requests', { metodo: 'POST', que: 'la solicitud de firma' }).then((x) => x.json());
  const sufijo = Date.now().toString(36).slice(-4);
  const MOT_NO = `Retiro que la dueña no autoriza ${sufijo}`;
  const [y, m] = hoy().split('-').map(Number);
  const mesPasado = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const cerrarDeNuevo = () => sql(`delete from monthly_closes where month = $1::date
      and "organizationId" = (select id from organizations where "tradeName" = 'Gimnasio Demo') returning id`, [mesPasado]);

  // Lo que este recorrido pida y quede sin contestar se cancela al terminar,
  // para que ninguna solicitud suya se quede en la bandeja de la dueña.
  const pedidas = [];
  r.alFinal(async () => {
    const gte = await r.api('gerente');
    for (const id of pedidas) {
      const s = await gte.get(`/approvals/requests/${id}`).catch(() => null);
      if (s?.status === 'PENDING') await gte.post(`/approvals/requests/${id}/cancel`, {});
    }
  });

  const ger = await r.como('gerente');
  const duena = await r.como('duena', { movil: true });

  /** Abre el retiro en Caja y lo pide al teléfono de la dueña. Devuelve la solicitud que creó el servidor. */
  async function pedirRetiro(importe, motivo) {
    await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
    await ger.getByRole('button', { name: 'Retiro o gasto' }).first().click();
    const d = ger.getByRole('dialog');
    await d.getByLabel('Importe').fill(importe);
    await d.getByLabel('Motivo').fill(motivo);
    await d.getByRole('button', { name: 'Pedir autorización' }).click();
    await d.getByRole('button', { name: 'Pedir a su teléfono' }).click();
    const creada = solicitud(ger);
    await d.getByRole('button', { name: 'Pedir autorización' }).click();
    await d.getByText('Esperando la autorización').waitFor({ timeout: T.respuesta });
    const s = await creada;
    pedidas.push(s.id);
    return s;
  }
  const tarjeta = (motivo) => duena.locator('.card').filter({ hasText: motivo });

  // 1. Rechazo: la dueña no lo autoriza y lo dice.
  r.paso('la dueña no autoriza');
  const s1 = await pedirRetiro('120', MOT_NO);
  // 2.10 (29-07): tras un «no» o al vencer, el título deja de decir «Autorizar…»: el diálogo se busca por lo que es, no por su título.
  const au = ger.getByRole('dialog');
  r.ok(typeof s1.secondsLeft === 'number' && s1.secondsLeft > 590 && s1.secondsLeft <= 600, `la cuenta regresiva la da el servidor (secondsLeft ${s1.secondsLeft})`);
  r.ok(/Vence en \d+:\d{2}/.test(await au.innerText()), 'el mostrador espera con la cuenta regresiva a la vista');
  await duena.goto(`${PANEL}/autorizaciones`, { waitUntil: 'networkidle' });
  await tarjeta(MOT_NO).waitFor({ timeout: T.respuesta });
  r.ok(await tarjeta(MOT_NO).getByText('Retirar efectivo').count() === 1 && await tarjeta(MOT_NO).getByText('$120.00').count() > 0, 'la dueña ve en su teléfono qué se autoriza y por cuánto');
  r.ok(await tarjeta(MOT_NO).getByText(/Turno de /).count() === 1, 'y de qué registro se trata, leído de la base (29-01)');
  await r.captura(duena, 'firmas-1-bandeja');
  await tarjeta(MOT_NO).getByRole('button', { name: 'No autorizar' }).click();
  const no = duena.getByRole('dialog', { name: 'No autorizar' });
  await no.getByLabel('Motivo').fill('Primero cuenta el efectivo con la gerencia');
  await no.getByRole('button', { name: 'No autorizar' }).click();
  await duena.getByText(/^No autorizada\. Quien la pidió lo ve en su pantalla/).waitFor({ timeout: T.respuesta });
  r.ok(true, 'la dueña no la autoriza, con motivo, desde su teléfono');
  const rechazo = au.getByText(/no la autorizó/);
  r.ok(await aparece(rechazo, T.respuesta), 'el mostrador ve que no la autorizó, sin recargar');
  r.ok(await au.getByText('«Primero cuenta el efectivo con la gerencia»').count() === 1, 'con el motivo de la dueña, como cita');
  r.ok(await ger.getByRole('dialog', { name: /^Retiro a caja fuerte · \$120\.00/ }).count() === 1, 'el título ya no dice «Autorizar» (29-07)');
  r.ok(await au.getByRole('button', { name: 'Entendido' }).count() === 1 && await au.getByRole('button', { name: 'Volver a pedir' }).count() === 1, 'y ofrece «Entendido» y «Volver a pedir»');
  await r.captura(ger, 'firmas-2-no-autorizada');

  // 2. Vencimiento: la dueña no contesta; vence cuando el servidor lo dice.
  r.paso('la solicitud vence');
  // 2.10 (29-08): «Volver a pedir» reenvía en un toque, sin volver al formulario.
  const otra = solicitud(ger);
  await au.getByRole('button', { name: 'Volver a pedir' }).click();
  await au.getByText('Esperando la autorización').waitFor({ timeout: T.respuesta });
  const s2 = await otra;
  pedidas.push(s2.id);
  await duena.reload({ waitUntil: 'networkidle' });
  await tarjeta(MOT_NO).waitFor({ timeout: T.respuesta });
  r.ok(true, '«Volver a pedir» manda otra solicitud con lo mismo');
  // El mostrador pregunta cada 2.5 s: con dos respuestas «pendiente» del servidor, sigue esperando.
  const sondeos = await respuestas(ger, `/api/approvals/requests/${s2.id}`, 2, { metodo: 'GET', que: 'el sondeo del mostrador' });
  const dicen = await Promise.all(sondeos.map((x) => x.json().then((b) => b.status, () => '?')));
  await asentado(ger);
  r.ok(dicen.every((st) => st === 'PENDING') && await au.getByText(/^Sin respuesta en/).count() === 0, `mientras el servidor no diga que venció, el mostrador sigue esperando (el servidor dijo ${dicen.join(', ')})`);
  // Pasan sus 10 minutos (en el reloj de la base, solo para esta solicitud).
  const movida = await sql(`update approval_requests set "expiresAt" = now() - interval '5 seconds' where id = $1 and status = 'PENDING' returning id`, [s2.id]);
  r.ok(movida.length === 1, 'pasan los 10 minutos de la solicitud sin que nadie conteste');
  r.ok(await aparece(au.getByText('Sin respuesta en 10 minutos'), T.respuesta), 'el mostrador dice «Sin respuesta en 10 minutos» en cuanto el servidor la da por vencida, con los minutos del servidor');
  r.ok(await au.getByText(/la tuvo a la vista desde las \d{1,2}:\d{2} y no contestó|No la vio|Le llegó el aviso/).count() === 1, 'y dice qué pasó del otro lado: si la vio, si le llegó el aviso o si no la vio (29-05)');
  r.ok(await au.getByRole('button', { name: 'Que firme aquí' }).count() === 1, 'y ofrece «Que firme aquí»');
  await r.captura(ger, 'firmas-3-vencida');
  await duena.reload({ waitUntil: 'networkidle' });
  await duena.getByRole('heading', { name: 'Autorizaciones' }).waitFor({ timeout: T.respuesta });
  await asentado(duena);
  r.ok(await tarjeta(MOT_NO).count() === 0, 'la vencida ya no está en la bandeja de la dueña');
  const tarde = await json(duena, `/api/approvals/requests/${s2.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: CLAVE_PRUEBAS }) });
  r.ok(tarde.status === 409, `autorizarla tarde ya no sirve (${tarde.status}: ${tarde.body?.message ?? ''})`);
  // Cancelar (29-04): otra vez «Volver a pedir», y «Cancelar solicitud» la cancela en el servidor.
  const tercera = solicitud(ger);
  await au.getByRole('button', { name: 'Volver a pedir' }).click();
  await au.getByText('Esperando la autorización').waitFor({ timeout: T.respuesta });
  const s3c = await tercera;
  pedidas.push(s3c.id);
  await au.getByRole('button', { name: 'Cancelar solicitud' }).click();
  // Al cancelar se vuelve al formulario del movimiento (otro diálogo): lo que desaparece es la espera.
  await au.getByText('Esperando la autorización').waitFor({ state: 'hidden', timeout: T.ui });
  const cancelada = await json(ger, `/api/approvals/requests/${s3c.id}`);
  r.ok(cancelada.body?.status === 'CANCELED', `«Cancelar solicitud» la cancela en el servidor (${cancelada.body?.status})`);
  await ger.keyboard.press('Escape');
  await ger.reload({ waitUntil: 'networkidle' });
  await asentado(ger);
  r.ok(await ger.getByText(MOT_NO).count() === 0, 'ni el retiro rechazado ni el vencido se registraron en el turno');
  const asientos = async (id) => (await json(ger, `/api/audit?resourceId=${id}&limit=20`)).body?.entries ?? [];
  r.ok((await asientos(s1.id)).some((e) => e.action === 'approval.remote.reject' && e.reason), 'la bitácora asienta el «no» de la dueña, con su motivo');
  const vencida = (await asientos(s2.id)).filter((e) => e.action === 'approval.remote.expire');
  r.ok(vencida.length === 1 && vencida[0].actorType === 'SYSTEM', `y una sola vez el vencimiento, como acto del sistema (${vencida.map((e) => e.actorType).join(', ')})`);
  r.ok((await asientos(s3c.id)).some((e) => e.action === 'approval.remote.cancel' && e.actorType === 'USER'), 'y la cancelación, con quien la canceló');

  // 3. Cierre de mes pedido al teléfono (20-01): la dueña lo firma desde /autorizaciones.
  r.paso('cierre de mes al teléfono');
  const previo = await cerrarDeNuevo();
  if (previo.length) r.nota(`el mes pasado (${mesPasado.slice(0, 7)}) ya estaba cerrado por una corrida anterior: se abrió de nuevo en gymflow_pruebas para cerrarlo aquí`);
  r.alFinal(async () => {
    const abiertos = await cerrarDeNuevo();
    if (abiertos.length) r.nota(`se abre de nuevo el mes pasado (${mesPasado.slice(0, 7)}) en gymflow_pruebas: el cierre de esta corrida no se queda`);
  });
  const g = await r.como('gerencia');
  await g.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  await g.getByRole('button', { name: 'Mes pasado' }).click();
  await g.locator('.tablero-cifras:not([aria-busy])').waitFor({ timeout: T.respuesta });
  await g.getByText('Cobrado').first().waitFor({ timeout: T.respuesta });
  const cerrar = g.getByRole('button', { name: 'Cerrar mes' });
  if (await cerrar.count() === 0) {
    r.ok(false, 'el tablero no ofrece «Cerrar mes» para el mes pasado aunque está abierto');
  } else {
    await cerrar.click();
    await g.getByRole('dialog').getByRole('button', { name: 'Cerrar el mes' }).click();
    const firma = g.getByRole('dialog', { name: /^Autorizar el cierre de/ });
    await firma.waitFor({ timeout: T.respuesta });
    await firma.getByRole('button', { name: 'Pedir a su teléfono' }).click();
    const cierre = solicitud(g);
    await firma.getByRole('button', { name: 'Pedir autorización' }).click();
    await firma.getByText('Esperando la autorización').waitFor({ timeout: T.respuesta });
    const s3 = await cierre;
    pedidas.push(s3.id);
    r.ok(s3.resourceType === 'MonthlyClose' && /^00000000-0000-8000-8000-000000\d{6}$/.test(s3.resourceId ?? ''), `la solicitud va atada a ESE mes (${s3.resourceType} ${s3.resourceId})`);
    await duena.goto(`${PANEL}/autorizaciones`, { waitUntil: 'networkidle' });
    const t = duena.locator('.card').filter({ hasText: 'Cerrar el mes' });
    await t.waitFor({ timeout: T.respuesta });
    r.ok(await t.getByText(/Cierre de \p{L}+ de \d{4}/u).count() === 1, `la dueña lee qué mes se cierra: «${(await t.getByText(/Cierre de/).first().innerText().catch(() => '')).trim()}»`);
    await r.captura(duena, 'firmas-4-cierre-bandeja');
    await t.getByRole('button', { name: 'Autorizar', exact: true }).click();
    await duena.getByLabel('Tu contraseña').fill(CLAVE_PRUEBAS);
    await duena.getByRole('dialog').getByRole('button', { name: 'Autorizar', exact: true }).click();
    await duena.getByText(/^Autorizado\. La operación se completa/).waitFor({ timeout: T.respuesta });
    r.ok(true, 'la dueña firma el cierre desde su teléfono');
    r.ok(await aparece(g.getByText(/quedó cerrado/), T.respuesta), 'en el tablero el mes se cierra solo al llegar la firma');
    await g.getByText(/Mes cerrado el/).waitFor({ timeout: T.respuesta });
    r.ok(await g.getByRole('button', { name: 'Cerrar mes' }).count() === 0, 'y el mes cerrado ya no ofrece cerrarse');
    await r.captura(g, 'firmas-5-mes-cerrado');
    const cierres = (await json(g, '/api/audit?limit=100')).body?.entries?.filter((e) => e.action === 'report.month.close') ?? [];
    r.ok(cierres.length > 0 && !!cierres[0].approverName, `la bitácora dice quién cerró y quién autorizó (${cierres[0]?.actorName} · autorizó ${cierres[0]?.approverName})`);
  }
}, { erroresDePagina: 'falla' });
