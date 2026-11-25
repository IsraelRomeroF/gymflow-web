'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Inbox, Check, UserPlus, X, FileSignature, QrCode, CircleCheck, ArrowRight, ArrowLeft, Link2, Pencil, Save, Undo2 } from 'lucide-react';
import { api, motivoDe } from '@/lib/api';
import { fecha, fechaHora, hace, telefono } from '@gymflow/ui/format';
import { CONSENT_TYPE, MEMBER_STATUS } from '@/lib/labels';
import { useToast, errorText } from '@/components/session';
import { Avatar, Badge, Button, Callout, CampoFecha, CampoMotivo, Card, Dialog, Empty, Field, PageHeader, Segmented, Skeleton, Switch, ErrorCarga, EsqueletoTabla } from '@/components/ui';
import { EstadoCarga, useCarga } from '@gymflow/ui/carga';
import { useFormulario } from '@gymflow/ui/formulario';
import { EnlaceAltaDialog } from '@/components/alta-enlace';
import { ElegirResponsable, responsableElegido, SIN_ELEGIR, type Eleccion } from '@/components/altas/responsable';
import { CoachAlAlta } from '@/components/altas/coach-al-alta';
import { PasosDelAlta, accionDelPaso, useOnboarding } from '@/components/altas/pasos-del-alta';
import { useSession } from '@/components/session';
import type { IntakeCorrectionsSaved, IntakeDetail, IntakeList, IntakeResolved, IntakeSummary } from '@gymflow/core/contracts';
import { INTAKE_CORRECTABLE_FIELDS } from '@gymflow/core/captacion';
import { textosDeMotivo } from '@gymflow/core/motivos';
import { ESTADO_DE_INTERESADO, INSIGNIA_DE_ALTA } from '@gymflow/core/vocabulario';

/** Un alta en la bandeja o en el historial: contrato del núcleo (`GET /intakes`), por páginas (9-14). */
type Resumen = IntakeSummary;
/** El alta para decidir: lo que el socio envió, lo corregido encima, duplicados e insignias (`GET /intakes/:id`). */
type Detalle = IntakeDetail;
type Coincidencia = Detalle['matches'][number];
type Campo = (typeof INTAKE_CORRECTABLE_FIELDS)[number];

type Vista = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
const VISTAS = [
  { value: 'SUBMITTED' as const, label: 'Por revisar' },
  { value: 'APPROVED' as const, label: 'Aprobadas' },
  { value: 'REJECTED' as const, label: 'Rechazadas' },
];

const SUGERENCIA = {
  NEW_MEMBER: { tone: 'ok', title: 'Sin coincidencias', text: 'Es un socio nuevo. Puedes aprobar.' },
  NEEDS_REVIEW: { tone: 'warn', title: 'Se parece a alguien', text: 'Revisa los posibles duplicados antes de aprobar.' },
  AUTO_LINK: { tone: 'danger', title: 'Casi seguro que ya existe', text: 'Revisa antes de crear otra ficha para la misma persona.' },
} as const;

/** Los datos que recepción corrige o completa, en el orden del formulario. */
const CAMPOS: ReadonlyArray<readonly [Campo, string, 'text' | 'tel' | 'email' | 'date']> = [
  ['firstName', 'Nombre', 'text'], ['lastName', 'Apellidos', 'text'],
  ['phoneE164', 'Teléfono (10 dígitos)', 'tel'], ['email', 'Correo', 'email'],
  ['birthDate', 'Nacimiento', 'date'], ['memberSince', 'Socio desde', 'date'],
  ['emergencyContactName', 'Contacto de emergencia', 'text'], ['emergencyContactPhone', 'Su teléfono', 'tel'],
];
/** Lo que falta, dicho como lo diría recepción (9-04). «Socio desde» no falta: sin fecha, es nuevo. */
const FALTA: Record<string, string> = { birthDate: 'nacimiento', emergencyContactName: 'contacto de emergencia' };
const sinLada = (t: string | null | undefined) => (t ?? '').replace(/^\+52/, '');
/** Un dato del alta como se escribe en su campo: el teléfono sin lada, la fecha en AAAA-MM-DD. */
const comoCampo = (k: Campo, v: string | null | undefined) => (k === 'phoneE164' || k === 'emergencyContactPhone' ? sinLada(v) : (v ?? '').slice(0, k === 'birthDate' || k === 'memberSince' ? 10 : undefined));

/** El alta como quedaría al aprobar: lo que envió el socio con lo corregido encima. */
function conCorrecciones(d: Detalle): Record<Campo, string | null> {
  const i = d.intake;
  const enviado: Record<Campo, string | null> = {
    firstName: i.firstName, lastName: i.lastName, phoneE164: i.phoneE164, email: i.email, birthDate: i.birthDate, memberSince: i.memberSince,
    emergencyContactName: i.emergencyContactName, emergencyContactPhone: i.emergencyContactPhone,
  };
  return { ...enviado, ...(i.corrections ?? {}) };
}

/**
 * BANDEJA DE ALTAS DIGITALES.
 *
 * Criterio del sprint: menos de cinco minutos de recepción por alta. Todo lo
 * que hace falta para decidir —datos, lo que falta, posibles duplicados y lo
 * que el socio firmó— llega en UNA pantalla: bandeja a la izquierda, detalle
 * a la derecha.
 *
 * Bloque 2.4 (auditoría 8): la bandeja dice la sucursal y se filtra por ella,
 * se busca por nombre, celular o folio, se actualiza sola y cada fila lleva
 * sus insignias; lo corregido se guarda sin aprobar; «Es esta persona» lleva
 * lo corregido; y al aprobar o vincular, lo que sigue es una lista de pasos
 * decidida por el estado del socio.
 */
