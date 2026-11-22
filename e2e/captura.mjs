// Captura de pantalla del panel o del portal, para auditar lo que se ve.
// Uso: bash e2e/captura.sh --url /socios --out /ruta/x.png [opciones]
//   --login <correo|puesto>    entra al panel con esa cuenta (clave de pruebas)
//   --portal                   apunta al portal de pruebas (4002); vista de teléfono por omisión
// Apunta al perfil de PRUEBAS (4001-4003), nunca al uso real: ver destino.mjs.
//   --portal-socio auto|<id>   genera un código de activación para ese socio y entra al portal
//   --movil | --escritorio     390x844 o 1440x900 (panel: escritorio por omisión)
//   --oscuro                   esquema oscuro
//   --full                     página completa
//   --click <selector>         (repetible) clic en orden antes de capturar: "text=Más",
//                              'role=button[name="Más"]', 'role=menuitem[name=/^Portal de /]', css
//   --fill <etiqueta>=<valor>  (repetible) llena un campo por su etiqueta visible
//   --espera <ms>              pausa extra antes de capturar (0 por omisión: ya se espera a que
//                              la página se asiente, sin peticiones en camino y pintada)
//   --texto                    imprime el texto visible de la página (hasta 6000 caracteres)
// Fase 1.17a: idioma es-MX y zona de la Ciudad de México fijos (lib/navegador.mjs),
// y cada paso espera a que la página se asiente en vez de una pausa fija.
import { abrirNavegador, contexto, pagina, entrar, asentado, sesionApi, PANEL, PORTAL } from './lib/index.mjs';

const args = process.argv.slice(2);
const opt = { clicks: [], fills: [], espera: 0 };
for (let i = 0; i < args.length; i++) {
  const a = args[i]; const v = () => args[++i];
  if (a === '--url') opt.url = v();
  else if (a === '--out') opt.out = v();
  else if (a === '--login') opt.login = v();
  else if (a === '--portal') opt.portal = true;
  else if (a === '--portal-socio') { opt.portal = true; opt.socio = v(); }
  else if (a === '--movil') opt.movil = true;
  else if (a === '--escritorio') opt.escritorio = true;
  else if (a === '--oscuro') opt.oscuro = true;
  else if (a === '--full') opt.full = true;
  else if (a === '--click') opt.clicks.push(v());
  else if (a === '--fill') opt.fills.push(v());
  else if (a === '--espera') opt.espera = Number(v());
  else if (a === '--texto') opt.texto = true;
  else { console.error(`opción desconocida: ${a}`); process.exit(2); }
}
if (!opt.url) { console.error('falta --url'); process.exit(2); }
const BASE = opt.portal ? PORTAL : PANEL;
const movil = opt.movil || (opt.portal && !opt.escritorio);
opt.out ??= `${process.env.HOME}/.gymflow-logs/captura.png`;

async function codigoPortal(socio) {
  const g = await sesionApi('gerencia');
  const id = socio === 'auto' ? (await g.get('/members?status=ACTIVE&limit=1')).members[0].id : socio;
  return { id, code: (await g.post(`/members/${id}/portal-invite`, {})).code };
}

const browser = await abrirNavegador();
const ctx = await contexto(browser, { movil, colorScheme: opt.oscuro ? 'dark' : 'light' });
const errores = [];
const page = await pagina(ctx, { errores });
try {
  if (opt.login) {
    await entrar(page, opt.login);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  }
  if (opt.socio) {
    const { id, code } = await codigoPortal(opt.socio);
    console.error(`socio ${id} · código ${code}`);
    await page.goto(`${BASE}/activar`, { waitUntil: 'networkidle' });
    await page.getByLabel('Código de activación').fill(code);
    await page.getByRole('button', { name: /Activar/ }).click();
    await page.waitForURL(`${BASE}/`);
  }
  await page.goto(`${BASE}${opt.url}`, { waitUntil: 'networkidle' });
  for (const sel of opt.clicks) { await page.locator(sel).first().click(); await asentado(page); }
  for (const f of opt.fills) { const i = f.indexOf('='); await page.getByLabel(f.slice(0, i)).fill(f.slice(i + 1)); }
  await asentado(page);
  // Pausa pedida a mano por quien captura (animaciones propias, por ejemplo).
  if (opt.espera > 0) await new Promise((listo) => setTimeout(listo, opt.espera));
  await page.screenshot({ path: opt.out, fullPage: !!opt.full });
  console.log(opt.out);
  if (opt.texto) console.log((await page.evaluate(() => document.body.innerText)).slice(0, 6000));
} finally {
  if (errores.length) console.error(`errores de página: ${errores.join(' | ')}`);
  await browser.close();
}
