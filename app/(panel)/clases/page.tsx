'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarDays, CalendarPlus, ListChecks, Plus, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaCorta, hora } from '@/lib/format';
import { hoyEn, masDias, zonaDe } from '@/lib/zonas';
import { bloquesEnTexto, type Plantilla, type Sesion, type Tipo } from '@/lib/clases';
import { useSession, useToast, errorText } from '@/components/session';
import { Button, Card, Empty, ErrorCarga, MenuMas, Opciones, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { ListaDialog } from '@/components/clase-lista';
import { Sesiones } from './sesiones';
import { Horario } from './horario';
import { HorarioDialog, RetirarDialog, TipoDialog } from './dialogos';

type Vista = 'sesiones' | 'horario';
type Retiro = { kind: 'tipo' | 'horario' | 'sesion'; id: string; titulo: string; detalle: string };

/**
 * CLASES (bloque 2.5).
 *
 * Dos pestañas de trabajo en vez de cuatro bloques del mismo peso (11-12,
 * 11-17): «Sesiones» —hoy y los próximos días, lo que recepción y el coach
 * usan— y «Horario» —qué clases se dan, la semana tipo, las pausas y las
 * reglas de reserva, que es donde arma la gerencia y los demás consultan—.
 * La página carga los datos y decide qué diálogo se abre; cada parte vive en
 * su archivo.
 *
 * «Mis clases» (11-11): quien imparte clases ve primero las suyas, con «Pasar
 * lista» a un toque, y «Todas» a un lado. `/clases?mine=1` (el Inicio del
 * coach, bloque 2.6) abre así para cualquiera.
 */
export default function ClasesPage() {
  const { branches, inScope, can, canOrg, activoEn, org, me } = useSession();
  const toast = useToast();
  // Solo las sucursales que dan clases (11-23): una que las dejó no se arma desde aquí.
  const sedes = branches.filter((b) => b.isActive && inScope(b.id) && activoEn('classes', b.id));
  const [sede, setSede] = useState(sedes[0]?.id ?? '');
  const zona = zonaDe(branches.find((b) => b.id === sede), org);
  const hoy = hoyEn(zona);
  const [vista, setVista] = useState<Vista>('sesiones');
  // El coach (y solo coach) aterriza en sus clases; los demás, en todas.
  const esCoach = (me.roleKeys ?? []).includes('COACH');
  // Quien es SOLO coach opera las sesiones que imparte (D-28): en las demás ve el cupo, sin «Inscribir».
  const soloCoach = (me.roleKeys ?? []).length > 0 && (me.roleKeys ?? []).every((k) => k === 'COACH');
  const [mias, setMias] = useState(soloCoach);
  const [tipos, setTipos] = useState<Tipo[] | null>(null);
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [editarTipo, setEditarTipo] = useState<Tipo | 'nuevo' | null>(null);
  const [horario, setHorario] = useState<{ weekday?: number; tipoId?: string; unica?: boolean; plantilla?: Plantilla } | null>(null);
  const [retirar, setRetirar] = useState<Retiro | null>(null);
  const [lista, setLista] = useState<{ sesion: Sesion; inscribir: boolean } | null>(null);
  const [generando, setGenerando] = useState(false);
  const gestiona = can('classes:manage');
  // D-28: cancelar (una sesión, un horario, una clase) es de la gerencia; al coach ni se le ofrece.
  const cancela = can('classes:session:cancel');

  // `/clases?vista=horario` abre en Horario. Se lee al montar: con useSearchParams la página dejaría de prerenderse.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('vista') === 'horario') setVista('horario');
    if (q.get('mine') === '1') setMias(true);
  }, []);
  const direccion = (v: Vista, soloMias: boolean) => window.history.replaceState(null, '', v === 'horario' ? '?vista=horario' : soloMias ? '?mine=1' : window.location.pathname);
  function cambiarVista(v: Vista) { setVista(v); direccion(v, mias); }
  function cambiarMias(soloMias: boolean) { setMias(soloMias); direccion(vista, soloMias); }

  const cargar = useCallback(async () => {
    if (!sede) { setTipos([]); setPlantillas([]); setSesiones([]); return; }
    // Desde ayer (y se descarta lo que no sea de hoy en adelante EN LA SUCURSAL):
    // la clase que se está dando, y la que acaba de terminar, siguen en pantalla
    // aunque la computadora esté en otra zona.
    const desde = new Date(Date.now() - 86_400_000).toISOString();
    const hasta = new Date(Date.now() + 8 * 86_400_000).toISOString();
    const [t, p, s] = await Promise.all([
      api<{ types: Tipo[] }>('/classes/types'),
      api<{ templates: Plantilla[] }>(`/classes/templates?branchId=${sede}`),
      api<{ schedules: Sesion[] }>(`/classes/schedules?branchId=${sede}&from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`),
    ]);
    const dia = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: zona });
    setTipos(t.types); setPlantillas(p.templates);
    setSesiones(s.schedules.filter((x) => dia(x.startsAt) >= hoy && dia(x.startsAt) <= masDias(hoy, 6)));
  }, [sede, zona, hoy]);

  const pedir = useCallback(() => {
    setFallo(null);
    void cargar().catch((e) => { setFallo(errorText(e, 'No se pudieron cargar las clases')); });
  }, [cargar]);
  useEffect(() => { setPlantillas(null); setSesiones(null); pedir(); }, [pedir]);

  const activos = (tipos ?? []).filter((t) => t.isActive);
  const retirados = (tipos ?? []).filter((t) => !t.isActive);

  async function reactivar(t: Tipo) {
    try {
      await api(`/classes/types/${t.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) });
      toast('ok', `${t.name} vuelve a estar disponible. Agrégala al horario para que aparezca en el portal.`);
      await cargar();
    } catch (e) { toast('error', errorText(e)); }
  }

  /** El horario existe y no hay sesiones: se generan aquí en vez de esperar al trabajo de la noche. */
  async function generar() {
    setGenerando(true);
    try {
      const r = await api<{ created: number; note: string | null }>('/classes/schedules/generate', { method: 'POST', body: '{}' });
      toast('ok', r.created > 0 ? `Se generaron ${r.created} sesiones.${r.note ? ` ${r.note}.` : ''}` : 'No había sesiones por generar: revisa el horario semanal y las pausas.');
      await cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudieron generar las sesiones')); } finally { setGenerando(false); }
  }

  const cancelarSesion = (s: Sesion) => setRetirar({
    kind: 'sesion', id: s.id, titulo: `Cancelar ${s.className} del ${fechaCorta(s.startsAt, zona)} a las ${hora(s.startsAt, zona)}`,
    detalle: s.bookedCount > 0
      ? `${s.bookedCount} ${s.bookedCount === 1 ? 'persona tiene' : 'personas tienen'} lugar: lo pierden sin que cuente como falta, y si no habían pagado la clase suelta, su cargo se anula. Una clase ya pagada se devuelve desde la ficha del socio.`
      : 'Nadie ha reservado todavía.',
  });
  const quitarHorario = (p: Plantilla) => setRetirar({
    kind: 'horario', id: p.id, titulo: `Quitar ${p.className ?? 'la clase'} del horario`,
    detalle: `Este horario incluye ${bloquesEnTexto(p.slots)}. Se cancelan sus sesiones futuras; quien tenía lugar lo pierde sin que cuente como falta. Si solo cambia la hora o el día, edítalo en vez de quitarlo.`,
  });
  const retirarTipo = (t: Tipo) => setRetirar({
    kind: 'tipo', id: t.id, titulo: `Dejar de dar ${t.name}`,
    detalle: 'Se quitan todos sus horarios en todas las sucursales y se cancelan sus sesiones futuras. Quien tenía lugar lo pierde sin que cuente como falta, y si no había pagado la clase suelta, su cargo se anula.',
  });

  const cargando = tipos === null;
  return (
    <>
      <PageHeader
        title="Clases"
        sub="Las sesiones que los socios reservan desde su teléfono, y el horario del que salen."
        actions={<>
          {sedes.length > 1 && (
            <select className="select clases-sede" value={sede} onChange={(e) => setSede(e.target.value)} aria-label="Sucursal">
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {/* Con la lista vacía, el botón vive en el aviso de abajo: no dos iguales en pantalla. */}
          {gestiona && activos.length > 0 && <Button icon={<CalendarPlus />} onClick={() => setHorario({})}>Agregar al horario</Button>}
          {gestiona && activos.length > 0 && (
            <MenuMas items={[
              { label: 'Agregar una sesión única', icon: <CalendarClock />, onClick: () => setHorario({ unica: true }) },
              { label: 'Nueva clase', icon: <Plus />, onClick: () => setEditarTipo('nuevo') },
            ]} />
          )}
        </>}
      />

      {fallo ? <ErrorCarga mensaje={fallo} onReintentar={pedir} />
        : sedes.length === 0 ? <Card><Empty icon={<CalendarDays />} title="Ninguna de tus sucursales da clases" text="Clases se enciende por sucursal en Módulos." /></Card>
          : cargando ? <div className="stack"><Skeleton h={150} r={16} /><Skeleton h={300} r={16} /></div>
            : activos.length === 0 ? (
              <>
                <Card>
                  <Empty icon={<CalendarDays />} title={retirados.length > 0 ? 'Este gimnasio ya no ofrece clases' : 'Aún no hay clases'}
                    text="Mientras no haya ninguna, el portal del socio no muestra la sección de clases. Si empiezan a dar alguna, créala aquí y agrégala al horario."
                    action={gestiona && <Button icon={<Plus />} onClick={() => setEditarTipo('nuevo')}>Crear la primera clase</Button>} />
                </Card>
                {/* Sin clases activas solo queda lo que se puede reactivar. */}
                <Horario sede={sede} tipos={tipos ?? []} plantillas={plantillas} weekdayHoy={new Date(`${hoy}T12:00:00Z`).getUTCDay()} gestiona={gestiona} cancela={cancela}
                  onNuevaClase={() => setEditarTipo('nuevo')} onEditarTipo={setEditarTipo} onRetirarTipo={retirarTipo} onReactivar={(t) => void reactivar(t)}
                  onNuevoBloque={(weekday) => setHorario({ weekday })} onEditarHorario={(plantilla) => setHorario({ plantilla })} alCambiar={pedir} />
              </>
            ) : (
              <>
                <Tabs<Vista> value={vista} onChange={cambiarVista} tabs={[
                  { value: 'sesiones', label: 'Sesiones', icon: <ListChecks /> },
                  { value: 'horario', label: 'Horario', icon: <CalendarDays /> },
                ]} />
                {vista === 'sesiones' && (esCoach || mias) && (
                  <div className="mb-16">
                    <Opciones forma="segmentado" etiqueta="Qué sesiones ver" value={mias ? 'mias' : 'todas'} onChange={(v) => cambiarMias(v === 'mias')}
                      opciones={[{ value: 'mias', label: 'Mis clases' }, { value: 'todas', label: 'Todas' }]} />
                  </div>
                )}
                {vista === 'sesiones' ? (
                  <Sesiones sesiones={mias && sesiones ? sesiones.filter((x) => x.coachUserId === me.userId) : sesiones} zona={zona} hoy={hoy}
                    sinNada={mias ? { titulo: 'No impartes ninguna clase en los próximos 7 días', texto: 'Aquí aparecen las sesiones en las que tú eres el coach o cubres a alguien. En «Todas» ves las demás.' } : undefined}
                    puede={{ verLista: can('classes:read'), inscribir: can('classes:book_for_member'), cancelar: cancela, soloLasDe: soloCoach ? me.userId : null }}
                    onAbrir={(sesion, inscribir) => setLista({ sesion, inscribir })} onCancelar={cancelarSesion}
                    vacio={mias ? <Button variant="secondary" onClick={() => cambiarMias(false)}>Ver todas las sesiones</Button>
                      : canOrg('classes:manage') && (plantillas ?? []).length > 0
                      ? <Button variant="secondary" icon={<RefreshCw />} loading={generando} onClick={() => void generar()}>Generar las sesiones ahora</Button>
                      : gestiona ? <Button variant="secondary" icon={<CalendarDays />} onClick={() => cambiarVista('horario')}>Ir al horario</Button> : undefined} />
                ) : (
                  <Horario sede={sede} tipos={tipos ?? []} plantillas={plantillas} weekdayHoy={new Date(`${hoy}T12:00:00Z`).getUTCDay()} gestiona={gestiona} cancela={cancela}
                    onNuevaClase={() => setEditarTipo('nuevo')} onEditarTipo={setEditarTipo} onRetirarTipo={retirarTipo} onReactivar={(t) => void reactivar(t)}
                    onNuevoBloque={(weekday) => setHorario({ weekday })} onEditarHorario={(plantilla) => setHorario({ plantilla })} alCambiar={pedir} />
                )}
              </>
            )}

      {lista && <ListaDialog sesion={lista.sesion} branchId={sede} inscribiendo={lista.inscribir} onClose={() => { setLista(null); void cargar().catch(() => undefined); }} />}
      {editarTipo && <TipoDialog tipo={editarTipo === 'nuevo' ? null : editarTipo} onClose={() => setEditarTipo(null)}
        onDone={async (creado) => { setEditarTipo(null); await cargar(); if (creado) setHorario({ tipoId: creado }); }} />}
      {horario && tipos && !retirar && <HorarioDialog tipos={activos} sede={sede} inicial={horario}
        onClose={() => setHorario(null)} onDone={async () => { setHorario(null); await cargar(); }} onQuitar={cancela ? quitarHorario : undefined} />}
      {retirar && <RetirarDialog {...retirar} onClose={() => setRetirar(null)} onDone={async () => { setRetirar(null); setHorario(null); await cargar(); }} />}
    </>
  );
}
