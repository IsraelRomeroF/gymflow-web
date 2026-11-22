'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, ShieldCheck, Download, DoorOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { diaLargo, fechaCorta, hora } from '@/lib/format';
import { useFormulario } from '@/lib/formulario';
import { useSession, errorText, useToast } from '@/components/session';
import { hoyEn, masDias, zonaDe } from '@/lib/zonas';
import { Asiento, type Evento, type PaginaDeBitacora } from '@/components/bitacora';
import { Badge, Button, Callout, CampoFecha, CampoMotivo, Card, Dialog, Empty, ERROR_MOTIVO, faltaMotivo, PageHeader, Segmented, EsqueletoLista } from '@/components/ui';

/** Quién ha escrito en la bitácora en el periodo (`GET /audit/actors`, 20-12). */
type Persona = { id: string; fullName: string; entries?: number };
/** Entradas por excepción de una persona en un día y una sede (`GET /audit/exceptions`, 20-06). */
type Excepciones = { date: string; actorUserId: string | null; actorName: string | null; branchId: string | null; count: number; limit: number | null; overLimit: boolean };

type Categoria = 'sensibles' | 'todo' | 'dinero' | 'socios' | 'acceso' | 'personal' | 'clases' | 'catalogo' | 'plataforma';
const CATEGORIAS: ReadonlyArray<{ value: Categoria; label: string }> = [
  { value: 'sensibles', label: 'Para revisar' }, { value: 'todo', label: 'Todo' }, { value: 'dinero', label: 'Dinero' },
  { value: 'socios', label: 'Socios' }, { value: 'acceso', label: 'Acceso' }, { value: 'personal', label: 'Personal' },
  { value: 'clases', label: 'Clases' }, { value: 'catalogo', label: 'Precios y catálogo' },
  // Lo que GymFlow hizo sobre la marca (DP-04): liberar, suspender, contratar, facturar.
  { value: 'plataforma', label: 'GymFlow' },
];

type Fila = { tipo: 'uno'; evento: Evento } | { tipo: 'grupo'; eventos: Evento[] };

/**
 * Tres o más asientos seguidos del sistema con la misma acción, sin motivo ni
 * firma, se leen como uno: "El sistema renovó 23 membresías · ver" (UX 2026-10-08).
 */
function agrupar(lista: Evento[]): Fila[] {
  const out: Fila[] = [];
  const agrupable = (e: Evento) => e.actorType === 'SYSTEM' && !e.actorName && !e.reason && !e.approvedByUserId && !e.sensitive;
  for (let i = 0; i < lista.length;) {
    let j = i;
    while (j < lista.length && agrupable(lista[i]!) && agrupable(lista[j]!) && lista[j]!.action === lista[i]!.action) j++;
    if (j - i >= 3) { out.push({ tipo: 'grupo', eventos: lista.slice(i, j) }); i = j; }
    else { out.push({ tipo: 'uno', evento: lista[i]! }); i++; }
  }
  return out;
}

/**
 * El periodo en palabras ("Del 2 al 8 de oct"): algunos navegadores pintan el
 * selector de fecha en orden de EE. UU. aunque la página sea es-MX. `hoy` es
 * el del gimnasio (26-06): de él sale si hace falta decir el año.
 */
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function periodoTexto(desde: string, hasta: string, hoy: string): string {
  const [a1, m1, d1] = desde.split('-').map(Number); const [a2, m2, d2] = hasta.split('-').map(Number);
  if (!a1 || !m1 || !d1 || !a2 || !m2 || !d2) return '';
  const fin = `${d2} de ${MES[m2 - 1]}${a1 !== a2 || a2 !== Number(hoy.slice(0, 4)) ? ` de ${a2}` : ''}`;
  if (desde === hasta) return `El ${fin}`;
  const inicio = a1 !== a2 ? `${d1} de ${MES[m1 - 1]} de ${a1}` : m1 !== m2 ? `${d1} de ${MES[m1 - 1]}` : `${d1}`;
  return `Del ${inicio} al ${fin}`;
}

