'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ShieldCheck, KeyRound } from 'lucide-react';
import { api, ApiError, alPedirReconfirmacion, alPerderSesion, finDeSesion } from '@/lib/api';
import { irAEntrar, recordarFin, rutaActual, rutaDeEntrada, salirDeEsteEquipo } from '@/lib/sesion';
import { hora } from '@gymflow/ui/format';
import { ToastProvider } from '@/components/session';
import { Button, Callout, Dialog, EsqueletoPagina, Field, irAlPrimerError } from '@/components/ui';
import { Marca } from '@gymflow/ui/compartido';
import '../plataforma.css';

export type Plantilla = { key: string; name: string; description: string; off: string[] };
/** Un puesto del catálogo (ADR-039): lo que la plataforma y la gerencia pueden dar. */
export type Puesto = { key: string; name: string; description: string; sees: string; scope: 'org' | 'branch' | 'any' };
/** Un plan de la plataforma (ADR-039): paquete de módulos con precio mensual. */
export type PlanPlataforma = { id: string; name: string; description: string | null; modules: string[]; monthlyCents: string | null; isActive: boolean; sortOrder: number; organizations?: number };
export type Plataforma = {
  userId: string; fullName: string | null; email: string | null;
  /** Seguridad de la sesión de plataforma: contraseña temporal y reconfirmación vigente. */
  mustChangePassword: boolean; stepUpUntil: string | null;
  /** Esta sesión: cuánto le queda según el servidor. La consola dura un tiempo fijo desde que se entra (24-04). */
  session?: { startedAt: string; endsAt: string; secondsLeft: number } | null;
  templates: Plantilla[];
  modules: Array<{ key: string; name: string; kind: 'fixed' | 'optional' }>;
  roles: Puesto[];
  /** Solo los vigentes; el CRUD completo vive en /plataforma/planes. */
  plans: PlanPlataforma[];
};

const Ctx = createContext<Plataforma | null>(null);
export function usePlataforma(): Plataforma {
  const p = useContext(Ctx);
  if (!p) throw new Error('usePlataforma fuera de su marco');
  return p;
}

/**
 * MARCO DE LA PLATAFORMA (ADR-037). Quien opera GymFlow no es personal de
 * ningún gimnasio: tiene su propia sesión, su propio marco y ninguna de las
 * pantallas del panel. Da de alta marcas y las acompaña.
 */
