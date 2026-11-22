'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Tema = 'system' | 'light' | 'dark';
const CLAVE = 'gf-tema';

/** Menú lateral encogido a iconos: lo recuerda este equipo. */
export const CLAVE_LATERAL = 'gf-lateral';

/**
 * Fija el tema y el ancho del menú ANTES de pintar, para que no parpadeen
 * (UI2-10). Va en el `<head>` del layout; lee lo guardado en este equipo.
 */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem('${CLAVE}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;if(localStorage.getItem('${CLAVE_LATERAL}')==='rail')document.documentElement.dataset.side='rail';}catch(e){}`;

function aplicar(t: Tema) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { if (t === 'system') localStorage.removeItem(CLAVE); else localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento: solo esta visita */ }
}

const SIGUIENTE: Record<Tema, Tema> = { system: 'light', light: 'dark', dark: 'system' };
const NOMBRE: Record<Tema, string> = { system: 'Tema: el del sistema', light: 'Tema: claro', dark: 'Tema: oscuro' };

/** Claro, oscuro o el del sistema. Lo elige cada persona en su equipo. */
export function BotonTema({ conTexto = false }: { conTexto?: boolean }) {
  const [tema, setTema] = useState<Tema>('system');
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTema(t === 'light' || t === 'dark' ? t : 'system');
  }, []);
  const Icono = tema === 'light' ? Sun : tema === 'dark' ? Moon : Monitor;
  return (
    <button type="button" title={`${NOMBRE[tema]} (cambiar)`} aria-label={`${NOMBRE[tema]}. Cambiar`}
      onClick={() => { const n = SIGUIENTE[tema]; aplicar(n); setTema(n); }}>
      <Icono size={17} />{conTexto && <span>{NOMBRE[tema]}</span>}
    </button>
  );
}
