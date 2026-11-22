// Alta y ficha de una marca en la consola de plataforma (fase 2, bloque 2.11;
// recorrido del bloque 2.14). El alta en tres pasos con «Liberar el software al
// terminar» apagado: la entrega de accesos dice que la marca «sigue sin
// liberar» y deja liberarla ahí mismo; «Ir a la marca» lleva a su ficha. En la
// ficha: «Suspender el servicio» → solo ofrece «Reanudar el servicio» (no
// «Liberar el software») → reanudar, con su frase en «Lo que GymFlow hizo aquí».
//
// Datos propios: una marca «Ficha XXXX» de esta corrida, con sus correos. No
// hay forma de borrar una marca: queda SUSPENDIDA al terminar, como la de
// `plataforma` y la de `primer-uso` (no entra a la cobranza de cada mes).
import { recorrido, aparece, letras, PANEL, T } from './lib/index.mjs';

await recorrido('plataforma-ficha', async (r) => {
  const L = letras(4).toUpperCase();
  const marca = `Ficha ${L}`;
  const correo = (rol) => `${rol}.${L.toLowerCase()}@ficha-prueba.mx`;

  const pl = await r.como('plataforma');
  const enPagina = (ruta, cuerpo) => pl.evaluate(async ([u, b]) => {
    const res = await fetch(u, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : undefined);
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [ruta, cuerpo ?? null]);
  // La marca de esta corrida queda suspendida, pase lo que pase.
  r.alFinal(async () => {
    const org = (await enPagina('/api/platform/organizations')).body?.organizations?.find((o) => o.tradeName === marca);
    if (!org || org.serviceStatus === 'SUSPENDED') return;
    const st = (await enPagina(`/api/platform/organizations/${org.id}/service`, { status: 'SUSPENDED', reason: 'Marca de un recorrido de prueba' })).status;
    if (st >= 400) r.nota(`no se pudo suspender la marca de la corrida (${st})`);
  });
  // Si la reconfirmación venció a media corrida, el diálogo la pide: se da y se sigue.
  const reconfirmarSiPide = async (hecho) => {
    const conf = pl.getByRole('dialog').filter({ hasText: 'Confirma que eres tú' });
    await conf.or(hecho).first().waitFor({ timeout: T.respuesta });
    if (await conf.count() === 0) return;
    await conf.getByLabel('Tu contraseña').fill('GymFlow.dev.2026');
    await conf.getByRole('button', { name: 'Confirmar' }).click();
  };

  // ── 1. El alta en tres pasos, sin liberar al terminar ─────────────────────
  r.paso('alta en tres pasos');
  await pl.getByRole('heading', { name: 'Marcas' }).waitFor({ timeout: T.respuesta });
  await pl.locator('[data-marca]').first().waitFor({ timeout: T.respuesta });
  await pl.getByRole('button', { name: 'Nueva marca' }).first().click();
  const d = pl.getByRole('dialog', { name: 'Nueva marca' });
  r.ok(await aparece(d.getByText('Paso 1 de 3 · La marca')), 'el alta abre en el paso 1 de 3, «La marca»');
  await d.getByLabel('Nombre comercial').fill(marca);
  await d.getByLabel('Razón social').fill(`${marca} S.A. de C.V.`);
  await d.getByLabel('Código').fill(`F${L}`.slice(0, 5));
  await d.getByRole('button', { name: 'Siguiente' }).click();
  r.ok(await aparece(d.getByText('Paso 2 de 3 · Qué contrató')), 'con la marca completa, «Siguiente» pasa a «Qué contrató»');
  r.ok(await d.getByLabel('Plantilla de arranque').count() === 0, 'sin «Plantilla de arranque»: lo contratado nace encendido');
  await d.getByRole('button', { name: 'Siguiente' }).click();
  r.ok(await aparece(d.getByText('Paso 3 de 3 · Las cuentas')), 'y a «Las cuentas»');
  await d.locator('#ow-n').fill('Ana Duena Ficha');
  await d.locator('#ow-e').fill(correo('duena'));
  await d.locator('#s0-n').fill('Beto Gerente Ficha');
  await d.locator('#s0-e').fill(correo('gerente'));
  await d.locator('#s1-n').fill('Carla Recepcion Ficha');
  await d.locator('#s1-e').fill(correo('recepcion'));
  await d.getByLabel('Motivo del alta').fill('Marca de un recorrido de prueba');
  const liberarAlTerminar = d.locator('#nm-liberar');
  r.ok(await d.getByText('Liberar el software al terminar').count() === 1 && !(await liberarAlTerminar.isChecked()), '«Liberar el software al terminar» viene apagado');
  // La barra de pasos deja volver a uno ya hecho sin perder lo escrito.
  await d.getByTestId('alta-pasos').locator('[data-paso="1"]').getByRole('button').click();
  r.ok(await d.getByLabel('Nombre comercial').inputValue() === marca, 'la barra de pasos vuelve al paso 1 con lo escrito');
  await d.getByRole('button', { name: 'Siguiente' }).click();
  await d.getByText('Paso 2 de 3').waitFor({ timeout: T.ui });
  await d.getByRole('button', { name: 'Siguiente' }).click();
  await d.getByText('Paso 3 de 3').waitFor({ timeout: T.ui });
  r.ok(await d.locator('#s0-e').inputValue() === correo('gerente'), 'y las cuentas siguen ahí al regresar');
  await r.captura(pl, 'plataforma-ficha-1-paso3');
  await d.getByRole('button', { name: 'Dar de alta la marca' }).click();

  // ── 2. La entrega: sigue sin liberar → se libera ahí mismo ────────────────
  r.paso('entrega de accesos y liberar');
  const cred = pl.getByRole('dialog', { name: /accesos de arranque/ });
  await reconfirmarSiPide(cred);
  await cred.waitFor({ timeout: T.respuesta });
  const claves = await cred.getByTestId('clave-temporal').allInnerTexts();
  r.ok(claves.length === 3 && claves.every((c) => /^GYM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c.trim())), 'entrega tres contraseñas temporales, una por cuenta');
  r.ok(await cred.getByTestId('sigue-sin-liberar').count() === 1 && /sin liberar/i.test(await cred.getByTestId('sigue-sin-liberar').innerText()), 'la entrega dice que la marca sigue sin liberar');
  await r.captura(pl, 'plataforma-ficha-2-sigue-sin-liberar');
  await cred.getByRole('button', { name: 'Liberar el software' }).click();
  const lib = pl.getByRole('dialog', { name: new RegExp(`Liberar el software a ${marca}`) });
  r.ok(await aparece(lib), `«Liberar el software» abre su diálogo nombrando a ${marca}`);
  await lib.getByRole('button', { name: 'Contrato firmado y primer pago recibido' }).click();
  await lib.getByRole('button', { name: 'Liberar', exact: true }).click();
  await reconfirmarSiPide(cred.getByTestId('ya-en-uso'));
  r.ok(await aparece(cred.getByTestId('ya-en-uso'), T.respuesta) && await cred.getByTestId('sigue-sin-liberar').count() === 0, 'tras liberar ahí mismo, la entrega deja de decir «sin liberar» y dice que ya está en uso');
  await r.captura(pl, 'plataforma-ficha-3-en-uso');
  await cred.getByRole('button', { name: /Ir a la marca/ }).click();
  await pl.waitForURL(/\/plataforma\/[0-9a-f-]{36}/, { timeout: T.navegacion });
  await pl.getByRole('heading', { name: marca }).waitFor({ timeout: T.respuesta });
  const idMarca = new URL(pl.url()).pathname.split('/').pop();
  r.ok(true, '«Ir a la marca» lleva a su ficha');

  // ── 3. La ficha: suspender y reanudar el servicio ─────────────────────────
  r.paso('suspender el servicio');
  await pl.getByTestId('personal-marca').waitFor({ timeout: T.respuesta });
  r.ok(await pl.locator(`[data-cuenta="${correo('gerente')}"]`).count() === 1 && await pl.locator(`[data-cuenta="${correo('duena')}"]`).count() === 1, 'la ficha lista las cuentas del alta en «Personal»');
  const estado = async () => (await enPagina(`/api/platform/organizations/${idMarca}`)).body;
  const antes = await estado();
  const st0 = antes?.organization?.serviceStatus ?? antes?.serviceStatus;
  r.ok(st0 === 'ACTIVE', `para la API el servicio está en uso (${st0})`);
  r.ok(await pl.getByRole('button', { name: 'Suspender el servicio' }).count() === 1 && await pl.getByRole('button', { name: 'Liberar el software' }).count() === 0, 'liberada, la ficha ofrece «Suspender el servicio» y ya no «Liberar el software»');
  await pl.getByRole('button', { name: 'Suspender el servicio' }).click();
  const sus = pl.getByRole('dialog');
  await sus.getByRole('button', { name: 'Falta de pago' }).click();
  await sus.getByRole('button', { name: 'Suspender', exact: true }).click();
  await reconfirmarSiPide(pl.getByText('Servicio suspendido.'));
  r.ok(await aparece(pl.getByText('Servicio suspendido.'), T.respuesta), 'suspender con un motivo de un toque avisa «Servicio suspendido.»');
  const reanudar = pl.getByRole('button', { name: 'Reanudar el servicio' });
  r.ok(await aparece(reanudar, T.respuesta) && await pl.getByRole('button', { name: 'Liberar el software' }).count() === 0, 'suspendida, la ficha ofrece «Reanudar el servicio», no «Liberar el software»');
  await r.captura(pl, 'plataforma-ficha-4-suspendida');

  r.paso('reanudar el servicio');
  await reanudar.click();
  const rea = pl.getByRole('dialog', { name: new RegExp(`Reanudar el servicio de ${marca}`) });
  r.ok(await aparece(rea), `«Reanudar el servicio» abre su diálogo nombrando a ${marca}`);
  await rea.getByRole('button', { name: 'Pago recibido' }).click();
  await rea.getByRole('button', { name: 'Reanudar', exact: true }).click();
  await reconfirmarSiPide(pl.getByText('Servicio reanudado.'));
  r.ok(await aparece(pl.getByText('Servicio reanudado.'), T.respuesta), 'reanudar avisa «Servicio reanudado.»');
  r.ok(await aparece(pl.getByTestId('actos-plataforma').getByText('GymFlow reanudó el servicio').first(), T.respuesta), '«Lo que GymFlow hizo aquí» dice «GymFlow reanudó el servicio»');
  r.ok(await aparece(pl.getByRole('button', { name: 'Suspender el servicio' }), T.respuesta), 'y la ficha vuelve a ofrecer «Suspender el servicio»');
  const despues = await estado();
  const st1 = despues?.organization?.serviceStatus ?? despues?.serviceStatus;
  r.ok(st1 === 'ACTIVE', `para la API el servicio quedó en uso otra vez (${st1})`);
  await r.captura(pl, 'plataforma-ficha-5-reanudada', { full: true });
  // La lista de marcas la muestra con su nombre.
  await pl.goto(`${PANEL}/plataforma`, { waitUntil: 'networkidle' });
  r.ok(await aparece(pl.locator(`[data-marca="${marca}"]`), T.respuesta), 'la marca nueva aparece en la lista de marcas');
}, { erroresDePagina: 'falla' });