export default function PlataformaLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [yo, setYo] = useState<Plataforma | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reconfirmación (el panel de mayor rango): cualquier acción que modifica
  // pide la contraseña si no se confirmó en los últimos minutos.
  const [pidiendo, setPidiendo] = useState<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    alPedirReconfirmacion(() => new Promise<boolean>((resolver) => setPidiendo(() => resolver)));
    return () => alPedirReconfirmacion(null);
  }, []);
  // Cualquier 401 de sesión en la consola lleva al login con su motivo y la pantalla donde estaba (24-06).
  useEffect(() => alPerderSesion((motivo) => irAEntrar(motivo)), []);
  // Sesión cerrada por inactividad (o desde otro equipo): de vuelta al login, diciendo por qué.
  // Revisar NO cuenta como uso (24-04): cada consulta renueva la sesión, así
  // que preguntar cada minuto con la consola abierta y sin tocar la mantenía
  // viva para siempre y los minutos «sin uso» nunca llegaban. Se pregunta solo
  // si hubo actividad en el último minuto, al volver tras un rato o al volver a la pestaña.
  useEffect(() => {
    let ultimoUso = Date.now();
    // El 401 trae el porqué (inactividad, cerrada desde otro equipo, red no permitida…): lo atiende `alPerderSesion`.
    const revisar = () => { api('/platform/me').catch(() => undefined); };
    const usar = () => {
      const antes = ultimoUso;
      ultimoUso = Date.now();
      if (ultimoUso - antes > 60_000) revisar();
    };
    const t = setInterval(() => { if (Date.now() - ultimoUso < 60_000) revisar(); }, 60_000);
    const alVolver = () => { if (document.visibilityState === 'visible') revisar(); };
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const ev of eventos) window.addEventListener(ev, usar, { passive: true });
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
      for (const ev of eventos) window.removeEventListener(ev, usar);
    };
  }, [router]);

  useEffect(() => {
    api<Plataforma>('/platform/me').then(setYo).catch((e) => {
      if (e instanceof ApiError && e.status === 401) irAEntrar(finDeSesion(e));
      // El personal de un gimnasio no entra aquí: lo regresa a su panel.
      else if (e instanceof ApiError && e.status === 404) router.replace('/panel');
      else setError('No se pudo conectar con el servidor.');
    });
  }, [router]);

  // El tope de la sesión, a la vista (24-04): diez minutos antes se avisa; a la hora, al login con su motivo.
  const cierre = useFinDeSesion(yo?.session?.secondsLeft);

  const pathname = usePathname();
  // Título de la pestaña (UX7): la sección de la plataforma donde estás.
  useEffect(() => {
    const sec = pathname.startsWith('/plataforma/cobranza') ? 'Cobranza' : pathname.startsWith('/plataforma/precios') ? 'Precios'
      : pathname.startsWith('/plataforma/planes') ? 'Planes' : pathname.startsWith('/plataforma/factura') ? 'Factura' : pathname.startsWith('/plataforma/seguridad') ? 'Seguridad'
        : pathname === '/plataforma' ? 'Marcas' : 'Marca';
    document.title = `${sec} · GymFlow Plataforma`;
  }, [pathname]);
  async function salir() {
    // Cierra la sesión y borra lo que la consola guardó en este navegador.
    await salirDeEsteEquipo('/platform/logout');
    router.replace('/login');
  }

  return (
    <ToastProvider>
      <div className="plataforma">
        <header className="plataforma-barra">
          <Link href="/plataforma" className="consola-marca">
            <span className="brand-mark"><Marca size={18} /></span>
            <span className="strong">GymFlow</span>
            <span className="consola-sello"><ShieldCheck aria-hidden /><span>Consola de plataforma</span></span>
          </Link>
          {/* Con la contraseña temporal no hay a dónde ir: primero se cambia. */}
          {yo && !yo.mustChangePassword && <nav className="row" style={{ gap: 4, marginLeft: 16 }} aria-label="Secciones de la plataforma">
            {[['/plataforma', 'Marcas'], ['/plataforma/cobranza', 'Cobranza'], ['/plataforma/precios', 'Precios'], ['/plataforma/planes', 'Planes'], ['/plataforma/seguridad', 'Seguridad']].map(([href, label]) => (
              <Link key={href} href={href!} aria-current={(href === '/plataforma' ? pathname === href : pathname.startsWith(href!)) ? 'page' : undefined} className={`btn btn-ghost btn-sm${(href === '/plataforma' ? pathname === href : pathname.startsWith(href!)) ? ' is-active' : ''}`}>{label}</Link>
            ))}
          </nav>}
          <span className="topbar-spacer" />
          {yo && <span className="small consola-quien">{yo.fullName ?? yo.email}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => void salir()}><LogOut size={15} />Salir</button>
        </header>
        <main className="content">
          {error && <p className="danger">{error}</p>}
          {yo && cierre.porCerrar && cierre.fin !== null && <AvisoDeCierre fin={cierre.fin} />}
          {!yo && !error && <EsqueletoPagina />}
          {yo && yo.mustChangePassword && <ClaveTemporal onListo={() => setYo({ ...yo, mustChangePassword: false })} onSalir={() => void salir()} />}
          {yo && !yo.mustChangePassword && <Ctx.Provider value={yo}>{children}</Ctx.Provider>}
          {pidiendo && <Reconfirmar onFin={(ok) => { pidiendo(ok); setPidiendo(null); }} />}
        </main>
      </div>
    </ToastProvider>
  );
}

/** Minutos antes del tope en que la consola avisa que la sesión se va a cerrar (igual que el panel). */
const AVISAR_ANTES_MS = 10 * 60_000;

/**
 * La sesión de la consola dura un tiempo fijo desde que se entra y no se
 * alarga con el uso. Se cuenta con el reloj de este equipo desde lo que el
 * servidor dijo que faltaba (`/platform/me` → `session.secondsLeft`).
 */
function useFinDeSesion(segundos: number | undefined): { fin: number | null; porCerrar: boolean } {
  const [fin, setFin] = useState<number | null>(null);
  useEffect(() => { if (segundos !== undefined) setFin(recordarFin(segundos)); }, [segundos]);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (fin === null) return;
    const tic = () => setAhora(Date.now());
    const t = setInterval(tic, 30_000);
    // Con la pestaña de fondo o la computadora dormida, el reloj se atrasa: al volver se revisa.
    document.addEventListener('visibilitychange', tic);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tic); };
  }, [fin]);
  useEffect(() => { if (fin !== null && ahora >= fin) irAEntrar('SESSION_EXPIRED'); }, [fin, ahora]);
  return { fin, porCerrar: fin !== null && ahora < fin && fin - ahora <= AVISAR_ANTES_MS };
}

