'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeftRight, Search, LogOut, Menu, KeyRound, ShieldCheck, ChevronDown, ChevronsUpDown, PanelLeft, MonitorSmartphone } from 'lucide-react';
import { useSession, useToast, errorText } from './session';
import { BotonTema, CLAVE_LATERAL } from './tema';
import { Avatar, Button, Callout, Dialog, Field, Skeleton, EsqueletoPagina } from './ui';
import { CommandPalette } from './command-palette';
import { api, alPerderSesion } from '@/lib/api';
import { hora } from '@/lib/format';
import { irAEntrar, recordarFin, volverAEntrar } from '@/lib/sesion';
import { rolDe } from '@/lib/labels';
import { FIRMAS, SECCIONES, barraInferior, menuAcomodado } from '@/modules/registro';
import { Puerta } from './puerta';
import { FranjaDeFirmas } from './firma/franja';
import { Campana } from './campana';
import { AvisoDeGymflow } from './cuenta-gymflow';
import { useAvisosNuevos } from './avisos-duena';
import { AvisoDeSolicitudes } from './solicitudes-gymflow';
import { Marca } from '@/components/compartido';

/**
 * Marco del panel: barra lateral, barra superior y buscador global.
 *
 * El menú sale del registro de secciones (`modules/registro.ts`): muestra las
 * de los módulos que el gimnasio tiene encendidos y que el rol puede ver.
 * Recepción ve cuatro cosas, la gerencia todas: cada quien ve su trabajo, no
 * un catálogo de lo que no puede abrir.
 *
 * Se acomoda POR TAREA (bloque 2.1; 1-02, DA-22; `menuAcomodado`): la gerencia
 * en cinco grupos (Mostrador · Clases y crecimiento · Dinero · Gimnasio ·
 * Control) con Inicio suelto arriba; recepción, coach y la dueña en una lista
 * plana, sin título. Los grupos de la gerencia se pliegan (queda abierto el
 * primero y el de la pantalla en la que se está), y todo el lateral se encoge
 * a una tira de iconos con el botón de la barra superior. Las dos cosas se
 * recuerdan en este equipo. En el teléfono, la dueña tiene además una barra
 * inferior con lo que abre a diario: Inicio · Dinero · Firmas · Equipo.
 */
/** Qué secciones del menú dejó abiertas o plegadas esta persona. */
const CLAVE_GRUPOS = 'gf-menu';

