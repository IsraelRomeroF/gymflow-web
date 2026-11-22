// Nada se sale de su tarjeta en escritorio (2026-10-08): el recorrido móvil ya
// vigila el ancho de la página; este mira, en 1280 y 1024 px, que ningún
// elemento asome fuera de la tarjeta o lista que lo contiene.
import { recorrido, asentado, PANEL } from './lib/index.mjs';

const RUTAS = (process.env.RUTAS ?? '/panel,/socios,/caja,/punto-de-venta,/altas,/prospectos,/clases,/rutinas,/tablero,/movimientos,/retencion,/planes,/productos,/personal,/personal/roles,/sucursales,/modulos,/bitacora,/biometria,/consentimientos,/arranque,/autorizaciones,/acceso,/importar').split(',');
const ANCHOS = [1280, 1024];

await recorrido('desborde', async (r) => {
  for (const ancho of ANCHOS) {
    const p = await r.como('gerencia', { viewport: { width: ancho, height: 900 } });
    for (const ruta of RUTAS) {
      await p.goto(`${PANEL}${ruta}`, { waitUntil: 'networkidle' }).catch(() => undefined);
      await asentado(p);
      const fugas = await p.evaluate(() => {
        const out = [];
        const pagina = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        if (pagina) out.push(`página +${document.documentElement.scrollWidth - document.documentElement.clientWidth}px`);
        for (const card of document.querySelectorAll('.card, .list-item, .stat, dialog')) {
          const c = card.getBoundingClientRect();
          if (c.width === 0) continue;
          // Lo que vive dentro de un contenedor que se desplaza a propósito (tablas, horario semanal) no es desborde.
          const desplazable = (el) => { for (let n = el; n && n !== card.parentElement; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
          for (const el of card.querySelectorAll('*')) {
            if (desplazable(el) || getComputedStyle(el).position === 'fixed' || getComputedStyle(el).position === 'absolute') continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            if (b.right > c.right + 2 || b.left < c.left - 2) {
              const d = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''} "${(el.textContent || '').trim().slice(0, 30)}" +${Math.round(b.right - c.right)}px`;
              if (!out.some((x) => x.endsWith(d.slice(-20)))) out.push(d);
              break;
            }
          }
          if (out.length > 6) break;
        }
        return out;
      });
      r.ok(fugas.length === 0, `${ancho}px ${ruta}${fugas.length ? ' → ' + fugas.join(' | ') : ''}`);
    }
    await p.context().close();
  }
}, { etiquetaFallo: 'DESBORDA' });
