// Entrar como cada puesto (auditoría 8, 27-11): `entrar(p, 'recepcion')`. Se
// teclea correo y contraseña como cualquier persona (el acceso rápido de
// desarrollo ya no existe). La cuenta de plataforma deja además la sesión
// reconfirmada con su contraseña, para las acciones críticas.
import { CLAVE_PRUEBAS, PANEL, T, correoDe } from './entorno.mjs';

/** Llena el login que ya está abierto y pulsa «Entrar». */
export async function teclear(page, email, clave = CLAVE_PRUEBAS) {
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(clave);
  await page.getByRole('button', { name: /^Entrar/ }).first().click();
  if (!email.endsWith('@gymflow.mx')) return;
  await page.waitForURL('**/plataforma', { timeout: T.navegacion });
  const r = await page.evaluate(async (password) => (await fetch('/api/platform/reauth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })).status, clave);
  if (r !== 200) throw new Error(`reconfirmación de plataforma: ${r}`);
}

/**
 * Abre el login y entra con la cuenta de ese puesto (o ese correo). Regresa
 * cuando la persona ya está en su inicio: /panel, o /plataforma.
 */
export async function entrar(page, quien, { clave = CLAVE_PRUEBAS } = {}) {
  const email = correoDe(quien);
  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle' });
  await teclear(page, email, clave);
  if (!email.endsWith('@gymflow.mx')) await page.waitForURL('**/panel', { timeout: T.navegacion });
  return page;
}

/**
 * Entrada por el mostrador donde hay biometría (2026-10-09): es una excepción
 * y pide motivo antes de registrarse. Si el diálogo lo pide, se escribe.
 */
export async function motivoDeExcepcion(page, motivo = 'El lector no lo reconoció (recorrido de prueba)') {
  const paso = page.getByTestId('entrada-excepcion');
  // El diálogo primero revisa cómo entra el socio: o pide el motivo, o ya da
  // su veredicto. Se espera a cualquiera de los dos (antes: 8 s a ciegas).
  const veredicto = page.locator('.entrada-veredicto:not([data-estado="cargando"])');
  await paso.or(veredicto).first().waitFor({ timeout: T.respuesta });
  if ((await paso.count()) === 0) return false;
  await paso.getByLabel(/Motivo de la excepción/).fill(motivo);
  await page.getByRole('button', { name: 'Registrar entrada por excepción' }).click();
  return true;
}

/**
 * Primer ingreso con una contraseña temporal (fase 0.2, A4-N1): el login no
 * deja pasar al panel ni a la consola; pide elegir la propia ahí mismo, con
 * dos campos (sin volver a pedir la temporal) y al menos 12 caracteres.
 */
export async function elegirContrasena(page, nueva) {
  const paso = page.getByTestId('elegir-contrasena');
  await paso.waitFor({ timeout: T.respuesta });
  await paso.getByLabel('Nueva contraseña').fill(nueva);
  await paso.getByLabel('Repítela').fill(nueva);
  await paso.getByRole('button', { name: /Guardar y entrar/ }).click();
  return paso;
}

export { CLAVE_PRUEBAS };
