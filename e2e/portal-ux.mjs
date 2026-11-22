// Portal del socio (auditoría UX 7, frente 5): /activar con sesión va a
// Inicio, ya no invita a domiciliar, avisos legibles, rutina con título, y sin
// señal abre con su marca y un Reintentar.
// PORTAL_URL=http://localhost:3012 para correrlo contra `next start` (sin señal solo hidrata en producción).
// Datos propios (fase 1.17a): el socio es de esta corrida (antes, el sexto
// del padrón: cambiaba con lo que hubieran dado de alta otros recorridos).
import { recorrido, socioAlCorriente, invitacionPortal, asentado, aparece, PORTAL as PORTAL_PRUEBAS, T } from './lib/index.mjs';

const PORTAL = process.env.PORTAL_URL ?? PORTAL_PRUEBAS;

await recorrido('portal-ux', async (r) => {
  const g = await r.api('gerencia');
  const socio = await socioAlCorriente(g, { sede: 'CEN' });
  const code = await invitacionPortal(g, socio);

  const page = await r.nueva({ movil: true, etiqueta: 'portal' });
  const ctx = page.context();
  await page.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  await page.getByLabel('Código de activación').fill(code);
  await page.getByRole('button', { name: /Activar/ }).click();
  await page.waitForURL(`${PORTAL}/`);
  await page.getByText('Cómo entras').waitFor({ timeout: T.respuesta });

  // /activar con la sesión viva: de vuelta a Inicio, sin pedir otro código.
  r.paso('activar con sesión');
  await page.goto(`${PORTAL}/activar`, { waitUntil: 'networkidle' });
  r.ok(await page.waitForURL(`${PORTAL}/`, { timeout: T.ui }).then(() => true, () => false), '/activar con sesión lleva a Inicio');
  await page.getByText('Cómo entras').waitFor({ timeout: T.respuesta });

  // Ya no se invita a domiciliar a nadie (auditoría 8, 25-02 y D25-01).
  const me = await page.evaluate(async () => (await fetch('/api/portal/me')).json());
  await asentado(page);
  r.ok(await page.getByTestId('invita-domiciliar').count() === 0 && await page.getByRole('link', { name: /Domiciliar/ }).count() === 0, 'Inicio ya no invita a domiciliar (25-02)');

  // Avisos: fechas legibles, sin "pásate a recepción" si se paga en línea.
  r.paso('avisos');
  await page.getByTestId('campana').click();
  await page.getByRole('dialog').waitFor();
  await asentado(page);
  const textoAvisos = await page.getByRole('dialog').innerText();
  r.ok(!/\d{4}-\d{2}-\d{2}/.test(textoAvisos), 'los avisos no traen fechas de máquina');
  if (me.onlinePayments) r.ok(!/Pásate a recepción/.test(textoAvisos), 'con pago en línea no manda a recepción');
  await r.captura(page, 'portal-ux-avisos');
  await page.keyboard.press('Escape');

  // Rutina vacía con título.
  if (me.modules?.includes('training') ?? true) {
    await page.goto(`${PORTAL}/rutina`, { waitUntil: 'networkidle' });
    await page.getByText(/Aún no tienes rutina|Te la armó|Día/).first().waitFor({ timeout: T.respuesta });
    if (await page.getByText('Aún no tienes rutina').count()) r.ok(await page.getByRole('heading', { name: 'Tu rutina' }).count() === 1, 'la rutina vacía tiene título');
  }

  // Service worker y sin señal.
  r.paso('sin señal');
  await page.goto(`${PORTAL}/`, { waitUntil: 'networkidle' });
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    // Tope propio de la página: resuelve en cuanto el service worker está listo.
    return Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((res) => setTimeout(() => res(false), 8000))]);
  });
  r.ok(sw, 'el portal registra su service worker');
  await page.reload({ waitUntil: 'networkidle' }); // ya controlada por el SW: guarda la página y la cuenta
  await page.getByText('Cómo entras').waitFor({ timeout: T.respuesta });
  await ctx.setOffline(true);
  let abrio = true;
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { abrio = false; });
  r.ok(abrio, 'sin señal, el portal abre (no el error del navegador)');
  if (abrio) {
    await page.getByText('Cómo entras').or(page.getByTestId('sin-senal')).first().waitFor({ timeout: T.respuesta }).catch(() => undefined);
    const marca = await page.locator('.brand-name').first().innerText().catch(() => '');
    // En `next dev` la página no termina de hidratar sin red (HMR); se exige solo en producción.
    if (process.env.PORTAL_URL) r.ok(!!marca && marca !== 'GymFlow' && await page.getByText('Cómo entras').count() === 1, `sin señal abre con su marca y su cuenta (${marca})`);
    else r.nota('sin señal con marca y cuenta se verifica contra producción (PORTAL_URL)');
    await r.captura(page, 'portal-ux-sin-senal', { red: false });
  }
  await ctx.setOffline(false);

  // Error de la cuenta con salida: se simula una caída de /portal/me (sin SW, que respondería de su caché).
  r.paso('error de la cuenta');
  const p2 = await r.nueva({ movil: true, deviceScaleFactor: 1, storageState: await ctx.storageState(), serviceWorkers: 'block', etiqueta: 'portal' });
  await p2.route('**/api/portal/me', (x) => x.abort());
  await p2.goto(`${PORTAL}/`, { waitUntil: 'domcontentloaded' });
  const sinSenal = p2.getByTestId('sin-senal');
  await sinSenal.waitFor({ timeout: T.respuesta }).catch(() => undefined);
  r.ok(await sinSenal.getByRole('button', { name: 'Reintentar' }).count() === 1, 'sin cuenta: aviso con Reintentar');
  await p2.unroute('**/api/portal/me');
  if (await sinSenal.count()) {
    await sinSenal.getByRole('button', { name: 'Reintentar' }).click();
    r.ok(await aparece(p2.getByText('Cómo entras'), T.respuesta), 'Reintentar recupera la cuenta');
  }
});
