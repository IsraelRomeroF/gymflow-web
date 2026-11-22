'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles, Plus, ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Card, Empty, MenuMas, PageHeader, Segmented, EsqueletoLista, ErrorCarga } from '@/components/ui';
import { NuevoSocioDialog } from '@/components/socio-form';
import { ContactoDialog } from '@/components/seguimiento';
import { CerrarDialog, FuentesDialog, HistorialDialog, MandarAltaDialog, ProspectoDialog } from '@/components/prospectos/dialogos';
import { FilasDeInteresados, type AccionesDeFila } from '@/components/prospectos/grupo';
import type { Prospect, ProspectCounts, ProspectList, ProspectSources } from '@gymflow/core/contracts';
import { DEFAULT_PROSPECT_SOURCES, PROSPECT_QUEUES, type ProspectQueue } from '@gymflow/core/captacion';
import { GRUPO_DE_INTERESADOS } from '@gymflow/core/vocabulario';
import { hoyEn } from '@/lib/zonas';

/** Un interesado con su último contacto y su grupo: contrato del núcleo (`GET /prospects`), por páginas (10-01). */
type Prospecto = Prospect;
type Vista = 'today' | 'uncontacted' | 'waiting' | 'closed';
const VISTA_DE: Record<ProspectQueue, Vista> = { TODAY: 'today', UNCONTACTED: 'uncontacted', WAITING: 'waiting' };

type Pagina = { items: Prospecto[] | null; total: number; cursor: string | null; error: string | null; pidiendoMas: boolean };
const VACIA: Pagina = { items: null, total: 0, cursor: null, error: null, pidiendoMas: false };

/**
 * Un grupo de la bandeja, pedido al servidor ya en su orden y por páginas
 * (10-16): el que toca hoy no puede quedar escondido en la segunda página de
 * otro grupo. `version` cambia cuando algo se movió y hay que volver a pedir.
 */