export default function AltasPage() {
  const toast = useToast();
  const router = useRouter();
  const { branches, branchName, inScope, can } = useSession();
  // «Revisar» se puede quitar por persona (9-13): sin él no se pintan botones
  // que la API va a rechazar.
  const revisa = can('members:intake:review');
  // D-33 (bloque 4.7): la nota de salud la escribe quien puede leerla. Recepción registra el permiso del tutor, no la nota;
  // desde P-10 (bloque 4.19) ya no se le enciende a nadie de recepción, así que el alta con nota la aprueba la gerencia.
  const escribeSalud = can('members:health:read');
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [vista, setVista] = useState<Vista>('SUBMITTED');

  const [enlace, setEnlace] = useState(false);
  const [aprobada, setAprobada] = useState<{ memberId: string; memberCode: string; nombre: string; pendientes: string[]; vinculada?: boolean; eraInteresado: boolean } | null>(null);
  const [lista, setLista] = useState<Resumen[] | null>(null);
  const [actual, setActual] = useState<string | null>(null);
  // En tableta y teléfono la bandeja es lista → detalle (UX7 Clases 3): tocar un nombre abre el detalle con "Volver".
  const [enDetalle, setEnDetalle] = useState(false);
  // Corregir o completar lo que el socio escribió antes de aprobar (2026-10-09).
  const [editando, setEditando] = useState(false);
  const [edit, setEdit] = useState<Partial<Record<Campo, string>>>({});
  useEffect(() => { if (enDetalle) window.scrollTo({ top: 0 }); }, [enDetalle, actual]);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falloAccion, setFalloAccion] = useState<string | null>(null);
  const [rechazo, setRechazo] = useState(false);
  // Bloque 3.4. D-09: quién responde por el celular que comparte. D-10: el tutor que firma aquí por un menor.
  const [responsable, setResponsable] = useState<Eleccion>(SIN_ELEGIR);
  const [tutor, setTutor] = useState({ nombre: '', telefono: '', acepta: false, salud: false, nota: '' });
  // Bloque 3.8, D-29: el coach que elige quien aprueba el alta.
  const [coach, setCoach] = useState('');
  const altaAbierta = detalle?.intake.id ?? null;
  const tutorEscrito = detalle?.intake.guardianName ?? '';
  const celularDelTutor = detalle?.intake.guardianPhoneE164 ?? '';
  useEffect(() => {
    // Otra alta: nada de lo elegido para la anterior vale. El tutor que el menor escribió se propone; firmar es aparte.
    setResponsable(SIN_ELEGIR);
    setCoach('');
    setTutor({ nombre: tutorEscrito, telefono: celularDelTutor.replace(/^\+52/, ''), acepta: false, salud: false, nota: '' });
  }, [altaAbierta, tutorEscrito, celularDelTutor]);

  // Sede y buscador los resuelve la API (9-06, 9-09): nombre, celular o el folio que dicta el socio.
  const [sede, setSede] = useState('');
  const [buscar, setBuscar] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(buscar.trim()), 250); return () => clearTimeout(t); }, [buscar]);
  const filtros = `${sede ? `&branchId=${sede}` : ''}${q.length >= 2 ? `&q=${encodeURIComponent(q)}` : ''}`;

  const [falloLista, setFalloLista] = useState<string | null>(null);
  // Cuántas hay por revisar en total y cómo pedir las que no caben en la primera página (antes, con 120, se veían 50).
  const [porRevisar, setPorRevisar] = useState<{ total: number; filtradas: number; cursor: string | null }>({ total: 0, filtradas: 0, cursor: null });
  const [pidiendoMas, setPidiendoMas] = useState(false);
  /** Ya se pidió «Cargar más»: la actualización automática no pisa lo que se cargó de más. */
  const extendida = useRef(false);
  const cargar = useCallback(async () => {
    try {
      const r = await api<IntakeList>(`/intakes?status=SUBMITTED${filtros}`);
      setFalloLista(null);
      setLista(r.items);
      setPorRevisar({ total: r.pending, filtradas: r.total, cursor: r.nextCursor });
      extendida.current = false;
      return r.items;
    } catch (e) {
      // Un error NO es "bandeja vacía" (UXG-04).
      setFalloLista(errorText(e, 'No se pudo cargar la bandeja'));
      setLista([]);
      return [];
    }
  }, [filtros]);

  const abrir = useCallback(async (id: string) => {
    setActual(id);
    setEditando(false); setEdit({}); setFalloAccion(null);
    setDetalle(null);
    try { setDetalle(await api<Detalle>(`/intakes/${id}`)); } catch (e) { toast('error', errorText(e, 'No se pudo abrir el alta')); }
  }, [toast]);

  // Al entrar: la que pide el enlace (`?alta=`, desde «¿Ya existe?») o la primera de la bandeja.
  const pedida = useRef<string | null>(null);
  useEffect(() => { pedida.current = new URLSearchParams(window.location.search).get('alta'); }, []);
  const actualRef = useRef<string | null>(null);
  actualRef.current = actual;
  useEffect(() => {
    void cargar().then((xs) => {
      const id = pedida.current ?? (xs.some((x) => x.id === actualRef.current) ? actualRef.current : xs[0]?.id);
      if (pedida.current) { setEnDetalle(true); pedida.current = null; }
      if (id && id !== actualRef.current) void abrir(id);
      if (!id) { setActual(null); setDetalle(null); }
    });
  }, [cargar, abrir]);

  // La bandeja se actualiza sola (9-08): quien acaba de llenar el formulario está parado enfrente.
  // Solo la lista: el detalle abierto y lo que se esté corrigiendo no se tocan.
  useEffect(() => {
    if (vista !== 'SUBMITTED') return;
    const t = setInterval(() => {
      if (document.hidden || extendida.current) return;
      void api<IntakeList>(`/intakes?status=SUBMITTED${filtros}`).then((r) => {
        setLista(r.items);
        setPorRevisar({ total: r.pending, filtradas: r.total, cursor: r.nextCursor });
      }).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(t);
  }, [vista, filtros]);

  // Aprobadas y rechazadas: sin red no es «Aún no hay altas aprobadas» (26-01).
  const cargarHistorial = useCallback(() => api<IntakeList>(`/intakes?status=${vista}${filtros}`), [vista, filtros]);
  const historial = useCarga(vista === 'SUBMITTED' ? null : cargarHistorial);
  const ponerHistorial = historial.poner;

  /** «Cargar más»: la página siguiente de la bandeja o del historial. */
  async function cargarMas(cursor: string) {
    setPidiendoMas(true);
    try {
      const r = await api<IntakeList>(`/intakes?status=${vista}${filtros}&cursor=${encodeURIComponent(cursor)}`);
      if (vista === 'SUBMITTED') {
        extendida.current = true;
        setLista((a) => [...(a ?? []), ...r.items.filter((x) => !(a ?? []).some((y) => y.id === x.id))]);
        setPorRevisar({ total: r.pending, filtradas: r.total, cursor: r.nextCursor });
      } else {
        ponerHistorial((a) => ({ ...r, items: [...(a?.items ?? []), ...r.items] }));
      }
    } catch (e) { toast('error', errorText(e, 'No se pudieron cargar más altas')); } finally { setPidiendoMas(false); }
  }

  async function siguiente() {
    const xs = await cargar();
    if (xs[0]) void abrir(xs[0].id); else { setActual(null); setDetalle(null); }
  }

  /** Abre «Corregir o completar» con lo que ya está: lo enviado y lo que alguien guardó encima. */
  function corregir(d: Detalle) {
    const ahora = conCorrecciones(d);
    setEdit(Object.fromEntries(CAMPOS.map(([k]) => [k, comoCampo(k, ahora[k])])));
    setEditando(true); setFalloAccion(null);
  }

  /**
   * Lo que viaja al guardar, aprobar o vincular mientras se corrige: los ocho
   * campos como están en pantalla (vacío = se borra el dato). El servidor se
   * queda solo con los que cambian lo que envió el socio.
   */
  function enPantalla(): Record<string, string | null> | null {
    if (!detalle || !editando) return null;
    return Object.fromEntries(CAMPOS.map(([k]) => { const v = (edit[k] ?? '').trim(); return [k, v === '' && k !== 'firstName' && k !== 'lastName' ? null : v]; }));
  }
  /** Cuántos datos cambian respecto de lo que envió el socio (lo que dirá la bitácora). */
  function cambios(): number {
    if (!detalle || !editando) return 0;
    const i = detalle.intake;
    const enviado: Record<Campo, string | null> = { firstName: i.firstName, lastName: i.lastName, phoneE164: i.phoneE164, email: i.email, birthDate: i.birthDate, memberSince: i.memberSince, emergencyContactName: i.emergencyContactName, emergencyContactPhone: i.emergencyContactPhone };
    return CAMPOS.filter(([k]) => (edit[k] ?? '').trim() !== comoCampo(k, enviado[k])).length;
  }

  /** Lo que falló al decidir: si otra persona ya la revisó, se dice y la bandeja sigue; si no, queda a la vista en el alta. */
  async function alFallar(err: unknown, porOmision: string) {
    if (motivoDe(err) === 'INTAKE_ALREADY_REVIEWED') {
      toast('error', errorText(err, 'Esa alta ya fue revisada'));
      await siguiente();
    } else setFalloAccion(errorText(err, porOmision));
  }

  /** «Guardar sin aprobar» (9-21): lo corregido queda en el alta; el socio va por su identificación y otra persona puede terminar. */
  async function guardarSinAprobar(corrections: Record<string, string | null> | null) {
    if (!detalle) return;
    setOcupado(true); setFalloAccion(null);
    try {
      const r = await api<IntakeCorrectionsSaved>(`/intakes/${detalle.intake.id}/corrections`, { method: 'PATCH', body: JSON.stringify({ corrections }) });
      toast('ok', r.corrections ? 'Guardado sin aprobar: lo corregido queda en el alta.' : 'El alta quedó como la envió el socio.');
      // Se vuelve a leer: lo que falta, los duplicados y las insignias cambian con lo corregido.
      setEditando(false); setEdit({});
      setDetalle(await api<Detalle>(`/intakes/${detalle.intake.id}`));
      void cargar();
    } catch (err) { await alFallar(err, 'No se pudo guardar'); } finally { setOcupado(false); }
  }

  /** Lo que se decide además de corregir: el responsable del celular compartido (D-09) y la firma del tutor (D-10). */
  function decision(): Record<string, unknown> {
    const r = comparten.length > 0 ? responsableElegido(responsable) : null;
    return {
      ...(r ? { responsible: r } : {}),
      ...(detalle?.intake.minor && tutorListo ? { guardian: {
        name: tutor.nombre.trim(), ...(tutor.telefono.trim() ? { phoneE164: tutor.telefono.trim() } : {}),
        healthConsent: tutor.salud, ...(tutor.salud && escribeSalud && tutor.nota.trim() ? { healthNotes: tutor.nota.trim() } : {}),
      } } : {}),
    };
  }

  async function aprobar(id: string, force: boolean) {
    setOcupado(true); setFalloAccion(null);
    const corrections = enPantalla();
    try {
      const r = await api<IntakeResolved>(`/intakes/${id}/approve`, { method: 'POST', body: JSON.stringify({ force, ...(corrections ? { corrections } : {}), ...decision(), ...(coach ? { coachUserId: coach } : {}) }) });
      // No se salta a la siguiente: el socio está delante y lo que sigue es
      // venderle su plan. La pantalla lo ofrece en vez de dejarlo a la memoria.
      setAprobada({
        memberId: r.memberId, memberCode: r.memberCode,
        nombre: (corrections?.firstName ?? detalle?.intake.corrections?.firstName ?? detalle?.intake.firstName) || 'El socio',
        pendientes: r.pendingReconsent, eraInteresado: !!r.convertedProspectId,
      });
    } catch (err) { await alFallar(err, 'No se pudo aprobar'); } finally { setOcupado(false); }
  }

  /** "Es esta persona": se ata a su ficha en lugar de crear otra, con lo corregido y la nota de salud (9-03). */
  async function vincular(id: string, c: Coincidencia) {
    setOcupado(true); setFalloAccion(null);
    const corrections = enPantalla();
    try {
      const r = await api<IntakeResolved>(`/intakes/${id}/link`, { method: 'POST', body: JSON.stringify({ memberId: c.candidateId, ...(corrections ? { corrections } : {}), ...decision() }) });
      setAprobada({ memberId: r.memberId, memberCode: r.memberCode, nombre: c.fullName ?? 'El socio', pendientes: r.pendingReconsent, vinculada: true, eraInteresado: !!r.convertedProspectId });
    } catch (err) { await alFallar(err, 'No se pudo vincular'); } finally { setOcupado(false); }
  }

  const s = detalle ? SUGERENCIA[detalle.suggestion] : null;
  const bandejaVacia = vista === 'SUBMITTED' && !falloLista && lista !== null && lista.length === 0;
  const filtrando = q.length >= 2 || !!sede;
  const ahora = detalle ? conCorrecciones(detalle) : null;
  const corregidos = detalle?.intake.corrections ?? null;
  const faltan = (detalle?.pendingFields ?? []).filter((k) => FALTA[k]);
  // Mismo celular que un socio vivo y que no es esta persona (D-09): pueden compartirlo anotando quién responde por él.
  const comparten = (detalle?.matches ?? []).filter((m) => !!m.phoneE164 && m.phoneE164 === ahora?.phoneE164 && m.status !== 'ARCHIVED' && m.score < 90)
    .map((m) => ({ id: m.candidateId, fullName: m.fullName ?? 'Otro socio', memberCode: m.memberCode }));
  const faltaResponsable = comparten.length > 0 && !responsableElegido(responsable);
  // D-10: un menor se aprueba cuando su tutor firma aquí.
  const tutorListo = tutor.nombre.trim().length >= 3 && tutor.acepta;
  const faltaTutor = !!detalle?.intake.minor && !tutorListo;
  const nCambios = cambios();
  const dato = (k: Campo, pintar: (v: string | null) => React.ReactNode) => (
    <>{pintar(ahora?.[k] ?? null)}{corregidos && k in corregidos ? <span className="tiny muted dato-corregido"> · corregido</span> : null}</>
  );
  const filtrosDeLista = (
    <div className="row wrap gap-8 filtros-altas">
      {sedes.length > 1 && (
        <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => { setLista(null); setSede(e.target.value); }}>
          <option value="">Todas las sucursales</option>
          {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <input className="input w-auto" type="search" aria-label="Buscar alta" placeholder="Nombre, celular o folio" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
    </div>
  );

  return (
    <>
      <PageHeader title="Altas digitales"
        sub="El socio capturó sus datos desde su teléfono. Aquí solo se confirma: menos de cinco minutos por alta."
        actions={<>
          <Segmented value={vista} onChange={setVista} options={VISTAS} />
          {/* Con la bandeja vacía el QR ya está en el aviso de abajo: no se repite. */}
          {!(bandejaVacia && !filtrando) && <Button variant="secondary" icon={<QrCode />} onClick={() => setEnlace(true)}>Formulario de alta</Button>}
        </>} />
      {!(bandejaVacia && !filtrando) && filtrosDeLista}

      {vista !== 'SUBMITTED' ? (
        // Si no caben todas, lo dice y deja pedir las demás: «Se muestran 50 de 212».
        <Card pad={false} footer={historial.datos && historial.datos.hasMore && historial.datos.nextCursor ? (
          <div className="row-between wrap">
            <span className="tiny muted">Se muestran {historial.datos.items.length} de {historial.datos.total}.</span>
            <Button size="sm" variant="secondary" loading={pidiendoMas} onClick={() => void cargarMas(historial.datos!.nextCursor!)}>Cargar más</Button>
          </div>
        ) : undefined}>
          <EstadoCarga carga={historial} titulo={vista === 'APPROVED' ? 'No se pudieron cargar las altas aprobadas' : 'No se pudieron cargar las altas rechazadas'} relleno
            esVacio={(d) => d.items.length === 0}
            esqueleto={<EsqueletoTabla filas={4} />} vacio={<Empty icon={<Inbox />} title={filtrando ? 'Ninguna coincide con esa búsqueda' : vista === 'APPROVED' ? 'Aún no hay altas aprobadas' : 'No hay altas rechazadas'} />}>
            {(historial) => (
            <div className="table-wrap">
              <table className="table table-stack" data-testid="historial-altas">
                <thead><tr><th>Nombre</th><th>Sucursal</th><th>Enviada</th><th>{vista === 'APPROVED' ? 'Aprobó' : 'Rechazó'}</th><th>{vista === 'APPROVED' ? '' : 'Motivo'}</th></tr></thead>
                <tbody>
                  {historial.items.map((i) => (
                    <tr key={i.id} className={i.memberId ? 'is-link' : undefined} onClick={() => i.memberId && router.push(`/socios/${i.memberId}`)}>
                      <td>{i.scrubbed && !i.memberId
                        // A los 90 días de revisada se borran sus datos: se dice, no se pinta un nombre vacío.
                        ? <span className="muted">Datos borrados</span>
                        : <span className="row gap-10"><Avatar name={i.fullName} size={30} />{i.memberId ? <Link className="strong row-link" href={`/socios/${i.memberId}`} onClick={(e) => e.stopPropagation()}>{i.scrubbed ? 'Ver al socio' : i.fullName}</Link> : <span className="strong">{i.fullName}</span>}</span>}</td>
                      <td data-label="Sucursal">{branchName(i.branchId)}</td>
                      <td className="muted small" data-label="Enviada">{fechaHora(i.submittedAt)}</td>
                      {/* Quién la revisó y cuándo; las que caducaron solas no tienen a nadie. */}
                      <td className="small" data-label={vista === 'APPROVED' ? 'Aprobó' : 'Rechazó'}>{i.reviewedByName ?? <span className="muted">{i.reviewedAt ? 'Nadie: se cerró sola' : '—'}</span>}{i.reviewedAt && i.reviewedByName ? <div className="tiny muted">{fecha(i.reviewedAt)}</div> : null}</td>
                      <td>{vista === 'APPROVED'
                        ? <span className="row small strong gap-4 justify-end">Ver ficha <ArrowRight size={14} /></span>
                        : <span className="small muted">{i.rejectionReason ?? '—'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </EstadoCarga>
        </Card>
      ) : lista === null ? (
        <div className="grid grid-inbox"><Skeleton h={360} r={16} /><Skeleton h={360} r={16} /></div>
      ) : falloLista ? (
        <ErrorCarga mensaje={falloLista} onReintentar={() => { setFalloLista(null); setLista(null); void cargar(); }} />
      ) : lista.length === 0 ? (
        filtrando
          ? <Card><Empty icon={<Inbox />} title="Ninguna alta coincide" text={porRevisar.total > 0 ? `Hay ${porRevisar.total} por revisar en total: borra la búsqueda o cambia de sucursal.` : 'Borra la búsqueda o cambia de sucursal.'} /></Card>
          : <Card><Empty icon={<Inbox />} title="Bandeja vacía" text="Cuando alguien llene el formulario de su sucursal, aparecerá aquí."
              action={<Button variant="secondary" icon={<QrCode />} onClick={() => setEnlace(true)}>Ver el QR del formulario</Button>} /></Card>
      ) : (
        <div className="grid grid-inbox" data-vista={enDetalle ? 'detalle' : 'lista'} data-testid="bandeja-altas">
          <Card pad={false} title={<>Por revisar <Badge tone="volt">{filtrando ? porRevisar.filtradas : Math.max(porRevisar.total, lista.length)}</Badge></>}
            footer={porRevisar.cursor ? (
              <div className="row-between wrap">
                <span className="tiny muted">Se muestran {lista.length} de {porRevisar.filtradas}.</span>
                <Button size="sm" variant="secondary" loading={pidiendoMas} onClick={() => void cargarMas(porRevisar.cursor!)}>Cargar más</Button>
              </div>
            ) : undefined}>
            <ul className="list">
              {lista.map((i) => (
                <li key={i.id} className={`list-item is-link${actual === i.id ? ' is-actual' : ''}`} onClick={() => { setEnDetalle(true); void abrir(i.id); }}>
                  <Avatar name={i.fullName} size={34} />
                  <div className="min-w-0 flex-1">
                    <button type="button" className="strong small ellipsis row-link" onClick={(e) => { e.stopPropagation(); setEnDetalle(true); void abrir(i.id); }}>{i.fullName}</button>
                    {/* De qué sede es, cuando quien mira ve más de una (9-09), y el folio que dicta el socio (9-06). */}
                    <div className="tiny muted">{hace(i.submittedAt)}{sedes.length > 1 ? ` · ${branchName(i.branchId)}` : ''} · <span className="mono">{i.folio}</span></div>
                    {i.flags.length > 0 && (
                      <div className="row wrap gap-4 insignias-alta">
                        {i.flags.map((f) => <Badge key={f} tone={INSIGNIA_DE_ALTA[f]?.tone}>{INSIGNIA_DE_ALTA[f]?.label ?? f}</Badge>)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {!detalle ? <Skeleton h={420} r={16} /> : (
            <Card pad={false}>
              <div className="card-body stack">
                <Button variant="ghost" size="sm" icon={<ArrowLeft />} className="solo-movil self-start"
                  onClick={() => setEnDetalle(false)}>Volver a la bandeja ({Math.max(porRevisar.total, lista.length)})</Button>
                <div className="row-between wrap">
                  <div className="row gap-14">
                    <Avatar name={`${ahora!.firstName} ${ahora!.lastName}`} size={52} />
                    <div>
                      <h2 className="titulo-alta">{ahora!.firstName} {ahora!.lastName}</h2>
                      <p className="small muted">Enviada {fechaHora(detalle.intake.submittedAt)}{sedes.length > 1 ? ` · ${branchName(detalle.intake.branchId)}` : ''} · folio <span className="mono">{detalle.intake.folio}</span></p>
                    </div>
                  </div>
                  {revisa && (
                    <Button variant="secondary" size="sm" icon={editando ? <X /> : <Pencil />} onClick={() => (editando ? (setEditando(false), setEdit({})) : corregir(detalle))}>
                      {editando ? 'Descartar cambios' : 'Corregir o completar'}
                    </Button>
                  )}
                </div>

                {s && <Callout tone={s.tone} title={s.title}>{s.text}</Callout>}
                {detalle.prospect && (
                  <Callout tone="info" title="Era interesado">
                    Estaba en seguimiento{detalle.prospect.source ? ` (${detalle.prospect.source})` : ''}, en «{ESTADO_DE_INTERESADO[detalle.prospect.status] ?? detalle.prospect.status}», con {detalle.prospect.followUps === 1 ? 'un contacto' : `${detalle.prospect.followUps} contactos`}
                    {detalle.prospect.branchId !== detalle.intake.branchId ? ` en ${branchName(detalle.prospect.branchId)}` : ''}. Al aprobar o vincular sale solo de seguimiento, como inscrito.
                  </Callout>
                )}
                {detalle.intake.minor && (
                  <div className="tutor-del-alta" data-testid="falta-su-tutor">
                    <Callout tone="danger" title="Falta su tutor">
                      Tiene menos de 18 años: su alta se aprueba cuando su papá, mamá o tutor firma aquí, en el mostrador.
                      {detalle.intake.guardianName ? <> Escribió a <strong>{detalle.intake.guardianName}</strong>{detalle.intake.guardianPhoneE164 ? <> · {telefono(detalle.intake.guardianPhoneE164)}</> : null}.</> : ' No escribió a quién llamar.'}
                    </Callout>
                    {revisa && (
                      <div className="stack-sm mt-8">
                        <div className="grid grid-2 gap-10">
                          <Field label="Quién firma (papá, mamá o tutor)" htmlFor="tu-nombre" required>
                            <input id="tu-nombre" className="input" value={tutor.nombre} onChange={(e) => setTutor({ ...tutor, nombre: e.target.value })} />
                          </Field>
                          <Field label="Su celular" htmlFor="tu-tel">
                            <input id="tu-tel" className="input" inputMode="tel" placeholder="10 dígitos" value={tutor.telefono} onChange={(e) => setTutor({ ...tutor, telefono: e.target.value })} />
                          </Field>
                        </div>
                        <Switch checked={tutor.acepta} onChange={(v) => setTutor({ ...tutor, acepta: v })}>
                          Está aquí, leyó el aviso de privacidad y el reglamento, y los acepta por {detalle.intake.firstName}
                        </Switch>
                        <Switch checked={tutor.salud} onChange={(v) => setTutor({ ...tutor, salud: v })}>
                          También acepta que el gimnasio guarde datos de salud de {detalle.intake.firstName}
                        </Switch>
                        {tutor.salud && (escribeSalud ? (
                          <Field label="Nota de salud (la dice su tutor)" htmlFor="tu-nota" hint="Lesiones, padecimientos o alergias. La ven la gerencia y su coach.">
                            <textarea id="tu-nota" className="textarea" rows={2} maxLength={1000} value={tutor.nota} onChange={(e) => setTutor({ ...tutor, nota: e.target.value })} />
                          </Field>
                        ) : (
                          <p className="small muted" data-testid="nota-de-salud-la-escribe-gerencia">Queda registrado que el tutor lo acepta. Recepción no lee ni escribe notas de salud (son un dato sensible): si el tutor quiere dejar una, que esta alta la apruebe la gerencia.</p>
                        ))}
                        <p className="tiny muted">La aceptación queda a nombre del tutor, con la fecha de hoy y quién lo atendió. Sin ella no se guarda ninguna nota de salud.</p>
                      </div>
                    )}
                  </div>
                )}
                {comparten.length > 0 && (revisa
                  ? <ElegirResponsable comparten={comparten} valor={responsable} onChange={setResponsable} quien={`${detalle.intake.firstName} (esta persona)`} />
                  : <Callout tone="warn" title={`Comparte celular con ${comparten.map((c) => c.fullName).join(' y ')}`}>Al aprobar se anota quién responde por ese número.</Callout>)}
                {revisa && !editando && <CoachAlAlta id="al-coach" value={coach} onChange={setCoach} branchId={detalle.intake.branchId} />}
                {!editando && faltan.length > 0 && (
                  <Callout tone="warn" title={faltan.length === 1 ? 'Falta un dato' : `Faltan ${faltan.length} datos`}>
                    <span data-testid="faltan-datos">{faltan.map((k) => FALTA[k]).join(' y ')}. </span>
                    {revisa && <button type="button" className="enlace-en-linea strong" onClick={() => corregir(detalle)}>Completar ahora</button>}
                  </Callout>
                )}

                {editando ? (
                  <div className="stack-sm" data-testid="corregir-alta">
                    <p className="small muted">Corrige o completa lo que haga falta. El formulario original del socio se conserva como evidencia; lo que cambies queda en la bitácora.</p>
                    <div className="grid grid-2 gap-10">
                      {CAMPOS.map(([k, label, tipo]) => (
                        <Field key={k} label={label} htmlFor={`ca-${k}`} hint={faltan.includes(k) ? 'Falta este dato.' : undefined}>
                          {tipo === 'date'
                            // Día/mes/año siempre, sin depender del idioma de la computadora (D26-02).
                            ? <CampoFecha id={`ca-${k}`} value={edit[k] ?? ''} onChange={(v) => setEdit({ ...edit, [k]: v })} />
                            : <input id={`ca-${k}`} className="input" type={tipo} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}
                        </Field>
                      ))}
                    </div>
                    {nCambios > 0 && <p className="tiny muted">Vas a cambiar: {nCambios} {nCambios === 1 ? 'dato' : 'datos'} de lo que envió.</p>}
                  </div>
                ) : (
                <dl className="kv kv-altas">
                  <dt>Teléfono</dt><dd>{dato('phoneE164', (v) => telefono(v))}</dd>
                  <dt>Correo</dt><dd>{dato('email', (v) => v ?? '—')}</dd>
                  <dt>Nacimiento</dt><dd>{dato('birthDate', (v) => fecha(v))}</dd>
                  <dt>Socio desde</dt><dd>{dato('memberSince', (v) => (v ? fecha(v) : 'Es nuevo'))}</dd>
                  <dt>Emergencia</dt><dd>{ahora!.emergencyContactName
                    ? `${ahora!.emergencyContactName}${ahora!.emergencyContactPhone ? ` · ${telefono(ahora!.emergencyContactPhone)}` : ''}` : '—'}{corregidos && ('emergencyContactName' in corregidos || 'emergencyContactPhone' in corregidos) ? <span className="tiny muted dato-corregido"> · corregido</span> : null}</dd>
                  <dt>Salud</dt><dd>{detalle.intake.minor ? 'Es menor: lo de salud lo autoriza y lo dice su tutor al firmar'
                    : detalle.intake.healthNotes
                    ?? (detalle.intake.hasHealthNotes ? 'Dejó una nota (la ven la gerencia, su coach y a quien la gerencia se lo autorice)' : 'Sin notas')}</dd>
                </dl>
                )}
                {corregidos && !editando && (
                  <p className="tiny muted" data-testid="corregida-por">
                    Corregida por {detalle.intake.correctedByName?.split(' ')[0] ?? 'alguien del equipo'}{detalle.intake.correctedAt ? ` · ${hace(detalle.intake.correctedAt)}` : ''}: se aplica al aprobar o vincular.
                    {revisa && <> <button type="button" className="enlace-en-linea" disabled={ocupado} onClick={() => void guardarSinAprobar(null)}><Undo2 size={11} /> Dejarla como la envió</button></>}
                  </p>
                )}

                <div>
                  <p className="label mb-8">Firmó</p>
                  <div className="row wrap gap-6">
                    {detalle.intake.acceptedConsents.filter((c) => c.granted).map((c) => (
                      <Badge key={c.consentType} tone="ok"><FileSignature size={12} />{CONSENT_TYPE[c.consentType] ?? c.consentType} · {c.version}</Badge>
                    ))}
                    {detalle.intake.acceptedConsents.filter((c) => c.granted).length === 0 && <span className="muted small">Nada</span>}
                  </div>
                  <p className="tiny muted mt-6">Desde su teléfono{detalle.intake.minor ? '. Es menor: lo que vale es la firma de su tutor en el mostrador' : ''}</p>
                </div>

                {detalle.matches.length > 0 && (
                  <div>
                    <p className="label mb-8">Posibles duplicados</p>
                    <div className="card shadow-none">
                      <table className="table table-stack">
                        <thead><tr><th>Ficha existente</th><th>Parecido</th><th>Por qué</th><th /></tr></thead>
                        <tbody>
                          {detalle.matches.map((m) => (
                            <tr key={m.candidateId}>
                              <td>
                                <Link href={`/socios/${m.candidateId}`} target="_blank" className="strong">{m.fullName ?? 'Ver ficha'}</Link>
                                <div className="tiny muted">{m.memberCode ? <code>{m.memberCode}</code> : null}{m.phoneE164 ? ` · ${telefono(m.phoneE164)}` : ''}{m.status ? ` · ${MEMBER_STATUS[m.status]?.label ?? m.status}` : ''}{m.hasMembership ? ' · ya tiene membresía' : ''}</div>
                              </td>
                              {/* El puntaje viene de 0 a 100 (umbral de fusión: 90). */}
                              <td>{m.sharedPhone ? <Badge tone="warn">Comparten celular</Badge> : <Badge tone={m.score >= 90 ? 'danger' : 'warn'}>{Math.round(m.score)}%</Badge>}</td>
                              <td className="small muted">{m.explanation}</td>
                              <td className="right text-right">
                                {revisa && <Button size="sm" variant="secondary" icon={<Link2 />} disabled={ocupado || faltaTutor}
                                  onClick={() => void vincular(detalle.intake.id, m)}>Es esta persona</Button>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="tiny muted mt-8">
                      Fusionar a dos personas distintas es un incidente de privacidad; no fusionar a la misma le hace pagar dos veces o perder su antigüedad.
                    </p>
                  </div>
                )}
                {falloAccion && <Callout tone="danger" title="No se hizo"><span data-testid="fallo-alta">{falloAccion}</span></Callout>}
              </div>
              <div className="card-foot row wrap gap-8">
                {!revisa ? <p className="small muted m-0">Solo puedes consultar: aprueba o rechaza la gerencia.</p> : <>
                {/* Con coincidencias, "Aprobar" chocaría contra el duplicado: la
                    decisión es "es esta persona" (arriba) o "es otra". */}
                {detalle.matches.length === 0
                  ? <Button icon={<Check />} loading={ocupado} disabled={faltaTutor} onClick={() => void aprobar(detalle.intake.id, false)}>{nCambios > 0 ? 'Aprobar con los cambios' : 'Aprobar'}</Button>
                  : (
                    <Button variant="secondary" icon={<UserPlus />} disabled={ocupado || faltaTutor || faltaResponsable} onClick={() => void aprobar(detalle.intake.id, true)}>
                      Es otra persona: crear socio nuevo
                    </Button>
                  )}
                {faltaTutor && <span className="tiny muted" data-testid="espera-tutor">Para aprobar, que firme su tutor (arriba).</span>}
                {!faltaTutor && faltaResponsable && <span className="tiny muted">Para crear al socio, elige quién responde por el celular.</span>}
                {/* Lo corregido no se pierde si el socio va por su identificación o llega otra alta (9-21). */}
                {editando && <Button variant="ghost" icon={<Save />} disabled={ocupado} onClick={() => void guardarSinAprobar(enPantalla())}>Guardar sin aprobar</Button>}
                <span className="flex-1" />
                <Button variant="danger-ghost" icon={<X />} disabled={ocupado} onClick={() => setRechazo(true)}>Rechazar</Button>
                </>}
              </div>
            </Card>
          )}
        </div>
      )}

      {rechazo && detalle && (
        <RechazarDialog nombre={`${detalle.intake.firstName} ${detalle.intake.lastName}`} id={detalle.intake.id}
          onClose={() => setRechazo(false)} onListo={() => { setRechazo(false); toast('ok', 'Alta rechazada.'); void siguiente(); }} />
      )}
      {enlace && <EnlaceAltaDialog onClose={() => setEnlace(false)} />}
      {aprobada && <AprobadaDialog alta={aprobada} onSiguiente={() => { setAprobada(null); void siguiente(); }} />}
    </>
  );
}

/**
 * «Rechazar el alta de {nombre}» (la confirmación nombra a la persona): el
 * motivo, de un toque. Antes recepción escribía «prueba» de veinte formas y
 * nadie podía contar por qué se rechaza.
 */
function RechazarDialog({ nombre, id, onClose, onListo }: { nombre: string; id: string; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [fallo, setFallo] = useState<string | null>(null);
  const f = useFormulario({ motivo: motivo.trim().length < 3 && 'Elige un motivo o escríbelo.' });
  async function rechazar() {
    setFallo(null);
    try {
      await api(`/intakes/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      onListo();
    } catch (err) { setFallo(errorText(err, 'No se pudo rechazar')); }
  }
  return (
    <Dialog open onClose={onClose} title={`Rechazar el alta de ${nombre}`} error={fallo}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(rechazar)}>Rechazar</Button></>}>
      <CampoMotivo id="mr" autoFocus value={motivo} onChange={setMotivo} motivos={textosDeMotivo('rechazarAlta')} error={f.error('motivo')} hint="Queda registrado con tu nombre." />
    </Dialog>
  );
}

/**
 * «Alta aprobada» y «Alta vinculada a su ficha»: el veredicto y, en vez de un
 * párrafo, la lista de pasos para terminar el alta (9-01), decidida por el
 * estado del socio. El primero sin hacer es el botón principal: a quien se
 * vinculó y ya tiene membresía no se le ofrece vender otra (9-17).
 */
function AprobadaDialog({ alta, onSiguiente }: {
  alta: { memberId: string; memberCode: string; nombre: string; pendientes: string[]; vinculada?: boolean; eraInteresado: boolean };
  onSiguiente: () => void;
}) {
  const router = useRouter();
  const pasos = useOnboarding(alta.memberId);
  const o = pasos.datos;
  // Mientras llega (o si no llegó): al recién aprobado le falta su plan; al vinculado, lo dirá su ficha.
  const principal = o ? (o.next ? accionDelPaso(o, o.next) : null) : alta.vinculada || pasos.error !== null ? null : { href: `/socios/${alta.memberId}?vender=1`, texto: 'Vender membresía' };
  return (
    <Dialog open onClose={onSiguiente} title={alta.vinculada ? 'Alta vinculada a su ficha' : 'Alta aprobada'}
      footer={<>
        <Button variant="ghost" onClick={onSiguiente}>Siguiente alta</Button>
        <span className="flex-1" />
        <Button variant={principal ? 'secondary' : undefined} onClick={() => router.push(`/socios/${alta.memberId}`)}>Ver ficha</Button>
        {principal && <Button onClick={() => router.push(principal.href)}>{principal.texto}</Button>}
      </>}>
      <div className="stack">
        <div className="row gap-14">
          <span className="empty-icon veredicto-ok"><CircleCheck /></span>
          <div>
            {alta.vinculada ? <>
              <p className="strong">Se actualizó la ficha de {alta.nombre}: <code>{alta.memberCode}</code></p>
              <p className="small muted">Con su contacto nuevo, lo que corregiste y lo que firmó desde su teléfono. Conserva su historial y su antigüedad.</p>
            </> : <>
              <p className="strong">{alta.nombre} ya es socio: <code>{alta.memberCode}</code></p>
              <p className="small muted">Con sus datos, su antigüedad y lo que firmó desde su teléfono.</p>
            </>}
            {alta.eraInteresado && <p className="small muted" data-testid="interesado-convertido">Estaba en seguimiento como interesado: ya quedó como inscrito.</p>}
          </div>
        </div>
        {alta.pendientes.length > 0 && (
          <Callout tone="warn" title="Hay que volver a pedirle una firma">
            Aceptó una versión anterior de: {alta.pendientes.map((t) => CONSENT_TYPE[t] ?? t).join(', ')}.
          </Callout>
        )}
        <div>
          <p className="label mb-8">Lo que sigue</p>
          <PasosDelAlta carga={pasos} />
        </div>
      </div>
    </Dialog>
  );
}