/** Diez minutos antes del tope: a qué hora se cierra y cómo empezar otra sesión sin perder la pantalla. */
function AvisoDeCierre({ fin }: { fin: number }) {
  async function volverAEntrar() {
    // Cierra ESTA sesión de la consola (queda asentado) y va al login con la pantalla donde estaba.
    await api('/platform/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
    window.location.replace(rutaDeEntrada(null, rutaActual()));
  }
  return (
    <div className="aviso-consola" data-testid="aviso-cierre">
      <Callout tone="warn" title={`Tu sesión de la consola se cierra a las ${hora(new Date(fin))}`}>
        <p>Dura un tiempo fijo desde que entraste y no se alarga con el uso. Termina lo que estás haciendo; si vas a empezar algo largo —emitir el mes, conciliar pagos—, vuelve a entrar ahora.</p>
        <button type="button" className="btn btn-secondary btn-sm callout-accion" onClick={() => void volverAEntrar()}>Volver a entrar ahora</button>
      </Callout>
    </div>
  );
}

/** La contraseña de la cuenta para una acción crítica. Vale unos minutos en esta sesión. */
function Reconfirmar({ onFin }: { onFin: (ok: boolean) => void }) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    if (!clave) { setError('Escribe tu contraseña.'); irAlPrimerError(); return; }
    setEnviando(true); setError(null);
    try {
      await api('/platform/reauth', { method: 'POST', body: JSON.stringify({ password: clave }) });
      onFin(true);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo confirmar'); setClave(''); } finally { setEnviando(false); }
  }
  return (
    <Dialog open onClose={() => onFin(false)} title="Confirma que eres tú" sub="Esta acción cambia algo en una marca o en el cobro. Escribe tu contraseña; vale unos minutos."
      footer={<><Button variant="secondary" onClick={() => onFin(false)}>Cancelar</Button><Button icon={<ShieldCheck />} loading={enviando} onClick={() => void confirmar()}>Confirmar</Button></>}>
      <Field label="Tu contraseña" htmlFor="reauth" required error={error}>
        <input id="reauth" className="input input-lg" type="password" autoFocus autoComplete="current-password"
          value={clave} onChange={(e) => setClave(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void confirmar(); }} />
      </Field>
    </Dialog>
  );
}

/**
 * Con la contraseña temporal no se opera nada: primero se elige la propia.
 * Lo normal es elegirla en /login al entrar (A4-N1); esto cubre a quien llega
 * directo aquí con esa sesión. No vuelve a pedir la temporal: la API acepta el
 * cambio sin ella durante los 15 minutos siguientes a entrar con la temporal,
 * y después pide volver a entrar (24-10).
 */
function ClaveTemporal({ onListo, onSalir }: { onListo: () => void; onSalir: () => void }) {
  const [f, setF] = useState({ nueva: '', repetir: '' });
  const [intentado, setIntentado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volverAEntrar, setVolverAEntrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const errores: Record<string, string> = {
    ...(f.nueva.length < 12 ? { nueva: 'Mínimo 12 caracteres.' } : {}),
    ...(f.repetir !== f.nueva ? { repetir: 'No coincide con la nueva.' } : {}),
  };
  const e = (k: string) => (intentado ? errores[k] ?? null : null);
  async function guardar() {
    setIntentado(true);
    if (Object.keys(errores).length > 0) { irAlPrimerError(); return; }
    setEnviando(true); setError(null);
    try {
      await api('/platform/password', { method: 'POST', body: JSON.stringify({ next: f.nueva }) });
      onListo();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : 'No se pudo cambiar');
      // Pasaron más de 15 minutos desde que entró con la temporal: hay que volver a entrar con ella.
      setVolverAEntrar(x instanceof ApiError && x.status === 403);
    } finally { setEnviando(false); }
  }
  return (
    <div className="card card-pad stack" style={{ maxWidth: 480, margin: '40px auto' }} data-testid="cambiar-clave-temporal">
      <p className="eyebrow">Primer ingreso</p>
      <div className="row gap-10"><KeyRound /><h1 className="section-title m-0">Elige tu contraseña</h1></div>
      <p className="small muted">Entraste con una contraseña temporal: solo sirve para elegir la tuya, de al menos 12 caracteres. Al guardarla, las demás sesiones de esta cuenta se cierran.</p>
      {error && <Callout tone="danger">{error}</Callout>}
      {volverAEntrar && <Button variant="secondary" onClick={onSalir}>Volver a entrar</Button>}
      <Field label="Nueva contraseña" htmlFor="ct-n" required error={e('nueva')} hint={`${f.nueva.length} de 12 caracteres mínimo${f.nueva.length >= 12 ? ' ✓' : ''}`}><input id="ct-n" className="input" type="password" autoComplete="new-password" autoFocus value={f.nueva} onChange={(x) => setF({ ...f, nueva: x.target.value })} /></Field>
      <Field label="Repítela" htmlFor="ct-r" required error={e('repetir')}><input id="ct-r" className="input" type="password" autoComplete="new-password" value={f.repetir} onChange={(x) => setF({ ...f, repetir: x.target.value })} /></Field>
      <Button loading={enviando} onClick={() => void guardar()}>Guardar y continuar</Button>
    </div>
  );
}
