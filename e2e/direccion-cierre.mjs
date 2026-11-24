// Dirección (fase 3, bloque 3.7 · D-22, D-23 y D-25), en el navegador:
//
//  1. Una caja abierta con fecha del mes pasado IMPIDE cerrarlo: «Cerrar el
//     mes» queda apagado y el diálogo dice por qué.
//  2. Cortada esa caja, la gerencia lo cierra con la firma de la dueña.
//  3. En el mes ya cerrado, Gastos fijos dice «Anotar ajuste»: el gasto que
//     faltó se anota en el mes en curso con la etiqueta «Ajuste de ‹mes›», y
//     el Tablero avisa «Incluye ajustes de meses cerrados».
//  4. La dueña (con gerente presente) anota un «Retiro del dueño»: sale con
//     «No resta» y las cifras del Tablero no se mueven.
//  5. El aviso de privacidad no se publica sin la firma de la dueña: la
//     gerencia pide la firma de una versión nueva, la dueña la lee y dice «No
//     lo firmo» con su motivo; sigue vigente la versión anterior.
//
// Lo compartido que toca, y cómo lo deja:
//  · el mes pasado: lo cierra y al terminar lo vuelve a abrir (borra en
//    gymflow_pruebas el cierre que hizo, como `firmas` y `cumplimiento`);
//  · «Caja 2 Centro»: abre un turno propio, lo fecha en el mes pasado y lo corta;
//  · los dos gastos de la corrida se borran al terminar;
//  · el borrador del aviso de privacidad se borra al terminar. NO se firma a
//    propósito: publicar otra versión del aviso cambiaría lo que firman los
//    socios de todos los demás recorridos.
import { recorrido, sedeDe, letras, hoy, accion, asentado, aparece, firmar, sql, PANEL, T } from './lib/index.mjs';

