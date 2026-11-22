import { existsSync, readdirSync } from 'node:fs';

// Chromium sin interfaz que usan los recorridos. Lo baja `preparar.sh` a la
// caché de Playwright; `GYMFLOW_CHROME` permite apuntar a otro binario.
// El arranque de cada recorrido vive en lib/ (fase 1.17a); el menú, en
// lib/menu.mjs. `llenarLogin` (el acceso rápido de desarrollo, que ya no
// existe) se retiró: se entra con lib/acceso.mjs · entrar(p, 'recepcion').
const cache = `${process.env.HOME}/.cache/ms-playwright`;
const revision = existsSync(cache)
  ? readdirSync(cache)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0]
  : undefined;

export const exe =
  process.env.GYMFLOW_CHROME ??
  `${cache}/${revision}/chrome-headless-shell-linux64/chrome-headless-shell`;

export { abrirMenu, irPorMenu } from './lib/menu.mjs';
