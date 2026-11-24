// «Decidir adeudo» de dos suspendidos de hace meses: recepción reanuda el
// adeudo y lo cobra; la gerencia lo olvida con la firma de la dueña.
//
// Datos propios (fase 1.17a): antes tomaba las dos suspendidas que siembra la
// semilla (las buscaba regresion.sh con SQL) y, al resolverlas, `dinero` ya no
// encontraba ninguna: había que regenerar la base. Ahora arma las suyas como
// la semilla (lib/datos.mjs · socioSuspendido): pagó un mes hace 4 y 6 meses y
// dejó de pagar.
//
// «Reanudar y cobrar» espera la respuesta de la API con su propio tope (30 s),
// más largo que el de la transacción del servidor (15 s): si el servidor tarda,
// la bitácora dice «lenta» con el tiempo; si nunca responde, dice «COLGADA» con
// la petición (pendiente del cierre de la fase 0).
import { recorrido, socioSuspendido, respuesta, asentado, aparece, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('adeudo', async (r) => {
  const g = await r.api('gerencia');
  const reanuda = await socioSuspendido(g, { mesesAtras: 3 });
  const olvida = await socioSuspendido(g, { mesesAtras: 5 });
  r.nota(`socios de esta corrida: ${reanuda.memberCode} (reanudar) y ${olvida.memberCode} (olvidar)`);
  const decision = (p) => respuesta(p, /\/api\/memberships\/[^/]+\/debt-decision$/, { metodo: 'POST', que: 'la decisión del adeudo' });

  // 1. Recepción: reanudar el adeudo y cobrarlo todo.
  r.paso('recepción reanuda el adeudo');
  const rec = await r.como('recepcion');
  await rec.goto(`${PANEL}/socios/${reanuda.id}`, { waitUntil: 'networkidle' });
  await rec.getByRole('button', { name: 'Decidir adeudo' }).click();
  let d = rec.getByRole('dialog');
  await d.getByText('Reanudar el adeudo').waitFor({ timeout: T.respuesta });
  r.ok(await d.getByText('Solo la gerencia puede perdonar un adeudo.').count() === 1, 'recepción no puede olvidar un adeudo');
  r.ok(await d.getByText(/Se cobran los 2 periodos/).count() === 1, 'muestra los 2 periodos que no vino');
  await d.getByText('Reanudar el adeudo').click();
  await d.getByLabel('Motivo').fill('Acepta pagar los meses que debe');
  await r.captura(rec, 'ad-1-reanudar');
  const reanudar = decision(rec);
  await d.getByRole('button', { name: /^Reanudar y cobrar \$/ }).click();
  const resp = await reanudar;
  if (resp.status() >= 400) r.nota(`la API respondió ${resp.status()} a «Reanudar y cobrar»: ${(await resp.text()).slice(0, 160)}`);
  await rec.getByText(/Adeudo reanudado: .* ya puede entrar/).waitFor({ timeout: T.ui });
  r.ok(true, 'reanudar cobra los meses atrasados y la reactiva');
  // La ficha recarga la membresía después del aviso: se espera a que se asiente.
  await asentado(rec);
  r.ok(await rec.getByText('Suspendida').count() === 0, 'ya no aparece suspendida');

  // 2. Gerente: olvidar el adeudo con la autorización del dueño.
  r.paso('el gerente olvida el adeudo');
  const ger = await r.como('gerente');
  await ger.goto(`${PANEL}/socios/${olvida.id}`, { waitUntil: 'networkidle' });
  await ger.getByRole('button', { name: 'Decidir adeudo' }).click();
  d = ger.getByRole('dialog');
  await d.getByText('Olvidar el adeudo').click();
  await d.getByLabel('Motivo').fill('Estuvo incapacitado por una lesión');
  await r.captura(ger, 'ad-2-olvidar');
  // Fase 3 · bloque 3.5 (D-12): olvidar hasta una mensualidad del socio ya no pide firma; arriba de eso, sí.
  // El botón dice «Olvidar adeudo» u «Olvidar y cobrar $…». La primera respuesta puede ser 428 (pide firma).
  const primera = decision(ger);
  await d.getByRole('button', { name: /^Olvidar (adeudo|y cobrar)/ }).click();
  let resp2 = await primera;
  if (resp2.status() === 428) {
    d = ger.getByRole('dialog').last();
    // 2.10 (20-14): con una sola persona que firma, ya está elegida; no se teclea su correo.
    await d.getByText(/^Firma: /).waitFor();
    await d.getByLabel('Su contraseña').fill(CLAVE_PRUEBAS);
    const olvidar = decision(ger);
    await d.getByRole('button', { name: 'Autorizar' }).click();
    resp2 = await olvidar;
  }
  if (resp2.status() >= 400) r.nota(`la API respondió ${resp2.status()} a «Olvidar el adeudo»: ${(await resp2.text()).slice(0, 160)}`);
  r.ok(await aparece(ger.getByText(/Adeudo olvidado: .* ya puede entrar/), T.ui), 'olvidar condona, arranca hoy y cobra solo el periodo nuevo');
  await ger.getByRole('tab', { name: /Estado de cuenta/ }).click();
  await r.captura(ger, 'ad-3-estado');
});