await recorrido('direccion-cierre', async (r) => {
  const g = await r.api('gerencia');
  const rcp = await r.api('recepcion');
  const L = letras(4);
  const cen = await sedeDe(g, 'CEN');
  const [y, m] = hoy().split('-').map(Number);
  const mesPasado = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const ultimoDia = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const MES = mesPasado.slice(0, 7);
  const ESTE = hoy().slice(0, 7);
  const abrirElMes = () => sql(`delete from monthly_closes where month = $1::date
      and "organizationId" = (select id from organizations where "tradeName" = 'Gimnasio Demo') returning id`, [mesPasado]);
  const caja = (await g.get(`/cash-registers?branchId=${cen.id}`)).registers.find((c) => c.code === 'C2' && c.isActive);
  if (!caja) throw new Error('No hay «Caja 2» en Centro: la siembra cambió');
  const cortar = async () => {
    const abiertos = (await g.get(`/cash-sessions?branchId=${cen.id}&status=OPEN`)).sessions.filter((s) => s.cashRegisterId === caja.id);
    for (const s of abiertos) await g.post(`/cash-sessions/${s.id}/close`, { countedCashCents: (await g.get(`/cash-sessions/${s.id}`)).expectedCashCents });
    return abiertos.length;
  };
  const DESC_AJUSTE = `Luz que faltó ${L}`;
  const DESC_RETIRO = `Retiro de la quincena ${L}`;
  const borrarGastos = () => sql(`delete from operating_expenses where description = any($1::text[]) returning id`, [[DESC_AJUSTE, DESC_RETIRO]]);
  const borrarBorradores = async () => {
    const docs = (await g.get('/consent-documents')).documents.filter((d) => d.consentType === 'PRIVACY_NOTICE' && d.status !== 'PUBLISHED' && d.status !== 'RETIRED' && /^9\.\d+$/.test(d.version));
    for (const d of docs) await g.crudo('DELETE', `/consent-documents/${d.id}`).then(async (x) => { if (x.status >= 400) await sql(`delete from consent_documents where id = $1 and status <> 'PUBLISHED'`, [d.id]).catch(() => undefined); });
  };

  if ((await abrirElMes()).length) r.nota(`el mes pasado (${MES}) estaba cerrado (una corrida que no terminó): se abrió antes de empezar`);
  await cortar();
  r.alFinal(async () => {
    await cortar();
    if ((await abrirElMes()).length) r.nota(`se abre de nuevo el mes pasado (${MES}) en gymflow_pruebas: el cierre de esta corrida no se queda`);
    await borrarGastos().catch((e) => r.nota(`no se pudieron borrar los gastos de la corrida: ${e.message}`));
    await borrarBorradores().catch((e) => r.nota(`no se pudo borrar el borrador del aviso: ${e.message}`));
  });

  // El turno propio, fechado en el último día del mes pasado: es lo que deja un turno que nadie cortó.
  const turno = await rcp.post('/cash-sessions', { cashRegisterId: caja.id, openingFloatCents: '30000', shiftLabel: 'EVENING' });
  await sql(`update cash_sessions set "businessDate" = $2::date where id = $1`, [turno.id, ultimoDia]);
  r.nota(`datos de la corrida: turno de ${caja.name} abierto con fecha ${ultimoDia}; se cierra ${MES}`);

  const ger = await r.como('gerencia');
  const abrirCierre = async () => {
    await ger.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
    await ger.getByRole('button', { name: 'Mes pasado' }).click();
    await ger.locator('.tablero-cifras:not([aria-busy])').waitFor({ timeout: T.respuesta });
    await accion(ger, () => ger.getByRole('button', { name: 'Cerrar mes' }).click(), '/api/reports/monthly-close/preview', { metodo: 'GET', que: 'la vista previa del cierre' });
    const d = ger.getByRole('dialog', { name: /^Cerrar / });
    await d.getByText('Las cifras que quedan en la foto').waitFor({ timeout: T.respuesta });
    return d;
  };

  // ── 1. Una caja abierta de ese mes impide cerrar ──────────────────────────
  r.paso('caja abierta impide cerrar');
  let d = await abrirCierre();
  const NOMBRE_MES = (await d.getByRole('heading').first().innerText()).replace(/^Cerrar /, '').trim();
  const previa = await g.get(`/reports/monthly-close/preview?month=${MES}`).catch(() => g.get(`/reports/monthly-close/preview?month=${mesPasado}`));
  r.ok(previa.blockers.length >= 1 && previa.blockers.some((b) => /caja/i.test(b.message)), `la API dice qué impide cerrar ${NOMBRE_MES}: «${previa.blockers.map((b) => b.message).join(' | ').slice(0, 220)}»`);
  r.ok(await aparece(d.getByText(previa.blockers.find((b) => /caja/i.test(b.message))?.message ?? '—').first(), T.ui), 'y el diálogo lo dice con las mismas palabras');
  r.ok(await d.getByRole('button', { name: 'Cerrar el mes' }).isDisabled(), '«Cerrar el mes» queda apagado');
  await r.captura(ger, 'direccion-cierre-1-caja-abierta');
  await d.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // ── 2. Cortada la caja, se cierra con la firma de la dueña ────────────────
  r.paso('cerrar el mes');
  await cortar();
  d = await abrirCierre();
  const cerrarBtn = d.getByRole('button', { name: 'Cerrar el mes' });
  r.ok(await cerrarBtn.isEnabled(), 'cortado ese turno, ya se puede cerrar');
  r.ok(await aparece(d.getByText(/sus cifras quedan fijas\. Lo que llegue después se anota en el mes en curso como «ajuste de /), T.ui), 'avisa que las cifras quedan fijas y lo que llegue después será «ajuste de …»');
  await r.captura(ger, 'direccion-cierre-2-vista-previa', { full: true });
  await cerrarBtn.click();
  const f1 = await firmar(ger, /^Autorizar el cierre de /);
  const cierre = await accion(ger, () => f1.autorizar(), '/api/reports/monthly-close', { metodo: 'POST', que: 'el cierre del mes' });
  r.ok(cierre.ok(), `con la firma (${f1.quien}) el mes queda cerrado (${cierre.status()})`);
  r.ok(await aparece(ger.getByText(/Mes cerrado el/).first(), T.respuesta), 'el Tablero lo marca «Mes cerrado el …»');

  // ── 3. Un gasto que llegó tarde: «Anotar ajuste» ──────────────────────────
  r.paso('ajuste de un mes cerrado');
  await ger.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  const gastos = ger.locator('.card').filter({ has: ger.getByRole('button', { name: 'Mes anterior' }) });
  await gastos.waitFor({ timeout: T.respuesta });
  await accion(ger, () => gastos.getByRole('button', { name: 'Mes anterior' }).click(), `/api/expenses?month=${MES}`, { metodo: 'GET', que: 'los gastos del mes cerrado' });
  r.ok(await aparece(gastos.getByTestId('gastos-mes-cerrado'), T.respuesta) && await gastos.getByText('Mes cerrado', { exact: true }).count() === 1, `Gastos fijos de ${NOMBRE_MES}: «Mes cerrado» y «sus cifras no cambian»`);
  r.ok(await gastos.getByRole('button', { name: 'Registrar', exact: true }).count() === 0, 'ya no hay «Registrar»: el botón dice «Anotar ajuste»');
  await gastos.getByRole('button', { name: 'Anotar ajuste' }).click();
  const aj = ger.getByRole('dialog', { name: `Ajuste de ${NOMBRE_MES}` });
  r.ok(await aparece(aj, T.ui) && /está cerrado: se anota en .*, etiquetado como ajuste\./.test(await aj.innerText()), `el diálogo es «Ajuste de ${NOMBRE_MES}» y dice en qué mes se anota`);
  await aj.getByLabel('Tipo').selectOption({ label: 'Luz, agua y gas' });
  await aj.getByLabel('Descripción').fill(DESC_AJUSTE);
  await aj.getByLabel('Importe del mes').fill('123');
  await r.captura(ger, 'direccion-cierre-3-ajuste');
  const ajuste = await accion(ger, () => aj.getByRole('button', { name: 'Anotar ajuste' }).click(), (url) => new URL(url).pathname === '/api/expenses', { metodo: 'POST', que: 'el ajuste' });
  r.ok(ajuste.ok(), `el ajuste se anota (${ajuste.status()})`);
  r.ok(await aparece(ger.getByText(new RegExp(`^Ajuste de ${NOMBRE_MES} anotado en `)), T.respuesta), `avisa «Ajuste de ${NOMBRE_MES} anotado en …»`);
  const delMes = (await g.get(`/expenses?month=${MES}`)).expenses ?? [];
  r.ok(!delMes.some((x) => x.description === DESC_AJUSTE), `por la API, ${NOMBRE_MES} no ganó ningún gasto: sus cifras no cambian`);
  await accion(ger, () => gastos.getByRole('button', { name: 'Mes siguiente' }).click(), `/api/expenses?month=${ESTE}`, { metodo: 'GET', que: 'los gastos del mes en curso' });
  const renglon = gastos.locator('li').filter({ hasText: DESC_AJUSTE });
  r.ok(await aparece(renglon, T.respuesta) && await renglon.getByText(`Ajuste de ${NOMBRE_MES}`).count() === 1, `en el mes en curso aparece con la etiqueta «Ajuste de ${NOMBRE_MES}»`);
  await r.captura(ger, 'direccion-cierre-4-etiquetado', { full: true });
  await ger.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  const avisoAj = ger.getByTestId('ajustes-de-meses-cerrados');
  r.ok(await aparece(avisoAj, T.respuesta) && (await avisoAj.innerText()).includes(`ajuste de ${NOMBRE_MES}`), `y el Tablero de este mes avisa: «${(await avisoAj.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160)}»`);

  // ── 4. La dueña anota un «Retiro del dueño» y la ganancia no baja ─────────
  r.paso('retiro del dueño');
  const duena = await r.como('duena');
  await duena.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  const cifras = duena.locator('.tablero-cifras:not([aria-busy])');
  await cifras.waitFor({ timeout: T.respuesta });
  await asentado(duena);
  const antes = (await cifras.innerText()).replace(/\s+/g, ' ');
  await duena.goto(`${PANEL}/movimientos`, { waitUntil: 'networkidle' });
  const gastosD = duena.locator('.card').filter({ has: duena.getByRole('button', { name: 'Mes anterior' }) });
  const registrar = gastosD.getByRole('button', { name: 'Registrar', exact: true });
  r.ok(await aparece(registrar, T.respuesta), 'la dueña ve «Registrar» en Gastos fijos aunque haya gerente');
  await registrar.click();
  const ng = duena.getByRole('dialog', { name: /^Gasto fijo de / });
  await ng.getByLabel('Tipo').selectOption({ label: 'Retiro del dueño' });
  const rd = duena.getByRole('dialog', { name: /^Retiro del dueño de / });
  r.ok(await aparece(rd, T.ui), 'al elegir «Retiro del dueño» el diálogo cambia de nombre y lo explica');
  await rd.getByLabel('Descripción').fill(DESC_RETIRO);
  await rd.getByLabel('Importe', { exact: true }).fill('777');
  await r.captura(duena, 'direccion-cierre-5-retiro');
  const retiro = await accion(duena, () => rd.getByRole('button', { name: 'Registrar', exact: true }).click(), (url) => new URL(url).pathname === '/api/expenses', { metodo: 'POST', que: 'el retiro del dueño' });
  r.ok(retiro.ok(), `el retiro se anota (${retiro.status()})`);
  const filaRetiro = gastosD.locator('li').filter({ hasText: DESC_RETIRO });
  r.ok(await aparece(filaRetiro, T.respuesta) && await filaRetiro.getByText('No resta', { exact: true }).count() === 1, 'aparece con la marca «No resta»');
  r.ok(/en retiros del dueño \(no restan\)/.test(await gastosD.innerText()), 'y el encabezado los suma aparte: «… en retiros del dueño (no restan)»');
  await duena.goto(`${PANEL}/tablero`, { waitUntil: 'networkidle' });
  await cifras.waitFor({ timeout: T.respuesta });
  await asentado(duena);
  const despues = (await cifras.innerText()).replace(/\s+/g, ' ');
  const utilidad = (t) => t.match(/Utilidad contable (-?\$[\d,.]+)/)?.[1] ?? null;
  r.ok(utilidad(antes) !== null && utilidad(antes) === utilidad(despues), `la «Utilidad contable» del Tablero no baja por el retiro: ${utilidad(antes)} antes y ${utilidad(despues)} después`);
  r.ok(/retiros del dueño \$777 \(no restan\)/.test(despues) && !/retiros del dueño/.test(antes), 'y el Tablero lo dice aparte: «retiros del dueño $777 (no restan)»');
  await r.captura(duena, 'direccion-cierre-6-tablero', { full: true });

  // ── 5. El aviso de privacidad no se publica sin la firma de la dueña ──────
  r.paso('firma del aviso de privacidad');
  await borrarBorradores();
  const docs = (await g.get('/consent-documents')).documents;
  const vigente = docs.find((x) => x.consentType === 'PRIVACY_NOTICE' && x.status === 'PUBLISHED');
  const cuerpo = (await g.get(`/consent-documents/${vigente.id}`)).bodyText;
  const VERSION = `9.${String(Date.now()).slice(-6)}`;
  await g.post('/consent-documents', { consentType: 'PRIVACY_NOTICE', version: VERSION, title: vigente.title ?? 'Aviso de privacidad', bodyText: `${cuerpo}\n\nVersión de un recorrido de prueba (${L}).` });
  const borrador = (await g.get('/consent-documents')).documents.find((x) => x.consentType === 'PRIVACY_NOTICE' && x.version === VERSION);
  const revision = await g.get(`/consent-documents/${borrador.id}/review`);
  const MOT_PIDE = `Se agrega una línea de prueba ${L}`;
  const pedida = await g.crudo('POST', `/consent-documents/${borrador.id}/publish`, { reason: MOT_PIDE, ...(revision.checklist.length ? { checklist: revision.checklist.map((c) => c.id ?? c.key ?? c.code) } : {}) });
  const sigue = (await g.get('/consent-documents')).documents.find((x) => x.consentType === 'PRIVACY_NOTICE' && x.status === 'PUBLISHED');
  r.ok(pedida.status < 300 && sigue.id === vigente.id, `la gerencia «publica» la versión ${VERSION} y NO queda publicada: sigue vigente la ${vigente.version} (${pedida.status}${pedida.status >= 300 ? `: ${JSON.stringify(pedida.body).slice(0, 200)}` : ''})`);

  await duena.goto(`${PANEL}/consentimientos`, { waitUntil: 'networkidle' });
  const porFirmar = duena.getByTestId('avisos-por-firmar');
  r.ok(await aparece(porFirmar.getByText('El aviso de privacidad espera tu firma'), T.respuesta), 'la dueña ve «El aviso de privacidad espera tu firma»');
  await porFirmar.getByRole('button', { name: 'Leer y firmar' }).first().click();
  const fa = duena.getByRole('dialog', { name: `Firmar el aviso de privacidad · versión ${VERSION}` });
  const leido = fa.getByTestId('firmar-aviso');
  r.ok(await aparece(leido, T.respuesta) && (await leido.innerText()).includes(`Versión de un recorrido de prueba (${L}).`), 'lo lee completo en el diálogo (trae la línea nueva)');
  r.ok((await fa.innerText()).includes(MOT_PIDE), 'y ve quién lo pidió y por qué');
  await r.captura(duena, 'direccion-cierre-7-leer-y-firmar');
  await fa.getByRole('button', { name: 'Firmar y publicar' }).click();
  r.ok(await aparece(fa.getByText('Escribe tu contraseña'), T.ui), 'sin su contraseña no se firma');
  await fa.getByRole('button', { name: 'No lo firmo' }).click();
  await fa.getByLabel('Motivo').fill(`Falta el teléfono de contacto (prueba ${L})`);
  const rechazo = await accion(duena, () => fa.getByRole('button', { name: 'Devolver sin firmar' }).click(), /\/api\/consent-documents\/[^/]+\/sign\/reject$/, { metodo: 'POST', que: 'el «no lo firmo»' });
  r.ok(rechazo.ok() && await aparece(duena.getByText('Quedó sin firmar. La gerencia verá tu motivo.'), T.respuesta), `«No lo firmo» con motivo lo devuelve a la gerencia (${rechazo.status()})`);
  const alFin = (await g.get('/consent-documents')).documents;
  r.ok(alFin.find((x) => x.consentType === 'PRIVACY_NOTICE' && x.status === 'PUBLISHED')?.id === vigente.id && alFin.find((x) => x.id === borrador.id)?.status !== 'PUBLISHED', `sigue publicada la versión ${vigente.version}; la ${VERSION} no`);
});