function useGrupo(vista: Vista | null, filtros: string, version: number, alLlegar: (c: ProspectCounts) => void) {
  const toast = useToast();
  const [p, setP] = useState<Pagina>(VACIA);
  const url = useCallback((cursor?: string) => `/prospects?view=${vista}${filtros}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, [vista, filtros]);
  useEffect(() => {
    if (!vista) { setP(VACIA); return; }
    let vigente = true;
    // Sin red no es «nadie en seguimiento» (MC-16).
    api<ProspectList>(url()).then((r) => {
      if (!vigente) return;
      setP({ items: r.items, total: r.total, cursor: r.nextCursor, error: null, pidiendoMas: false });
      alLlegar(r.counts);
    }).catch((e) => { if (vigente) setP({ ...VACIA, error: errorText(e, 'No se pudieron cargar los prospectos') }); });
    return () => { vigente = false; };
  }, [vista, url, version, alLlegar]);
  async function cargarMas() {
    if (!p.cursor) return;
    setP((x) => ({ ...x, pidiendoMas: true }));
    try {
      const r = await api<ProspectList>(url(p.cursor));
      setP((x) => ({ ...x, items: [...(x.items ?? []), ...r.items.filter((n) => !(x.items ?? []).some((y) => y.id === n.id))], total: r.total, cursor: r.nextCursor, pidiendoMas: false }));
    } catch (e) { toast('error', errorText(e, 'No se pudieron cargar más prospectos')); setP((x) => ({ ...x, pidiendoMas: false })); }
  }
  return { ...p, cargarMas };
}

/**
 * PROSPECTOS: la bandeja de «a quién atender hoy», no una tabla de estados
 * (auditoría 8, bloque 2.4). Tres grupos que ordena el servidor: «Te toca
 * hoy», «Sin contactar» y «Esperando». La etapa de cada interesado sale de
 * sus contactos; cada fila tiene una acción, «Contactar»; y al inscribirse
 * queda ligado a su ficha, así se sabe de dónde vienen los socios.
 */
export default function ProspectosPage() {
  // `useSearchParams` exige un límite de Suspense para el prerender.
  return <Suspense fallback={<EsqueletoLista filas={5} />}><Prospectos /></Suspense>;
}

function Prospectos() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const { branches, branchName, inScope, can, org, mirada } = useSession();
  const [vista, setVista] = useState<'abiertos' | 'cerrados'>('abiertos');
  const [nuevo, setNuevo] = useState(false);
  const [inscribir, setInscribir] = useState<Prospecto | null>(null);
  const [perdido, setPerdido] = useState<Prospecto | null>(null);
  const [contacto, setContacto] = useState<Prospecto | null>(null);
  const [corregir, setCorregir] = useState<Prospecto | null>(null);
  const [historial, setHistorial] = useState<Prospecto | null>(null);
  const [mandar, setMandar] = useState<Prospecto | null>(null);
  const [verFuentes, setVerFuentes] = useState(false);
  const [fuentes, setFuentes] = useState<ProspectSources>({ sources: [...DEFAULT_PROSPECT_SOURCES], defaults: true });

  // El buscador y la sede los resuelve la API sobre TODOS los interesados (10-01). `?q=` llega del buscador de identidad.
  const pedido = search.get('q') ?? '';
  const [buscar, setBuscar] = useState(pedido);
  const [q, setQ] = useState(buscar.trim());
  // «Abrirlo» desde «ya está en seguimiento» llega con otro `?q=` sin salir de la pantalla.
  useEffect(() => { if (pedido) { setBuscar(pedido); setVista('abiertos'); } }, [pedido]);
  useEffect(() => { const t = setTimeout(() => setQ(buscar.trim()), 250); return () => clearTimeout(t); }, [buscar]);
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [sede, setSede] = useState('');
  const filtros = `${q.length >= 2 ? `&q=${encodeURIComponent(q)}` : ''}${sede ? `&branchId=${sede}` : ''}`;

  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const [counts, setCounts] = useState<ProspectCounts | null>(null);
  const alLlegar = useCallback((c: ProspectCounts) => setCounts(c), []);
  const abiertos = vista === 'abiertos';
  const grupos: Record<ProspectQueue, ReturnType<typeof useGrupo>> = {
    TODAY: useGrupo(abiertos ? 'today' : null, filtros, version, alLlegar),
    UNCONTACTED: useGrupo(abiertos ? 'uncontacted' : null, filtros, version, alLlegar),
    WAITING: useGrupo(abiertos ? 'waiting' : null, filtros, version, alLlegar),
  };
  const cerrados = useGrupo(abiertos ? null : 'closed', filtros, version, alLlegar);

  useEffect(() => { void api<ProspectSources>('/prospects/sources').then(setFuentes).catch(() => undefined); }, []);

  async function reabrir(p: Prospecto) {
    try {
      await api(`/prospects/${p.id}/reopen`, { method: 'POST' });
      toast('ok', `${p.firstName} vuelve a seguimiento, en la etapa que tenía.`);
      recargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo reabrir')); }
  }

  const puede = can('members:create');
  const hoy = hoyEn(org.timezone);
  const acciones: AccionesDeFila = {
    puede, conAltas: mirada.activo('intake'),
    contactar: setContacto, inscribir: setInscribir, cerrar: setPerdido, corregir: setCorregir, historial: setHistorial, mandarAlta: setMandar,
    reabrir: (p) => void reabrir(p), verFicha: (id) => router.push(`/socios/${id}`),
  };
  const cuenta = (n: number | undefined) => (n === undefined ? '' : ` (${n})`);
  const fallo = PROSPECT_QUEUES.map((g) => grupos[g].error).find(Boolean) ?? null;
  const cargando = abiertos && PROSPECT_QUEUES.some((g) => grupos[g].items === null) && !fallo;
  const nadie = abiertos && !cargando && !fallo && counts?.open === 0;
  const pie = (g: { items: Prospecto[] | null; total: number; cursor: string | null; pidiendoMas: boolean; cargarMas: () => Promise<void> }) => (g.cursor && g.items ? (
    <div className="row-between wrap">
      <span className="tiny muted">Se muestran {g.items.length} de {g.total}.</span>
      <Button size="sm" variant="secondary" loading={g.pidiendoMas} onClick={() => void g.cargarMas()}>Cargar más</Button>
    </div>
  ) : undefined);

  return (
    <div className="stack gap-20">
      <PageHeader title="Prospectos" sub="A quién atender hoy para que se inscriba. La etapa de cada uno sale de sus contactos."
        actions={puede ? <>
          <Button icon={<Plus />} onClick={() => setNuevo(true)}>Nuevo prospecto</Button>
          {/* La lista de «¿Cómo se enteró?» la arma quien configura el gimnasio (10-17). */}
          {can('settings:org') && <MenuMas items={[{ label: 'Lista de «¿Cómo se enteró?»', icon: <ListChecks />, onClick: () => setVerFuentes(true) }]} />}
        </> : undefined} />
      <div className="row-between wrap">
        <Segmented value={vista} onChange={setVista} options={[{ value: 'abiertos', label: `En seguimiento${cuenta(counts?.open)}` }, { value: 'cerrados', label: `Cerrados${cuenta(counts?.closed)}` }]} />
        <div className="row wrap gap-8">
          {sedes.length > 1 && (
            <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
              <option value="">Todas las sucursales</option>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <input className="input w-auto" type="search" aria-label="Buscar prospecto" placeholder="Buscar por nombre, teléfono o correo" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
      </div>

      {abiertos ? (
        fallo ? <Card><ErrorCarga mensaje={fallo} onReintentar={recargar} /></Card>
        : cargando ? <Card pad={false}><EsqueletoLista filas={5} /></Card>
        : nadie ? (
          <Card>{q.length >= 2
            ? <Empty icon={<Sparkles />} title="Nadie coincide con esa búsqueda" text="Revisa también en Cerrados, o borra la búsqueda." />
            : <Empty icon={<Sparkles />} title="Nadie en seguimiento" text="Registra a quien pregunte por inscripciones: en el mostrador, por teléfono o en redes."
                action={puede ? <Button icon={<Plus />} onClick={() => setNuevo(true)}>Nuevo prospecto</Button> : undefined} />}</Card>
        ) : (
          // La bandeja por urgencia: cada grupo con su contador y, vacío, con lo que eso significa.
          PROSPECT_QUEUES.map((g) => {
            const grupo = grupos[g];
            const n = counts?.[VISTA_DE[g] as 'today' | 'uncontacted' | 'waiting'] ?? grupo.total;
            return (
              <Card key={g} pad={false} data-testid={`grupo-${VISTA_DE[g]}`}
                title={<>{GRUPO_DE_INTERESADOS[g]!.titulo} <Badge tone={g === 'TODAY' && n > 0 ? 'warn' : g === 'UNCONTACTED' && n > 0 ? 'volt' : 'neutral'}>{n}</Badge></>}
                footer={pie(grupo)}>
                {grupo.items && grupo.items.length > 0
                  ? <FilasDeInteresados items={grupo.items} hoy={hoy} variasSedes={sedes.length > 1} sedeDe={branchName} a={acciones} />
                  : <p className="small muted grupo-vacio">{GRUPO_DE_INTERESADOS[g]!.vacio}</p>}
              </Card>
            );
          })
        )
      ) : (
        <Card pad={false} footer={pie(cerrados)}>
          {cerrados.error ? <div className="card-body"><ErrorCarga mensaje={cerrados.error} onReintentar={recargar} /></div>
            : cerrados.items === null ? <EsqueletoLista filas={5} />
            : cerrados.items.length === 0
              ? (q.length >= 2 ? <Empty icon={<Sparkles />} title="Nadie coincide con esa búsqueda" text="Revisa también en seguimiento, o borra la búsqueda." />
                : <Empty icon={<Sparkles />} title="Nada cerrado todavía" text="Aquí quedan los que se inscribieron y los que ya no se van a inscribir, con su motivo." />)
              : <FilasDeInteresados items={cerrados.items} hoy={hoy} variasSedes={sedes.length > 1} sedeDe={branchName} a={acciones} />}
        </Card>
      )}

      {perdido && <CerrarDialog prospecto={perdido} onClose={() => setPerdido(null)} onListo={() => { setPerdido(null); recargar(); }} />}
      {contacto && (
        <ContactoDialog para="prospecto" nombre={contacto.firstName} url={`/prospects/${contacto.id}/follow-ups`}
          onClose={() => setContacto(null)} onListo={() => { setContacto(null); recargar(); }}
          onInscribir={() => { const p = contacto; setContacto(null); setInscribir(p); }} />
      )}
      {nuevo && <ProspectoDialog fuentes={fuentes.sources} onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); recargar(); }} />}
      {corregir && <ProspectoDialog editar={corregir} fuentes={fuentes.sources} onClose={() => setCorregir(null)} onListo={() => { setCorregir(null); recargar(); }} />}
      {historial && <HistorialDialog prospecto={historial} onClose={() => setHistorial(null)} />}
      {mandar && <MandarAltaDialog prospecto={mandar} onClose={() => setMandar(null)} onListo={() => { setMandar(null); recargar(); }} />}
      {verFuentes && <FuentesDialog actuales={fuentes} onClose={() => setVerFuentes(false)} onListo={(s) => { setFuentes(s); setVerFuentes(false); }} />}
      {inscribir && (
        // El alta y la conversión son UNA operación en el servidor (10-07), y el socio nace en la sede del interesado (10-06).
        <NuevoSocioDialog prospecto={inscribir}
          onClose={() => setInscribir(null)}
          onCreado={(memberId) => router.push(`/socios/${memberId}?vender=1`)} />
      )}
    </div>
  );
}
