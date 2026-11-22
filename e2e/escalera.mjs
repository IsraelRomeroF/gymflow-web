// La escalera de fallos al firmar (auditoría 8, fase 0.9, 24-11). Cinco
// contraseñas equivocadas de la dueña en el mostrador ponen SUS FIRMAS en pausa
// 10 minutos (aviso al 3.º, pausa al 5.º); con la buena, mientras dure, 429 con
// la hora. Su inicio de sesión no se toca: sigue entrando al panel. Todo queda
// en la bitácora.
//
// La pausa duraría 10 minutos y frenaría a los recorridos que siguen: al
// terminar (pase lo que pase, también si se corta) se levanta en gymflow_pruebas
// (lib/base.mjs). A mano: fallar 5 veces y esperar 10 minutos para volver a firmar.
import { recorrido, respuesta, asentado, sql, PANEL, T, CLAVE_PRUEBAS } from './lib/index.mjs';

await recorrido('escalera', async (r) => {
  const levantarPausa = () => sql(`update approval_signer_locks set "failedCount" = 0, "windowStartedAt" = null, "pausedUntil" = null
    where "userId" in (select id from users where lower(email) = 'owner@demo.mx')`);
  const motivo = `Retiro para probar la escalera ${Date.now().toString(36).slice(-4)}`;
  await levantarPausa();
  r.alFinal(levantarPausa);

  const ger = await r.como('gerente');
  await ger.goto(`${PANEL}/caja`, { waitUntil: 'networkidle' });
  await ger.getByRole('button', { name: 'Retiro o gasto' }).first().click();
  let d = ger.getByRole('dialog');
  await d.getByLabel('Importe').fill('50');
  await d.getByLabel('Motivo').fill(motivo);
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  const au = ger.getByRole('dialog', { name: /^Autorizar retiro/ });
  // 2.10 (20-14): la dueña ya está elegida; no se teclea su correo.
  await au.getByText(/^Firma: /).waitFor({ timeout: T.respuesta });
  const firmar = async (clave) => {
    await au.getByLabel('Su contraseña').fill(clave);
    const resp = respuesta(ger, '/api/approvals', { metodo: 'POST', que: 'la firma en el mostrador' });
    await au.getByRole('button', { name: 'Autorizar', exact: true }).click();
    const status = (await resp).status();
    // El diálogo pinta lo que respondió el servidor antes de la siguiente firma.
    await asentado(ger);
    return status;
  };

  const inicio = new Date(Date.now() - 2000).toISOString();
  r.paso('cinco firmas equivocadas');
  const estados = [];
  for (let i = 1; i <= 5; i++) estados.push(await firmar(`equivocada-${i}-2026`));
  r.ok(estados.every((s) => s === 401), `cinco contraseñas equivocadas: 401 cada una (${estados.join(' ')})`);
  const tras5 = (await au.innerText()).replace(/\n/g, ' ');
  r.ok(/sus firmas quedan en pausa hasta las \d{1,2}:\d{2}/.test(tras5), 'al 5.º fallo: «sus firmas quedan en pausa hasta las HH:MM»');
  const sexto = await firmar(CLAVE_PRUEBAS);
  const tras6 = (await au.innerText()).replace(/\n/g, ' ');
  r.ok(sexto === 429 && /Las firmas de esa persona están en pausa hasta las \d{1,2}:\d{2}/.test(tras6), `con la buena, durante la pausa: 429 y la hora (${sexto})`);
  await r.captura(ger, 'escalera-1-pausa');
  // Al volver a abrir, quién firma ya dice que está en pausa.
  await au.getByRole('button', { name: 'Cancelar' }).click();
  await ger.getByRole('dialog').getByRole('button', { name: 'Pedir autorización' }).click();
  r.ok(await au.getByText(/firmas en pausa hasta las \d{1,2}:\d{2}/).waitFor({ timeout: T.respuesta }).then(() => true, () => false), '«Pueden autorizar» marca sus firmas en pausa');
  r.ok(await au.getByText('Sus firmas están en pausa').count() === 1, 'y lo avisa antes de teclear');
  // Su inicio de sesión no se toca.
  r.paso('la dueña sigue entrando');
  await r.como('duena');
  r.ok(true, 'la dueña sigue entrando al panel: la pausa es de sus firmas, no de su cuenta');
  const asientos = (await ger.evaluate(async () => (await (await fetch('/api/audit?limit=100')).json()).entries)).filter((e) => e.at >= inicio);
  const fallos = asientos.filter((e) => e.action === 'approval.local.fail');
  const pausa = asientos.filter((e) => e.action === 'approval.pause');
  r.ok(fallos.length >= 5, `la bitácora asienta cada firma fallida en el mostrador (${fallos.length})`);
  r.ok(pausa.length === 1 && pausa[0].actorType === 'SYSTEM', 'y la pausa, como acto del sistema');

  // Levantada la pausa, vuelve a firmar (y el retiro de prueba se registra).
  r.paso('sin la pausa, firma de nuevo');
  await levantarPausa();
  await ger.reload({ waitUntil: 'networkidle' });
  await ger.getByRole('button', { name: 'Retiro o gasto' }).first().click();
  d = ger.getByRole('dialog');
  await d.getByLabel('Importe').fill('50');
  await d.getByLabel('Motivo').fill(motivo);
  await d.getByRole('button', { name: 'Pedir autorización' }).click();
  // 2.10 (20-14): la dueña ya está elegida; no se teclea su correo.
  await au.getByText(/^Firma: /).waitFor({ timeout: T.respuesta });
  r.ok([200, 201].includes(await firmar(CLAVE_PRUEBAS)), 'sin la pausa, su firma vuelve a valer');
  await ger.getByText(/Retiro a caja fuerte: \$50\.00/).waitFor({ timeout: T.respuesta });
}, { erroresDePagina: 'falla' });