/**
 * BITÁCORA (UXB-01; auditoría 8, bloque 1.11): quién hizo qué, a quién, cuánto,
 * cuándo y con qué autorización. Abre en «Para revisar»: el dinero que sale
 * (reembolsos, reversas, condonaciones, anulaciones, retiros), el poder que
 * cambia (puestos, permisos, contraseñas, módulos, precios) y las excepciones.
 * El corte de caja solo aparece ahí si tuvo diferencia, y las entradas por
 * excepción van resumidas por persona y día (20-06).
 *
 * La frase de cada asiento llega armada del servidor (núcleo): esta pantalla
 * no tiene diccionario de acciones (20-10).
 */
export default function BitacoraPage() {
  const { branches, inScope, branchName, canOrg, can, org } = useSession();
  const toast = useToast();
  // Hoy en la zona del gimnasio, no en la de la computadora (26-06).
  const hoy = hoyEn(org.timezone);
  const sedes = branches.filter((b) => inScope(b.id));
  const [categoria, setCategoria] = useState<Categoria>('sensibles');
  const [persona, setPersona] = useState('');
  const [sede, setSede] = useState('');
  const [desde, setDesde] = useState(() => masDias(hoy, -6));
  const [hasta, setHasta] = useState(hoy);
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [excepciones, setExcepciones] = useState<Excepciones[]>([]);
  const [exportar, setExportar] = useState(false);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    // "Lo que hizo esta persona": se llega desde Personal con ?persona=.
    const p = new URLSearchParams(window.location.search).get('persona');
    if (p) { setPersona(p); setCategoria('todo'); }
  }, []);

  // El filtro «Persona» sale de la propia bitácora (quién escribió en el periodo),
  // con el permiso de la bitácora: no hace falta tener Personal (20-12).
  const rango = useMemo(() => new URLSearchParams({ from: desde, to: hasta, ...(sede ? { branchId: sede } : {}) }).toString(), [desde, hasta, sede]);
  useEffect(() => {
    let vivo = true;
    api<{ actors: Persona[] }>(`/audit/actors?${rango}`).then((r) => { if (vivo) setPersonas(r.actors); }).catch(() => { if (vivo) setPersonas([]); });
    return () => { vivo = false; };
  }, [rango]);

  // Entradas por excepción, resumidas por persona y día: solo en «Para revisar».
  useEffect(() => {
    if (categoria !== 'sensibles') { setExcepciones([]); return; }
    let vivo = true;
    api<{ summary: Excepciones[] }>(`/audit/exceptions?${rango}${persona ? `&actorUserId=${persona}` : ''}`)
      .then((r) => { if (vivo) setExcepciones(r.summary); }).catch(() => { if (vivo) setExcepciones([]); });
    return () => { vivo = false; };
  }, [categoria, rango, persona]);

  const consulta = useMemo(() => new URLSearchParams({
    limit: '50', from: desde, to: hasta,
    ...(categoria !== 'todo' ? { category: categoria } : {}),
    ...(persona ? { actorUserId: persona } : {}),
    ...(sede ? { branchId: sede } : {}),
  }).toString(), [categoria, persona, sede, desde, hasta]);

  const cargar = useCallback(async (mas?: string) => {
    try {
      const r = await api<PaginaDeBitacora>(`/audit?${consulta}${mas ? `&cursor=${mas}` : ''}`);
      setEventos((prev) => (mas && prev ? [...prev, ...r.entries] : r.entries));
      setCursor(r.nextCursor); setError(null);
    } catch (e) { setError(errorText(e, 'No se pudo cargar la bitácora')); setEventos([]); }
  }, [consulta]);
  useEffect(() => { setEventos(null); void cargar(); }, [cargar]);

  async function verificar() {
    setVerificando(true);
    try {
      const r = await api<{ ok: boolean; entries: number }>('/audit/verify');
      toast(r.ok ? 'ok' : 'error', r.ok ? `Íntegra: ${r.entries.toLocaleString('es-MX')} registros encadenados, ninguno alterado` : 'La cadena está rota: alguien alteró un registro. Avisa a soporte.');
    } catch (e) { toast('error', errorText(e, 'No se pudo verificar')); } finally { setVerificando(false); }
  }

  const porDia = useMemo(() => {
    const g = new Map<string, Evento[]>();
    for (const e of eventos ?? []) {
      // El día del gimnasio, no el de la computadora (26-06).
      const d = hoyEn(org.timezone, new Date(e.at));
      g.set(d, [...(g.get(d) ?? []), e]);
    }
    return [...g.entries()].map(([d, lista]) => [d, agrupar(lista)] as const);
  }, [eventos, org.timezone]);

  /** La hora de un asiento, en la zona de SU sucursal (una sede en Tijuana no lee la hora del centro). */
  const horaDe = (e: Evento) => hora(e.at, zonaDe(e.branchId ? branches.find((b) => b.id === e.branchId) : null, org));
  // La persona elegida sigue en la lista aunque no haya escrito en este periodo.
  const opcionesDePersona = persona && !personas.some((p) => p.id === persona) ? [...personas, { id: persona, fullName: 'La persona elegida' }] : personas;
  const periodos: ReadonlyArray<{ label: string; desde: string; hasta: string }> = [
    { label: 'Hoy', desde: hoy, hasta: hoy }, { label: '7 días', desde: masDias(hoy, -6), hasta: hoy },
    { label: 'Este mes', desde: `${hoy.slice(0, 8)}01`, hasta: hoy },
  ];
  /** Abre el detalle de un renglón del resumen: Acceso, esa persona, ese día. */
  function verExcepciones(x: Excepciones) {
    setCategoria('acceso'); setPersona(x.actorUserId ?? ''); setDesde(x.date); setHasta(x.date);
    if (x.branchId && sedes.length > 1) setSede(x.branchId);
  }
  const sinNada = eventos !== null && eventos.length === 0 && !(categoria === 'sensibles' && excepciones.length > 0);

  return (
    <>
      <PageHeader title="Bitácora" sub="Quién hizo qué, a quién, cuándo y con qué autorización. Nada de lo que aquí aparece se puede borrar ni editar."
        actions={<>
          {/* El dueño se la entrega al contador o al abogado (DP-05): mismos filtros que la lista, con motivo. */}
          {can('audit:export') && <Button variant="secondary" icon={<Download />} onClick={() => setExportar(true)}>Exportar</Button>}
          {canOrg('audit:read') && <Button variant="secondary" icon={<ShieldCheck />} loading={verificando} onClick={() => void verificar()}>Verificar integridad</Button>}
        </>} />
      {exportar && <ExportarDialog consulta={consulta} onClose={() => setExportar(false)} />}
      <div className="stack">
        <div className="row wrap gap-10">
          <Segmented value={categoria} onChange={setCategoria} options={CATEGORIAS} etiqueta="Categoría" />
        </div>
        <div className="row wrap gap-10">
          {opcionesDePersona.length > 0 && (
            <select className="select" aria-label="Persona" style={{ width: 'auto', minWidth: 180 }} value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">Todas las personas</option>
              {opcionesDePersona.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          )}
          {sedes.length > 1 && (
            <select className="select" aria-label="Sucursal" style={{ width: 'auto', minWidth: 160 }} value={sede} onChange={(e) => setSede(e.target.value)}>
              <option value="">Todas mis sucursales</option>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {/* Siempre día/mes/año (D26-02); la consulta cambia solo con una fecha completa, no a media escritura. */}
          <label className="row small gap-6">Del <CampoFecha value={desde} max={hasta} onChange={(v) => { if (v) setDesde(v); }} /></label>
          <label className="row small gap-6">al <CampoFecha value={hasta} min={desde} max={hoy} onChange={(v) => { if (v) setHasta(v); }} /></label>
          <span className="row gap-6" role="group" aria-label="Periodo">
            {periodos.map((p) => (
              <button key={p.label} type="button" className="chip" aria-pressed={desde === p.desde && hasta === p.hasta} onClick={() => { setDesde(p.desde); setHasta(p.hasta); }}>{p.label}</button>
            ))}
          </span>
          <span className="small muted" aria-live="polite" data-testid="periodo-bitacora">{periodoTexto(desde, hasta, hoy)}</span>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        {categoria === 'sensibles' && excepciones.length > 0 && (
          // Cada «déjalo pasar» es rutina; muchas de la misma persona en un día, no (20-06).
          <Card pad={false} title="Entradas por excepción" data-testid="resumen-excepciones"
            sub="Resumidas por persona y día. Solo lo que pasa del tope de su puesto queda marcado para revisar.">
            <ul className="list">
              {excepciones.map((x) => (
                <li key={`${x.date}|${x.actorUserId}|${x.branchId}`} className="list-item" data-pasa-del-tope={x.overLimit ? 'si' : 'no'}>
                  <DoorOpen size={16} className="muted" />
                  <div className="flex-1 min-w-0 small">
                    <strong>{x.actorName ?? 'El sistema'}</strong> dejó pasar {x.count === 1 ? '1 vez' : `${x.count} veces`} por excepción{' '}
                    <span className="muted nowrap">· {fechaCorta(x.date)}{x.branchId ? ` · ${branchName(x.branchId)}` : ''}{x.limit !== null ? ` · tope de ${x.limit} por turno` : ''}</span>{' '}
                    <button type="button" className="row-link" onClick={() => verExcepciones(x)}>ver</button>
                  </div>
                  {x.overLimit && <Badge tone="warn" dot>Revisar</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {eventos === null ? <div className="card"><EsqueletoLista filas={8} /></div> : sinNada ? (
          <Card><Empty icon={<History />} title="Nada en este periodo" text={categoria === 'sensibles' ? 'No hubo reembolsos, condonaciones, retiros, cortes con diferencia, cambios de permisos ni otras operaciones para revisar.' : 'Prueba con otro periodo u otro filtro.'} /></Card>
        ) : (
          <>
            {porDia.map(([dia, lista]) => (
              <Card key={dia} title={diaLargo(dia)} sub={(() => { const n = lista.reduce((t, x) => t + (x.tipo === 'grupo' ? x.eventos.length : 1), 0); return `${n} ${n === 1 ? 'registro' : 'registros'}`; })()} pad={false}>
                <ul className="list">
                  {lista.map((x) => x.tipo === 'grupo' ? (
                    // Lo que el sistema hace en serie (renovar, vencer, suspender) va en un renglón, con la lista a la vista si se pide.
                    <li key={x.eventos[0]!.id} className="list-item items-start" data-testid="grupo-sistema">
                      <span className="tiny muted num nowrap asiento-hora">{horaDe(x.eventos[0]!)}</span>
                      <div className="flex-1 min-w-0">
                        <details className="asiento-grupo">
                          <summary className="small">
                            <strong>El sistema</strong> {x.eventos[0]!.label} <span className="muted">·</span>{' '}
                            <strong>{x.eventos.length}</strong> {x.eventos[0]!.action.startsWith('membership.') ? 'membresías' : 'veces'} <span className="muted">· ver</span>
                          </summary>
                          <ul className="tiny asiento-grupo-lista">
                            {x.eventos.map((e) => <li key={e.id}>{e.member ? <Link className="row-link" href={`/socios/${e.member.memberId}`}>{e.member.name}</Link> : 'Registro'} <span className="muted nowrap">{horaDe(e)}{e.branchId ? ` · ${branchName(e.branchId)}` : ''}</span></li>)}
                          </ul>
                        </details>
                      </div>
                    </li>
                  ) : <Asiento key={x.evento.id} e={x.evento} />)}
                </ul>
              </Card>
            ))}
            {cursor && <div><Button variant="secondary" onClick={() => void cargar(cursor)}>Ver más</Button></div>}
          </>
        )}
      </div>
    </>
  );
}

/**
 * EXPORTAR LA BITÁCORA (DP-05): el CSV con los mismos filtros de la lista y
 * con motivo, que queda en la propia bitácora. Diálogo chico (un solo campo)
 * y el botón encendido: si falta el motivo, el campo lo dice (26-02).
 */
function ExportarDialog({ consulta, onClose }: { consulta: string; onClose: () => void }) {
  const [motivo, setMotivo] = useState('');
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  return (
    <Dialog open size="sm" onClose={onClose} title="Exportar la bitácora" sub="Se descarga un CSV con lo que ves filtrado (hasta 5,000 asientos). La exportación misma queda en la bitácora."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button icon={<Download />} onClick={() => void f.enviar(() => {
          const q = new URLSearchParams(consulta); q.delete('limit'); q.set('reason', motivo.trim());
          window.location.href = `/api/audit/export.csv?${q.toString()}`;
          onClose();
        })}>Descargar CSV</Button></>}>
      <CampoMotivo id="exp-motivo" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')}
        hint="Por ejemplo: «Para el contador, cierre de octubre»." />
    </Dialog>
  );
}
