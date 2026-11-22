// Mide el desborde horizontal de cada pantalla del panel en un teléfono
// (375 px). Un desborde nuevo hace fallar la regresión, no solo lo imprime.
//   RUTAS=/socios,/caja node e2e/movil.mjs     solo esas
//   SHOT=1 node e2e/movil.mjs                  y una captura de cada una
import { recorrido, asentado, PANEL } from './lib/index.mjs';

await recorrido('movil', async (r) => {
  const p = await r.como('gerencia', { movil: true, viewport: { width: 375, height: 800 } });
  const rutas = (process.env.RUTAS ?? '/panel,/caja,/punto-de-venta,/socios,/altas,/prospectos,/clases,/rutinas,/tablero,/retencion,/planes,/productos,/personal,/sucursales,/biometria,/acceso,/bitacora,/movimientos').split(',');
  let malos = 0;
  for (const ruta of rutas) {
    await p.goto(`${PANEL}${ruta}`, { waitUntil: 'networkidle' });
    await asentado(p);
    const d = await p.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const culpables = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed')
        .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
      // Tablas que se deslizan de lado dentro de su tarjeta: esconden la acción de la fila (UI2-03).
      const tablas = [...document.querySelectorAll('.table-wrap')].filter((t) => t.scrollWidth > t.clientWidth + 2)
        .map((t) => `${t.querySelector('th')?.textContent ?? 'tabla'} +${t.scrollWidth - t.clientWidth}px`);
      return { extra: document.documentElement.scrollWidth - w, culpables, tablas };
    });
    if (d.extra > 0 || d.tablas.length) malos++;
    console.log(d.extra > 0 ? 'DESBORDA' : d.tablas.length ? 'DESBORDA tabla' : 'ok      ', ruta, d.extra > 0 ? `+${d.extra}px ${d.culpables.join(' ')}` : d.tablas.join(' · '));
    if (process.env.SHOT) await r.captura(p, `movil${ruta.replaceAll('/', '-')}`);
  }
  r.ok(malos === 0, `${malos} pantallas desbordan`);
});