export function Shell({ children }: { children: ReactNode }) {
  const { me, org, can, activo, mirada, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  // La sesión que muere a media jornada lleva al login con su motivo y a la
  // pantalla donde estaba (24-06, 24-08): un solo lugar para todo el panel.
  useEffect(() => alPerderSesion((motivo) => irAEntrar(motivo)), []);
  // D-04 (bloque 4.1): la sesión del teléfono de la dueña se renueva con el uso; no tiene hora de cierre que avisar.
  const cierre = useFinDeSesion(me.session?.renews ? undefined : me.session?.secondsLeft);
  const [navOpen, setNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [altas, setAltas] = useState(0);
  const [clave, setClave] = useState(false);
  const [claveObligatoria, setClaveObligatoria] = useState(!!me.mustChangePassword);

  useEffect(() => { setNavOpen(false); setMenuUsuario(false); }, [pathname]);
  // Título de la pestaña por pantalla (UX7): con varias abiertas, ya no todas dicen "GymFlow".
  useEffect(() => {
    const sec = SECCIONES.find((x) => pathname === x.href || pathname.startsWith(`${x.href}/`) || x.rutas?.some((r) => pathname === r || pathname.startsWith(`${r}/`)));
    const extra = /^\/socios\/[^/]+/.test(pathname) ? 'Ficha del socio' : pathname === '/seguridad' ? 'Mis sesiones' : null;
    const deseado = `${extra ?? sec?.etiqueta ?? 'Panel'} · GymFlow`;
    const aplicar = () => { if (document.title !== deseado) document.title = deseado; };
    aplicar();
    // Al navegar con el menú, Next vuelve a escribir <title> con el de los
    // metadatos («GymFlow») DESPUÉS de este efecto: se vigila y se repone.
    const vigia = new MutationObserver(aplicar);
    vigia.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => vigia.disconnect();
  }, [pathname]);

  // El lateral encogido: el atributo ya lo puso el script del <head>.
  const [rail, setRail] = useState(false);
  useEffect(() => { setRail(document.documentElement.dataset.side === 'rail'); }, []);
  function alternarLateral() {
    // En el teléfono el menú es un cajón que se abre encima; en escritorio
    // se encoge a iconos y deja el espacio a la pantalla.
    if (window.matchMedia('(max-width: 860px)').matches) { setNavOpen(true); return; }
    const encogido = !rail;
    setRail(encogido);
    if (encogido) document.documentElement.dataset.side = 'rail'; else delete document.documentElement.dataset.side;
    try { if (encogido) localStorage.setItem(CLAVE_LATERAL, 'rail'); else localStorage.removeItem(CLAVE_LATERAL); } catch { /* sin almacenamiento: solo esta visita */ }
  }

  // Secciones plegadas o abiertas a mano. Lo no elegido sigue la regla por omisión.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setAbiertos(JSON.parse(localStorage.getItem(CLAVE_GRUPOS) ?? '{}') as Record<string, boolean>); } catch { /* se queda la regla por omisión */ }
  }, []);
  function alternarGrupo(titulo: string, abierto: boolean) {
    setAbiertos((a) => {
      const n = { ...a, [titulo]: !abierto };
      try { localStorage.setItem(CLAVE_GRUPOS, JSON.stringify(n)); } catch { /* solo esta visita */ }
      return n;
    });
  }

  // Menú de la cuenta: tema, contraseña y salir, en un solo botón.
  const [menuUsuario, setMenuUsuario] = useState(false);
  const pie = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuUsuario) return;
    const fuera = (e: MouseEvent) => { if (!pie.current?.contains(e.target as Node)) setMenuUsuario(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuUsuario(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [menuUsuario]);

  // ⌘K / Ctrl+K abre el buscador desde cualquier pantalla: recepción busca
  // socios todo el día y no debería tener que navegar para hacerlo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Autorizaciones que esta persona puede dar: se revisan cada 15 s mientras
  // la pestaña se ve. Es lo que convierte el panel del teléfono de la dueña
  // en el lugar donde le llegan las firmas que pide el mostrador.
  const firma = FIRMAS.some((p) => can(p));
  const [porFirmar, setPorFirmar] = useState(0);
  useEffect(() => {
    if (!firma) return;
    const revisar = () => {
      if (document.hidden) return;
      api<{ requests: unknown[] }>('/approvals/inbox').then((r) => setPorFirmar(r.requests.length)).catch(() => undefined);
    };
    revisar();
    const t = setInterval(revisar, 15_000);
    return () => clearInterval(t);
  }, [firma]);

  // El contador de altas se refresca al navegar, pero no más de una vez cada
  // 30 s: antes cada clic del menú descargaba la bandeja completa (OPT-07).
  const ultimaCuenta = useRef(0);
  useEffect(() => {
    if (!can('members:intake:read') || !activo('intake')) return;
    if (Date.now() - ultimaCuenta.current < 30_000 && !pathname.startsWith('/altas')) return;
    ultimaCuenta.current = Date.now();
    api<{ pending: number }>('/intakes/pending-count')
      .then((r) => setAltas(r.pending))
      .catch(() => undefined);
  }, [can, activo, pathname]);

  // D-05 (bloque 4.2): los avisos que la dueña no ha visto, en su menú. Para los demás puestos es cero y no pide nada.
  const avisosNuevos = useAvisosNuevos();
  const contador = { altas, firmas: porFirmar, avisos: avisosNuevos };
  const visibles = menuAcomodado(mirada).map((g) => ({
    title: g.titulo,
    items: g.secciones.map((sec) => {
      const Icono = sec.icono;
      return { href: sec.href, rutas: sec.rutas ?? [], label: sec.etiqueta, icon: <Icono />, count: sec.contador ? contador[sec.contador] : 0 };
    }),
  }));
  // La barra inferior de la dueña en el teléfono (DA-22): solo existe para ella.
  const barra = barraInferior(mirada).map((b) => {
    const Icono = b.seccion.icono;
    return { href: b.seccion.href, label: b.etiqueta, icon: <Icono />, count: b.seccion.contador ? contador[b.seccion.contador] : 0 };
  });

  const enRuta = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Una entrada del menú queda marcada también en sus otras rutas («Mi gimnasio» en /gimnasio, /sucursales y /modulos; Inicio en /arranque).
  const enSeccion = (i: { href: string; rutas: readonly string[] }) => enRuta(i.href) || i.rutas.some(enRuta);

  const grupoActivo = visibles.find((g) => g.title !== null && g.items.some((i) => enSeccion(i)))?.title ?? undefined;
  // Al llegar a una pantalla —también desde el buscador— su sección se abre,
  // aunque se hubiera plegado antes: el menú siempre dice dónde se está.
  useEffect(() => {
    if (grupoActivo) setAbiertos((a) => (a[grupoActivo] === false ? { ...a, [grupoActivo]: true } : a));
  }, [grupoActivo, pathname]);
  // Solo se pliegan los grupos con título, y solo si hay más de uno (la lista plana no tiene nada que plegar).
  const conTitulo = visibles.filter((g) => g.title !== null);
  const plegable = conTitulo.length > 1;

  const nombre = me.fullName ?? me.email ?? 'Usuario';

  return (
    <div className="shell" data-nav={navOpen ? 'open' : 'closed'} data-barra={barra.length > 0 || undefined} onClick={(e) => {
      if (navOpen && e.target === e.currentTarget) setNavOpen(false);
    }}>
      <aside className="side">
        <div className="side-brand">
          <span className="brand-mark"><Marca size={18} /></span>
          <div className="min-w-0">
            <div className="brand-name">GymFlow</div>
            <div className="brand-org">{org.tradeName}</div>
          </div>
        </div>

        <nav className="side-nav">
          {visibles.map((g, n) => {
            const abierto = g.title === null || !plegable || (abiertos[g.title] ?? (g === conTitulo[0] || g.title === grupoActivo));
            // Lo pendiente de una sección plegada se sigue viendo en su título.
            const pendientes = g.items.reduce((t, i) => t + (i.count ?? 0), 0);
            const id = `menu-${n}`;
            return (
              <div className="side-group" key={g.title ?? `suelto-${n}`} data-open={abierto} data-suelto={g.title === null || undefined}>
                {/* Sin título (Inicio suelto, o la lista plana de recepción, coach y dueña) no se pinta encabezado ni chevrón. */}
                {g.title === null ? null : plegable ? (
                  <button type="button" className="side-group-title" aria-expanded={abierto} aria-controls={id} onClick={() => alternarGrupo(g.title!, abierto)}>
                    <span>{g.title}</span>
                    {!abierto && pendientes > 0 && <span className="side-count">{pendientes}</span>}
                    <ChevronDown className="side-group-chevron" size={14} />
                  </button>
                ) : (
                  <div className="side-group-title">{g.title}</div>
                )}
                <div className="side-group-items" id={id}>
                  {g.items.map((i) => (
                    <Link key={i.href} href={i.href} className="side-link" title={rail ? i.label : undefined} aria-current={enSeccion(i) ? 'page' : undefined}>
                      {i.icon}<span>{i.label}</span>
                      {!!i.count && <span className="side-count">{i.count}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="side-foot" ref={pie}>
          {menuUsuario && (
            <div className="side-menu" role="menu" aria-label="Tu cuenta">
              <BotonTema conTexto />
              <button type="button" role="menuitem" onClick={() => { setMenuUsuario(false); setClave(true); }}><KeyRound size={17} /><span>Cambiar contraseña</span></button>
              {/* Dónde está abierta la cuenta y cerrar las demás (24-14). */}
              <button type="button" role="menuitem" onClick={() => { setMenuUsuario(false); router.push('/seguridad'); }}><MonitorSmartphone size={17} /><span>Mis sesiones</span></button>
              {/* 24-09 (bloque 4.11): en el mostrador el turno siguiente no opera con el nombre de quien se fue. Cierra esta
                  sesión y deja la entrada lista para la otra persona; la caja abierta sigue abierta a nombre de quien la abrió. */}
              {(me.roleKeys ?? []).includes('RECEPTION') && (
                <button type="button" role="menuitem" onClick={() => void logout('/login?relevo=1')}><ArrowLeftRight size={17} /><span>Cambiar de usuario</span></button>
              )}
              <button type="button" role="menuitem" onClick={() => void logout()}><LogOut size={17} /><span>Cerrar sesión</span></button>
            </div>
          )}
          <button type="button" className="side-user" aria-haspopup="menu" aria-expanded={menuUsuario} title={rail ? nombre : undefined} onClick={() => setMenuUsuario((v) => !v)}>
            <Avatar name={nombre} size={34} />
            <span className="side-user-text">
              <span className="side-user-name ellipsis">{nombre}</span>
              <span className="side-user-role">{rolDe(me.roleKeys)}</span>
            </span>
            <ChevronsUpDown className="side-user-chevron" size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon topbar-menu" onClick={alternarLateral} aria-label="Menú" title={rail ? 'Mostrar el menú completo' : 'Ocultar el menú'}>
            <Menu className="topbar-menu-movil" /><PanelLeft className="topbar-menu-escritorio" />
          </button>
          <button className="topbar-search" onClick={() => setCmdOpen(true)}>
            <Search size={16} />
            <span>{can('members:read') ? 'Buscar socio por nombre, código o teléfono…' : 'Buscar una pantalla…'}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="topbar-spacer" />
          {/* Mensajes por mandar a los socios (bloque 2.9): solo para quien los manda. */}
          <Campana />
          {porFirmar > 0 && !pathname.startsWith('/autorizaciones') && (
            <Link href="/autorizaciones" className="btn btn-volt btn-sm topbar-firma">
              <ShieldCheck size={16} />Por autorizar · {porFirmar}
            </Link>
          )}
        </header>
        {/* Las firmas pedidas al teléfono que el mostrador sigue esperando (D29-03, bloque 2.10). */}
        <FranjaDeFirmas />
        <main className="content">
          {cierre.porCerrar && cierre.fin !== null && <AvisoDeCierre fin={cierre.fin} />}
          {/* Lo que GymFlow le avisa al dueño: factura, vencimiento y suspensión (D-37, bloque 3.11). Solo él lo ve. */}
          <AvisoDeGymflow />
          {/* GymFlow contestó una solicitud de cambio de datos o de marca (D-27, bloque 4.6). Solo lo ve quien la pidió. */}
          <AvisoDeSolicitudes />
          <Puerta>{children}</Puerta>
        </main>
      </div>

      {barra.length > 0 && (
        <nav className="barra-inferior" aria-label="Lo de todos los días" data-testid="barra-inferior">
          {barra.map((i) => (
            <Link key={i.href} href={i.href} className="barra-inferior-pestana" aria-current={enRuta(i.href) ? 'page' : undefined}>
              <span className="barra-inferior-icono">{i.icon}{!!i.count && <span className="side-count">{i.count}</span>}</span>
              <span>{i.label}</span>
            </Link>
          ))}
        </nav>
      )}

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      {clave && !claveObligatoria && <CambiarClave onClose={() => setClave(false)} />}
      {claveObligatoria && <CambiarClave obligatoria onClose={() => setClaveObligatoria(false)} />}
    </div>
  );
}

/** Minutos antes del tope en que el panel avisa que la sesión se va a cerrar. */
const AVISAR_ANTES_MS = 10 * 60_000;

/**
 * EL TOPE, A LA VISTA (24-04). La sesión dura un tiempo fijo desde que se
 * entra y no se alarga con el uso: diez minutos antes, el panel lo dice; a la
 * hora, lleva al login con el motivo y la pantalla donde estaba, en vez de
 * dejar botones que ya no sirven. Se cuenta con el reloj de este equipo
 * desde lo que el servidor dijo que faltaba, igual que la cookie.
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
  return (
    <div className="mb-16" data-testid="aviso-cierre">
      <Callout tone="warn" title={`Tu sesión se cierra a las ${hora(new Date(fin))}`}>
        <p>Dura un tiempo fijo desde que entraste y no se alarga con el uso. Termina lo que estás haciendo; si vas a empezar algo largo, vuelve a entrar ahora.</p>
        <button type="button" className="btn btn-secondary btn-sm callout-accion" onClick={() => void volverAEntrar()}>Volver a entrar ahora</button>
      </Callout>
    </div>
  );
}

/** Lo que se ve mientras llega la sesión: la forma del panel, no una pantalla en blanco. */
export function ShellSkeleton() {
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <span className="brand-mark"><Marca size={18} /></span>
          <div className="brand-name">GymFlow</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar" />
        <main className="content">
          <div className="stack">
            <Skeleton h={28} w={260} />
            <Skeleton h={16} w={420} />
            <div className="grid grid-4 mt-12">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={110} r={16} />)}
            </div>
            <EsqueletoPagina />
          </div>
        </main>
      </div>
    </div>
  );
}

/** La misma regla de la API para todos, personal y plataforma (24-10). */
const MINIMO_CLAVE = 12;

/**
 * Cambiar la propia contraseña. La temporal que da la gerencia ya no se
 * cambia aquí: con ella solo se entra a elegir la propia, en /login (A4-N1).
 */
export function CambiarClave({ onClose, obligatoria = false }: { onClose: () => void; obligatoria?: boolean }) {
  const toast = useToast();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [otra, setOtra] = useState('');
  const [enviando, setEnviando] = useState(false);
  const valida = nueva.length >= MINIMO_CLAVE && nueva === otra && actual.length > 0;
  async function guardar() {
    setEnviando(true);
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify({ current: actual, next: nueva }) });
      toast('ok', 'Contraseña cambiada. Tus otras sesiones se cerraron.');
      onClose();
    } catch (e) { toast('error', errorText(e, 'No se pudo cambiar')); } finally { setEnviando(false); }
  }
  return (
    <Dialog open obligatorio={obligatoria} onClose={onClose} title={obligatoria ? 'Elige tu propia contraseña' : 'Cambiar contraseña'}
      footer={<>{!obligatoria && <Button variant="secondary" onClick={onClose}>Cancelar</Button>}<Button loading={enviando} disabled={!valida} onClick={() => void guardar()}>Cambiar</Button></>}>
      <div className="stack">
        {obligatoria && (
          <p className="small muted">
            Entraste con una contraseña temporal: solo sirve para elegir la tuya. Mientras no la cambies no puedes operar ni autorizar.
          </p>
        )}
        <Field label="Contraseña actual" htmlFor="cc-a"><input id="cc-a" className="input" type="password" autoComplete="current-password" autoFocus value={actual} onChange={(e) => setActual(e.target.value)} /></Field>
        <Field label="Nueva contraseña" htmlFor="cc-n" hint={`${nueva.length} de ${MINIMO_CLAVE} caracteres mínimo${nueva.length >= MINIMO_CLAVE ? ' ✓' : ''}`}><input id="cc-n" className="input" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} /></Field>
        <Field label="Repítela" htmlFor="cc-o"><input id="cc-o" className="input" type="password" autoComplete="new-password" value={otra} onChange={(e) => setOtra(e.target.value)} /></Field>
        {otra && nueva !== otra && <p className="hint danger">No coinciden.</p>}
      </div>
    </Dialog>
  );
}
