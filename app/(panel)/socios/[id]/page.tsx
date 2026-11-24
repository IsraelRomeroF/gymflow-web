'use client';

import { PasosDelAlta, useOnboarding } from '@/components/altas/pasos-del-alta';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { Phone, Building2, CalendarDays, LayoutGrid, ScanFace, FileSignature, Receipt, CreditCard, Wallet, Smartphone, ShoppingBag, HeartPulse, LifeBuoy, DoorOpen, Pencil, CalendarCheck, UserRoundCheck, ListChecks, History, PhoneCall, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { antiguedad, fecha, fechaHora, pesos, telefono } from '@/lib/format';
import { CONSENT_CHANNEL, CONSENT_TYPE } from '@/lib/labels';
import { useSession } from '@/components/session';
import { Avatar, Badge, Breadcrumb, Button, Callout, Card, Empty, PageHeader, Skeleton, Stat, Tabs, ErrorCarga, NoExiste, esNoExiste, EsqueletoTabla, MenuMas } from '@/components/ui';
import { useCarga } from '@/lib/carga';
import { hoyEn, zonaDe } from '@/lib/zonas';
import { BiometriaTab, FirmarTextoVigenteDialog, type Enrollment } from '@/components/biometria';
import { VenderDialog, CobrarDialog } from '@/components/venta';
import { InscribirClaseDialog } from '@/components/inscribir-clase';
import { ClasesSocioCard } from '@/components/clase-socio';
import { AccionesMembresia, type Membresia } from '@/components/membresia';
import { EntradaDialog } from '@/components/entrada';
import { EditarSocioDialog } from '@/components/socio-form';
import { CelularCompartido } from '@/components/altas/responsable';
import { RutinaSocioTab } from '@/components/rutina-socio';
import { EstadoDeCuenta } from '@/components/estado-de-cuenta';
import type { MemberDayPasses, MemberStatement } from '@gymflow/core/contracts';
import type { Plan } from '@/lib/plans';
import { AccesoBadge, useResumenAcceso } from '@/components/acceso';
import { AccesosSocio } from '@/components/accesos-socio';
import { BitacoraSocio } from '@/components/bitacora';
import { PrivacidadCard } from '@/components/privacidad';
import { SolicitudesArco, RetirarConsentimientoDialog, LeerFirmaDialog } from '@/components/arco';
import { REVOCABLES_EN_RECEPCION } from '@gymflow/core/privacidad';
import { ReactivarDialog } from '@/components/portal-socio';
import { PortalDelSocioDialog } from '@/components/ficha/portal';
import { HistoriaSocio } from '@/components/ficha/historia';
import { ComprasSocio } from '@/components/ficha/compras';
import { ContactoDialog } from '@/components/seguimiento';
import { CoachDelSocio } from '@/components/coach-socio';

type Member = {
  id: string; memberCode: string; firstName: string; lastName: string;
  phoneE164: string | null; email: string | null; birthDate: string | null;
  status: string; homeBranchId: string | null; joinedAt: string; balanceCents: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null; anonymizedAt?: string | null;
  /** Lo que el servidor ocultó a quien mira (`MemberSummary.hidden`, 2.13). */
  hidden: Array<'contact' | 'balance'>;
  /** Coach asignado (2026-10-09). */
  coachUserId?: string | null;
};
type Membership = Membresia & {
  startDate: string; graceUntil: string | null; grantsAccess: boolean;
};
/** El estado de cuenta: contrato del núcleo (`GET /members/:id/statement`), ya no un tipo a mano. */
type Statement = MemberStatement;
type Consent = {
  id: string; consentType: string; documentVersion: string; granted: boolean; grantedAt: string; revokedAt: string | null; channel: string | null;
  /** Firmó un texto biométrico anterior al vigente (6-03, 21-09): debe volver a firmar. */
  needsResign?: boolean; currentVersion?: string | null;
};

type Tab = 'resumen' | 'historia' | 'accesos' | 'biometria' | 'consentimientos' | 'cuenta' | 'rutina' | 'bitacora';

/**
 * Ficha del socio. Todo lo que recepción necesita de una persona, en una
 * pantalla con pestañas: quién es, si puede entrar, cuánto debe, qué firmó y
 * con qué se identifica en la puerta.
 */
export default function SocioPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { can, activo, branchName, inScope, branches, org } = useSession();
  // Un solo diálogo «Portal de {nombre}»: ver sus teléfonos, cerrarlo y darle el código (bloque 2.2).
  const [portal, setPortal] = useState(false);
  // `?portal=1` llega del paso «Darle su código del portal» de un alta aprobada (2.12): abre el diálogo de una vez.
  const pidePortal = search.get('portal') === '1' && can('members:portal:invite') && activo('member_portal');
  // Se consume una vez y se quita de la dirección, como `?vender=1`: recargar no lo vuelve a abrir.
  useEffect(() => { if (pidePortal) { setPortal(true); router.replace(`/socios/${id}`, { scroll: false }); } }, [pidePortal, id, router]);
  const [contacto, setContacto] = useState(false);
  // Sube con cada cambio hecho desde la ficha: la Historia se vuelve a pedir.
  const [cambios, setCambios] = useState(0);
  const [retirar, setRetirar] = useState<Consent | null>(null);
  const [leerFirma, setLeerFirma] = useState<Consent | null>(null);
  const [volverAFirmar, setVolverAFirmar] = useState(false);
  const [reactivar, setReactivar] = useState(false);
  const [inscribir, setInscribir] = useState(false);
  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab) ?? 'resumen');
  // Bloque 2.3: «Registrar su rostro» de la franja del alta llega a ESTA misma ficha con
  // `?registrar=rostro`; la pestaña Biometría abre entonces su asistente.
  const pideRostro = search.get('registrar') === 'rostro';
  useEffect(() => { if (pideRostro) setTab('biometria'); }, [pideRostro]);
  const [m, setM] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cada bloque de la ficha con sus tres estados (26-01): con la red caída ya
  // no dice «Sin membresía» (y ofrecía vender otra), «Sin consentimientos»,
  // «Sin biometría» ni «Sin notas de salud», ni deja un esqueleto eterno en
  // el estado de cuenta. Todo sale en UNA ola, sin esperar a la ficha.
  const membresiasCarga = useCarga(useCallback(() => api<Membership[]>(`/members/${id}/memberships`), [id]));
  const memberships = membresiasCarga.datos ?? null;
  // Sin el catálogo solo se pierde el nombre del plan: se dice «Plan».
  const planesCarga = useCarga(useCallback(() => (can('catalog:read') ? api<Plan[]>('/plans?includeInactive=true') : Promise.resolve([] as Plan[])), [can]));
  const plans = useMemo(() => new Map((planesCarga.datos ?? []).map((p) => [p.id, p])), [planesCarga.datos]);
  const cuentaCarga = useCarga(useCallback(() => (can('billing:statement:read') ? api<Statement>(`/members/${id}/statement`) : Promise.resolve(null)), [id, can]));
  const st = cuentaCarga.datos ?? null;
  const consentsCarga = useCarga(useCallback(() => (can('members:consent:read') ? api<Consent[]>(`/members/${id}/consents`) : Promise.resolve(null)), [id, can]));
  const consents = consentsCarga.datos ?? null;
  const bioCarga = useCarga(useCallback(() => (can('members:consent:read') && activo('biometrics')
    ? api<{ enrollments: Enrollment[] }>(`/members/${id}/biometric-enrollments`).then((r) => r.enrollments) : Promise.resolve(null)), [id, can, activo]));
  const bio = bioCarga.datos ?? null;
  // Solo con permiso de salud: la API no se la da a nadie más.
  const verSalud = can('members:health:read');
  const saludCarga = useCarga(useCallback(() => (verSalud ? api<{ healthNotes: string | null }>(`/members/${id}/health`).then((r) => r.healthNotes) : Promise.resolve(undefined)), [id, verSalud]));
  // `?vender=1` llega desde la aprobación de un alta: el siguiente paso es
  // venderle su plan. Se consume una sola vez y se quita de la dirección:
  // antes, recargar la ficha después de vender volvía a abrir el asistente.
  const [pideVenta, setPideVenta] = useState(search.get('vender') === '1');
  const [vender, setVender] = useState(false);
  // Cuántas ventas se cerraron aquí: un pase del día no mueve membresías ni saldo, pero sí si puede entrar.
  const [ventas, setVentas] = useState(0);
  // Los pases del día que lleva (1.8): las visitas sueltas se cuentan en la ficha.
  const pasesCarga = useCarga(useCallback(() => api<MemberDayPasses>(`/members/${id}/day-passes`), [id]));
  const [entrada, setEntrada] = useState(false);
  const [editar, setEditar] = useState(false);
  const [cobrar, setCobrar] = useState(false);

  /** La ficha misma. Si no responde al volver a pedirla, se dice: no se queda la de antes como si fuera la de ahora. */
  const recargarSocio = useCallback(() => api<Member>(`/members/${id}`).then(setM).catch((e) => {
    if (esNoExiste(e)) setError('Este socio no existe o no pertenece a tu organización.');
    else setError('No se pudo cargar la ficha.');
  }), [id]);

  /** Tras vender o cobrar: membresía, saldo y estado del socio cambian juntos. */
  const recargarMembresias = membresiasCarga.recargar;
  const recargarEstado = cuentaCarga.recargar;
  const recargarCuenta = useCallback(async () => {
    setCambios((n) => n + 1);
    await Promise.all([recargarSocio(), recargarMembresias(), recargarEstado()]);
  }, [recargarSocio, recargarMembresias, recargarEstado]);

  useEffect(() => { void recargarSocio(); }, [recargarSocio]);

  // Enrolar firma un consentimiento nuevo: cuando cambia la biometría, la
  // pestaña de consentimientos se vuelve a pedir para no mostrar una lista vieja.
  const ponerBio = bioCarga.poner;
  const recargarConsents = consentsCarga.recargar;
  const alCambiarBiometria = useCallback((items: Enrollment[]) => {
    ponerBio(items);
    void recargarConsents();
  }, [ponerBio, recargarConsents]);

  /**
   * Dónde cobrar: primero la sucursal del cargo pendiente más antiguo —ahí se
   * vendió—, luego la de casa, luego cualquiera a mi alcance. Sin filtrar por
   * alcance, recepción de Centro intentaba cobrar en Frontera y la API, con
   * razón, lo rechazaba al final.
   */
  function sedesDeCobro(s: Statement, casa: string | null): string[] {
    const abiertos = s.charges.filter((c) => BigInt(c.balanceCents) > 0n)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((c) => c.branchId);
    const orden = [...abiertos, casa, ...branches.filter((b) => b.isActive).map((b) => b.id)];
    return [...new Set(orden.filter((b): b is string => !!b && inScope(b)))];
  }

  useEffect(() => {
    if (!pideVenta || memberships === null) return;
    // Se consume UNA vez: la ficha recarga membresías al editar o cobrar, y
    // sin esto el asistente de venta se volvía a abrir solo.
    setPideVenta(false);
    router.replace(`/socios/${id}`, { scroll: false });
    if (!memberships.some((x) => !['CANCELED', 'EXPIRED'].includes(x.status))) setVender(true);
  }, [pideVenta, memberships, id, router]);

  function cambiarTab(t: Tab) {
    setTab(t);
    router.replace(`/socios/${id}${t === 'resumen' ? '' : `?tab=${t}`}`, { scroll: false });
  }

  // Insignia única de acceso y paquete de visitas (UXA-03/04). Se vuelve a
  // pedir cuando cambia la cuenta: tras vender o cobrar, el estado se mueve.
  const acceso = useResumenAcceso([id], `${memberships?.length ?? ''}-${m?.balanceCents ?? ''}-${st?.outstandingCents ?? ''}-${memberships?.[0]?.status ?? ''}-${ventas}-${pasesCarga.datos?.total ?? ''}`);
  const paquete = acceso.get(id)?.pack ?? null;
  // Su pase del día de hoy (1.8): no es una membresía, pero hoy entra con él.
  const paseDeHoy = acceso.get(id)?.dayPass ?? null;

  if (error) {
    // "No encontrado" solo si la API dijo 404; un error de red no lo es (UI3-01).
    return error.startsWith('Este socio no existe')
      ? <NoExiste titulo="Este socio no existe" texto="No está en el padrón, o lo dieron de baja. Búscalo por nombre o código." volverA="/socios" volverTexto="Ir a Socios" />
      : <ErrorCarga mensaje={error} onReintentar={() => window.location.reload()} />;
  }
  if (!m) {
    return (
      <div className="stack">
        <div className="row" style={{ gap: 18 }}><Skeleton h={64} w={64} r={32} /><div className="stack-sm flex-1"><Skeleton h={26} w={280} /><Skeleton h={14} w={360} /></div></div>
        <div className="grid grid-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={104} r={16} />)}</div>
        <EsqueletoTabla filas={4} />
      </div>
    );
  }

  const nombre = `${m.firstName} ${m.lastName}`;
  const vigente = memberships?.find((x) => !['CANCELED', 'EXPIRED'].includes(x.status)) ?? memberships?.[0];
  // El saldo es dinero: quien no ve estados de cuenta (el coach) no lo recibe (SEC2-06).
  const verDinero = st != null || m.balanceCents !== null;
  const saldo = BigInt(st?.outstandingCents ?? m.balanceCents ?? 0);
  // Lo que se le cobra es lo que debe MENOS lo que tiene a favor, que se aplica
  // primero: la ficha y Caja proponen la misma cifra (4-18).
  const credito = BigInt(st?.creditCents ?? 0);
  const neto = st ? (saldo > credito ? saldo - credito : 0n) : saldo;
  const planVigente = vigente ? plans.get(vigente.planId) ?? null : null;
  // Lo que debe de ESTA membresía (cuota, inscripción): con algo abierto, primero se cobra (4-06).
  const abiertasVigente = vigente && st ? st.charges.filter((c) => c.membershipId === vigente.id && BigInt(c.balanceCents) > 0n) : [];
  const deudaVigente = abiertasVigente.reduce((a, c) => a + BigInt(c.balanceCents), 0n);
  // Sin el estado de cuenta, «hoy» es el de su sucursal de casa, no el de la computadora (26-06).
  const hoyNegocio = st?.today ?? hoyEn(zonaDe(branches.find((b) => b.id === m.homeBranchId), org));
  // EL DÍA DE CORTE (4-14): activa, pero con la cuota abierta. No está «al corriente».
  const cuotaAbierta = vigente?.status === 'ACTIVE' && deudaVigente > 0n
    ? { cents: deudaVigente, vence: abiertasVigente.map((c) => c.dueDate.slice(0, 10)).sort()[0]! }
    : null;
  const textoCuota = cuotaAbierta
    ? cuotaAbierta.vence === hoyNegocio ? `Hoy le toca pagar ${pesos(cuotaAbierta.cents)}`
      : cuotaAbierta.vence > hoyNegocio ? `Por pagar ${pesos(cuotaAbierta.cents)} · vence ${fecha(cuotaAbierta.vence)}`
        : `Pago atrasado · ${pesos(cuotaAbierta.cents)}`
    : null;
  // Su periodo terminó antes de hoy y sigue sin renovarse: la cuota no se pudo
  // emitir y la membresía no avanzó (A3-N1). Se dice aquí, no solo en la bitácora.
  const sinRenovar = vigente?.status === 'ACTIVE' && vigente.autoRenew && vigente.currentPeriodEnd.slice(0, 10) < hoyNegocio;
  /** Cómo se renueva, dicho según el tipo de plan (4-01, 4-02). */
  const renovacion = (x: Membership) => x.autoRenew ? 'Se renueva sola'
    : planVigente?.billingModel === 'DAY_PASS' ? 'Visita suelta: no se renueva'
      : planVigente?.billingModel === 'PREPAID_PERIOD' ? 'No se renueva: vence y se vuelve a vender'
        : 'Renovación manual';
  // «Vigente hasta» solo cuando de verdad lo está; si debe, lo que cuenta es hasta dónde pagó (3-01).
  const esVigencia = !!vigente && ['ACTIVE', 'TRIALING', 'FROZEN'].includes(vigente.status) && !cuotaAbierta;
  const bioVivos = bio?.filter((e) => !e.revokedAt) ?? [];
  // Su firma biométrica es de un texto anterior al vigente (6-03, 21-09). No le impide entrar.
  const firmaVieja = consents?.find((c) => c.consentType === 'BIOMETRIC' && c.needsResign && c.currentVersion) ?? null;
  const porRenovar = firmaVieja ? { signedVersion: firmaVieja.documentVersion, currentVersion: firmaVieja.currentVersion! } : null;

  // Teléfono, correo y contacto de emergencia llegan vacíos a quien no puede verlos (SEC2-06): «oculto» no es «no tiene».
  // Lo dice el servidor (`hidden`, 2.13): ya no se deduce aquí con los permisos de la sesión.
  const veContacto = !m.hidden.includes('contact');
  const oculto = <span className="muted">No visible para tu puesto o sucursal</span>;
  // Lo que debe, dicho como se dice en el mostrador: cuántos cargos y desde cuándo.
  const abiertos = st ? st.charges.filter((c) => BigInt(c.balanceCents) > 0n && !['VOID', 'WRITTEN_OFF'].includes(c.status)) : [];
  const masViejo = abiertos.map((c) => c.dueDate.slice(0, 10)).sort()[0] ?? null;
  const puedePortal = can('members:portal:invite') && activo('member_portal');
  // «Le llamé», también desde la ficha (3-11): mismo permiso y mismo módulo que en Retención.
  const puedeContacto = can('retention:followup:write') && activo('retention') && m.status !== 'ARCHIVED' && (!m.homeBranchId || inScope(m.homeBranchId));

  // El orden es el de las preguntas del mostrador: quién es, qué ha pasado, qué debe; después lo de la puerta, lo firmado y lo del coach.
  const tabs = [
    { value: 'resumen' as const, label: 'Resumen', icon: <LayoutGrid /> },
    // Su historia en una línea de tiempo (bloque 2.2; 3-11): la ve quien abre la ficha, cada quien con sus partes.
    { value: 'historia' as const, label: 'Historia', icon: <ScrollText /> },
    ...(can('billing:statement:read') ? [{ value: 'cuenta' as const, label: 'Estado de cuenta', icon: <Receipt /> }] : []),
    // Historial de accesos (2026-10-09): entradas, negativas y excepciones con su motivo.
    ...(can('access:attendance:read') ? [{ value: 'accesos' as const, label: 'Accesos', icon: <DoorOpen /> }] : []),
    ...(can('members:consent:read') && activo('biometrics') ? [{ value: 'biometria' as const, label: 'Biometría', icon: <ScanFace />, count: bioVivos.length }] : []),
    ...(can('members:consent:read') ? [{ value: 'consentimientos' as const, label: 'Consentimientos', icon: <FileSignature />, count: consents?.filter((c) => c.granted && !c.revokedAt).length }] : []),
    ...((can('training:assign') || can('training:read')) && activo('training') ? [{ value: 'rutina' as const, label: 'Rutina', icon: <ListChecks /> }] : []),
    // Todo lo asentado sobre este socio (1.11): lo ve quien tiene Bitácora, y solo lo de sus sucursales.
    ...(can('audit:read') ? [{ value: 'bitacora' as const, label: 'Bitácora', icon: <History /> }] : []),
  ];

  return (
    <>
      <PageHeader eyebrow={<Breadcrumb items={[{ label: 'Socios', href: '/socios' }, { label: m.memberCode }]} />} title={
        <div className="profile">
          <Avatar name={nombre} size={64} />
          <div>
            <div className="row wrap gap-10">
              <h1 className="profile-name">{nombre}</h1>
              {/* Junto al nombre va lo que recepción necesita saber de un vistazo:
                  si la membresía no está al corriente, eso; si no, el estado del
                  socio. "Activo" al lado de "Pago pendiente" confundía (UI-14). */}
              {/* El día de corte no dice «al corriente»: dice que hoy le toca pagar (4-14). */}
              {textoCuota && m.status !== 'ARCHIVED'
                ? <Badge tone="warn" dot>{textoCuota}</Badge>
                : <AccesoBadge resumen={acceso.get(m.id)} archivado={m.status === 'ARCHIVED'} />}
            </div>
            <div className="profile-meta">
              <span><code>{m.memberCode}</code></span>
              <span><Building2 />{branchName(m.homeBranchId)}</span>
              <span><CalendarDays />Socio desde hace {antiguedad(m.joinedAt)}</span>
              {m.phoneE164 && <span><Phone />{telefono(m.phoneE164)}</span>}
            </div>
          </div>
        </div>
      } actions={
        // Lo del día a día, en orden de frecuencia: dejarlo pasar, cobrarle,
        // venderle. Cancelar no vive aquí: está en la tarjeta de la membresía,
        // apartado, para no pulsarlo por error.
        <div className="acciones-ficha">
          {/* UN botón principal (UX5-UI-03): cobrar si debe; si no, dejarlo pasar.
              Lo demás, como secundario o en "Más". */}
          {(() => {
            const debeAlgo = can('payments:record') && !!st && neto > 0n;
            const puedeEntrar = can('access:monitor') && m.status !== 'ARCHIVED';
            const puedeVender = can('memberships:create') && memberships !== null && !memberships.some((x) => !['CANCELED', 'EXPIRED'].includes(x.status));
            // Inscribir a una clase: a la vista si no compite con vender; si no, en "Más".
            const puedeInscribir = can('classes:book_for_member') && activo('classes') && m.status !== 'ARCHIVED';
            const inscribirVisible = puedeInscribir && !(puedeVender && !debeAlgo);
            return (
              <>
                {puedeEntrar && <Button variant={debeAlgo ? 'secondary' : 'primary'} icon={<DoorOpen />} onClick={() => setEntrada(true)}>Registrar entrada</Button>}
                {debeAlgo && <Button icon={<Wallet />} onClick={() => setCobrar(true)}>Cobrar {pesos(neto)}</Button>}
                {/* Solo sin membresía viva: una segunda la rechaza la API, y ofrecerla sería invitar al error. */}
                {puedeVender && !debeAlgo && <Button variant={puedeEntrar ? 'secondary' : 'primary'} icon={<ShoppingBag />} onClick={() => setVender(true)}>Vender membresía</Button>}
                {inscribirVisible && <Button variant="secondary" icon={<CalendarCheck />} onClick={() => setInscribir(true)}>Inscribir a clase</Button>}
                <MenuMas items={[
                  puedeInscribir && !inscribirVisible && { label: 'Inscribir a una clase', icon: <CalendarCheck />, onClick: () => setInscribir(true) },
                  puedeVender && debeAlgo && { label: 'Vender membresía', icon: <ShoppingBag />, onClick: () => setVender(true) },
                  can('members:update') && { label: 'Editar datos', icon: <Pencil />, onClick: () => setEditar(true) },
                  // Agua, suplemento, toalla: la venta queda ligada al socio ("¿Qué le cobras?").
                  can('pos:sale:create') && activo('pos') && { label: 'Venderle producto', icon: <ShoppingBag />, onClick: () => router.push(`/punto-de-venta?socio=${m.id}&nombre=${encodeURIComponent(m.firstName)}${m.homeBranchId ? `&sede=${m.homeBranchId}` : ''}`) },
                  // «Le llamé», «vino a preguntar»: queda en su Historia (3-11).
                  puedeContacto && { label: 'Registrar contacto', icon: <PhoneCall />, onClick: () => setContacto(true) },
                  // Un solo «Portal de {nombre}» (bloque 2.2): sus teléfonos, cerrarlo (PS-02) y el código, que recepción entrega sin editar la ficha (UX4-02).
                  puedePortal && { label: `Portal de ${m.firstName}`, icon: <Smartphone />, onClick: () => setPortal(true) },
                  // Un exsocio vuelve (PS-04): misma ficha, mismo código.
                  can('members:create') && m.status === 'ARCHIVED' && !m.anonymizedAt && { label: 'Reactivar como socio', icon: <UserRoundCheck />, onClick: () => setReactivar(true) },
                ]} />
              </>
            );
          })()}
          {portal && <PortalDelSocioDialog memberId={m.id} nombre={m.firstName} onClose={() => { setPortal(false); setCambios((n) => n + 1); }} />}
          {contacto && <ContactoDialog para="socio" nombre={m.firstName} url={`/members/${m.id}/follow-ups`}
            onClose={() => setContacto(false)} onListo={() => { setContacto(false); setCambios((n) => n + 1); }} />}
          {reactivar && <ReactivarDialog memberId={m.id} nombre={`${m.firstName} ${m.lastName}`} onClose={() => setReactivar(false)} onHecho={() => { setReactivar(false); void recargarCuenta(); }} />}
          {inscribir && <InscribirClaseDialog memberId={m.id} nombre={m.firstName} homeBranchId={m.homeBranchId} onClose={() => { setInscribir(false); setCambios((n) => n + 1); }} />}
        </div>
      } />

      <div className="grid grid-4 mb-24">
        <Stat
          icon={<CreditCard />} label="Membresía"
          value={<span className="stat-value--text">{vigente ? plans.get(vigente.planId)?.name ?? 'Plan' : paseDeHoy ? 'Pase del día' : paquete ? 'Paquete de visitas' : 'Sin plan'}</span>}
          // Ficha de estado único (UX7 Mostrador 3): el estado lo dice la insignia de la
          // cabecera; aquí solo lo que ella no dice.
          note={vigente
            ? renovacion(vigente)
            : paseDeHoy ? `Vale hoy en ${branchName(paseDeHoy.branchId)}${(pasesCarga.datos?.total ?? 0) > 1 ? ` · lleva ${pasesCarga.datos!.total} pases` : ''}`
            : paquete
              // El paquete se ve en la ficha (UXA-03): antes decía "Sin plan" y ofrecía vender una mensualidad.
              ? (paquete.status === 'PENDING_PAYMENT' ? 'Sin pagar: no da acceso' : `${paquete.visitsLeft} ${paquete.visitsLeft === 1 ? 'visita' : 'visitas'}${paquete.expiresOn ? ` · caduca ${fecha(paquete.expiresOn)}` : ''}`)
              : membresiasCarga.error ? 'No se pudo consultar' : memberships === null ? '…'
                : (pasesCarga.datos?.total ?? 0) > 0 ? `No tiene membresía · ${pasesCarga.datos!.total === 1 ? '1 pase del día' : `${pasesCarga.datos!.total} pases del día`}` : 'No tiene membresía'}
        />
        <Stat
          icon={<CalendarDays />} label={esVigencia ? 'Vigente hasta' : 'Pagado hasta'}
          // «Pagado hasta» es lo PAGADO, no el fin del periodo (3-01, 4-03): a
          // quien debe este mes ya no se le dice que pagó hasta su fin.
          value={<span className="stat-value--text">{!vigente ? '—'
            : esVigencia ? (vigente.coveredThrough ? fecha(vigente.coveredThrough) : '—')
              : vigente.paidThrough ? fecha(vigente.paidThrough) : 'Sin pagos'}</span>}
          // Una cancelada no "se renueva sola" (UX4-15): dice hasta cuándo le queda.
          note={vigente?.status === 'SUSPENDED' ? (verDinero && neto > 0n ? `Debe ${pesos(neto)} para volver a entrar` : 'Sin acceso hasta regularizar')
            : vigente?.status === 'CANCELED' ? 'Cancelada: no se renueva'
            : vigente?.status === 'EXPIRED' ? 'Venció: no se renueva'
            : vigente?.status === 'PENDING' ? 'Venta sin cobrar: no da acceso'
            : vigente?.status === 'FROZEN' && vigente.frozenUntil ? `Congelada hasta ${fecha(vigente.frozenUntil)}`
            : vigente?.graceUntil ? `Gracia hasta ${fecha(vigente.graceUntil)}`
            : cuotaAbierta && vigente?.coveredThrough ? `${textoCuota} · su periodo va al ${fecha(vigente.coveredThrough)}` : ' '}
        />
        {verDinero && (
          <Stat
            icon={<Wallet />} label="Saldo" danger={saldo > 0n}
            value={neto > 0n ? pesos(neto) : 'Al corriente'}
            // El saldo a favor se ve también cuando debe: se aplica al cobrar (4-18).
            note={neto > 0n ? (credito > 0n ? `Por cobrar · ya descuenta ${pesos(credito)} a favor` : 'Por cobrar')
              : saldo > 0n ? `Su saldo a favor cubre lo que debe (${pesos(saldo)})`
                : credito > 0n ? `A favor ${pesos(credito)}` : 'Sin adeudos'}
          />
        )}
        {/* Sin permiso de consentimientos no hay datos de biometría: se quedaba en "…" para siempre (UXA-16). */}
        {can('members:consent:read') && activo('biometrics') && (
          <Stat
            icon={<ScanFace />} label="Identificación"
            value={<span className="stat-value--text">{bioCarga.error ? 'Sin dato' : bio === null ? '…' : bioVivos.length === 0 ? 'Mostrador' : bioVivos.map((e) => e.modality === 'FACE' ? 'Rostro' : 'Huella').filter((v, i, a) => a.indexOf(v) === i).join(' + ')}</span>}
            note={bioCarga.error ? <>No se pudo consultar. <button type="button" className="row-link" onClick={() => void bioCarga.recargar()}>Reintentar</button></>
              : bio === null ? ' ' : bioVivos.length === 0 ? 'Sin biometría: entra por recepción'
                : `${((n) => (n === 1 ? '1 sucursal' : `${n} sucursales`))(new Set(bioVivos.map((e) => e.branchId)).size)}${porRenovar ? ' · debe volver a firmar' : ''}`}
          />
        )}
      </div>

      <Tabs value={tab} onChange={cambiarTab} tabs={tabs} />

      {/* Para terminar su alta (9-01, 2.4): solo mientras falte algo y la ficha sea reciente; lo decide el servidor (`show`). */}
      {tab === 'resumen' && can('members:create') && (
        <FranjaDelAlta memberId={m.id} version={membresiasCarga.datos}
          // Cada paso se hace aquí mismo (2.12): un enlace a esta misma ficha no abría nada.
          alPulsar={(paso) => (paso === 'SELL' ? (can('memberships:create') ? () => setVender(true) : null)
            : paso === 'COLLECT' ? (can('payments:record') && st ? () => setCobrar(true) : can('billing:statement:read') ? () => cambiarTab('cuenta') : null)
              : paso === 'PORTAL' ? (puedePortal ? () => setPortal(true) : null)
                : paso === 'FACE' ? 'enlace'
                  : can('members:update') ? () => setEditar(true) : null)} />
      )}
      {tab === 'resumen' && (
        <div className="grid grid-2">
          <Card title="Datos de contacto">
            <dl className="kv">
              <dt>Teléfono</dt><dd>{m.phoneE164 || veContacto ? telefono(m.phoneE164) : oculto}</dd>
              <dt>Correo</dt><dd>{m.email ?? (veContacto ? '—' : oculto)}</dd>
              <dt>Nacimiento</dt><dd>{fecha(m.birthDate)}</dd>
              <dt>Sucursal de casa</dt><dd>{branchName(m.homeBranchId)}</dd>
              <dt>Socio desde</dt><dd>{fecha(m.joinedAt)}</dd>
              {(can('members:create') || can('training:assign')) && <><dt>Coach</dt><dd><CoachDelSocio memberId={m.id} coachUserId={m.coachUserId ?? null} homeBranchId={m.homeBranchId} onCambio={(c) => setM({ ...m, coachUserId: c })} /></dd></>}
            </dl>
            {/* Bloque 3.4 (D-09, D-11): «Comparte celular con…», quién responde por el número y «Completar datos» (solo lo vacío). */}
            {veContacto && !m.anonymizedAt && m.status !== 'ARCHIVED' && <CelularCompartido memberId={m.id} nombre={m.firstName} puedeEditar={can('members:update')} puedeCompletar={can('members:create')} onCambio={() => void recargarSocio()}
              vacios={{ phoneE164: !m.phoneE164, email: !m.email, birthDate: !m.birthDate, emergencyContactName: !m.emergencyContactName, emergencyContactPhone: !m.emergencyContactPhone }} />}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }} className="stack-sm">
              <p className="label row gap-6"><LifeBuoy size={14} />En caso de emergencia</p>
              <p className="small">{m.emergencyContactName
                ? <>{m.emergencyContactName}{m.emergencyContactPhone ? <span className="muted"> · {telefono(m.emergencyContactPhone)}</span> : null}</>
                : veContacto ? <span className="muted">Sin contacto registrado</span> : oculto}</p>
            </div>
            {/* Solo con permiso de salud: la API no se la da a nadie más. Sin respuesta no es «sin notas». */}
            {verSalud && (saludCarga.error || saludCarga.datos !== undefined) && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }} className="stack-sm">
                <p className="label row gap-6"><HeartPulse size={14} />Salud</p>
                {saludCarga.error
                  ? <ErrorCarga titulo="No se pudieron consultar sus notas de salud" mensaje={saludCarga.error} onReintentar={() => void saludCarga.recargar()} />
                  : <p className="small">{saludCarga.datos ?? <span className="muted">Sin notas (o no dio consentimiento para guardarlas)</span>}</p>}
              </div>
            )}
          </Card>
          <Card title="Membresía" sub={vigente ? plans.get(vigente.planId)?.name : undefined}>
            {membresiasCarga.error && <ErrorCarga titulo="No se pudo cargar su membresía" mensaje={membresiasCarga.error} onReintentar={() => void membresiasCarga.recargar()} />}
            {memberships === null && !membresiasCarga.error && <Skeleton h={120} />}
            {memberships?.length === 0 && (
              <Empty icon={<CreditCard />} title="Sin membresía" text="Todavía no tiene plan."
                action={can('memberships:create') && <Button size="sm" icon={<ShoppingBag />} onClick={() => setVender(true)}>Vender membresía</Button>} />
            )}
            {vigente && (
              <dl className="kv">
                <dt>Periodo actual</dt><dd>{fecha(vigente.currentPeriodStart)} al {fecha(vigente.coveredThrough)}</dd>
                {/* Lo pagado, aparte del periodo: pueden no coincidir (3-01). */}
                {vigente.paidThrough !== undefined && <><dt>Pagado hasta</dt><dd>{vigente.paidThrough ? fecha(vigente.paidThrough) : 'Sin pagos'}</dd></>}
                <dt>Renovación</dt><dd>{renovacion(vigente)}</dd>
                {/* Lo que paga por periodo y la marca «conserva su precio» (D-19; bloque 3.5, edición puntual). */}
                {vigente.periodPriceCents !== undefined && (
                  <><dt>Paga por periodo</dt>
                    <dd data-testid="paga-por-periodo">{pesos(vigente.periodPriceCents)}
                      {vigente.priceProtected && <> · <Badge tone="info">Conserva su precio</Badge>
                        {vigente.priceProtectedReason && <span className="tiny muted"> {vigente.priceProtectedReason}</span>}</>}
                    </dd></>
                )}
                {vigente.status === 'FROZEN' && vigente.frozenUntil && <><dt>Congelada hasta</dt><dd>{fecha(vigente.frozenUntil)}</dd></>}
              </dl>
            )}
            {sinRenovar && (
              <div className="mt-12">
                <Callout tone="warn" title="No se pudo renovar">
                  Su periodo terminó el {fecha(vigente!.coveredThrough)} y la cuota del siguiente no se emitió, así que la membresía no avanzó.
                  Casi siempre es que su plan ya no tiene precio en su sucursal: corrígelo en Planes o cámbiale el plan. Queda en la bitácora.
                </Callout>
              </div>
            )}
            {vigente && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <AccionesMembresia membresia={vigente} plan={plans.get(vigente.planId) ?? null} memberName={m.firstName}
                  onDone={() => void recargarCuenta()}
                  deudaCents={deudaVigente.toString()}
                  onCobrar={can('payments:record') && st ? () => setCobrar(true) : undefined} />
              </div>
            )}
          </Card>
          {/* La tarjeta «Clases» (bloque 2.5): lo que viene, lo reciente y su bloqueo por faltas. No pinta nada si quien mira no ve clases. */}
          <ClasesSocioCard memberId={m.id} nombre={m.firstName} homeBranchId={m.homeBranchId} archivado={m.status === 'ARCHIVED'} version={cambios} onDinero={() => void recargarCuenta()} />
          <div style={{ gridColumn: '1 / -1' }}>
            <PrivacidadCard socio={m} onDone={() => { setCambios((n) => n + 1); void recargarSocio(); void membresiasCarga.recargar(); }} />
          </div>
        </div>
      )}

      {tab === 'historia' && <HistoriaSocio memberId={m.id} version={cambios} />}
      {tab === 'accesos' && <AccesosSocio memberId={m.id} />}
      {tab === 'rutina' && <RutinaSocioTab memberId={m.id} nombre={m.firstName} nombreCompleto={nombre} />}
      {tab === 'bitacora' && can('audit:read') && <BitacoraSocio memberId={m.id} />}

      {tab === 'biometria' && (
        <BiometriaTab memberId={m.id} memberName={m.firstName} homeBranchId={m.homeBranchId} onLoaded={alCambiarBiometria}
          porRenovar={porRenovar} onFirmado={() => void consentsCarga.recargar()} />
      )}

      {tab === 'consentimientos' && (
        <div className="stack">
        <Card pad={false} title="Consentimientos" sub="Cada firma guarda la versión exacta del texto, la hora y el canal. Lo opcional se puede retirar; lo obligatorio, solo con la baja.">
          {consentsCarga.error ? <div className="card-body"><ErrorCarga titulo="No se pudieron cargar sus consentimientos" mensaje={consentsCarga.error} onReintentar={() => void consentsCarga.recargar()} /></div>
            : consents === null ? <div className="card-body"><Skeleton h={100} /></div>
            : consents.length === 0 ? <Empty icon={<FileSignature />} title="Sin consentimientos" text="Se registran en el alta digital y al enrolar biometría." />
              : (
                <div className="table-wrap">
                  <table className="table table-stack">
                    <thead><tr><th>Documento</th><th>Versión</th><th>Canal</th><th>Fecha</th><th>Estado</th><th /></tr></thead>
                    <tbody>
                      {consents.map((c) => (
                        <tr key={c.id}>
                          <td className="strong">
                            {CONSENT_TYPE[c.consentType] ?? c.consentType}
                            {/* En el teléfono la versión y el canal no se esconden: son lo que distingue una firma de otra (21-22). */}
                            <div className="tiny muted stack-only">versión {c.documentVersion}{c.channel ? ` · ${CONSENT_CHANNEL[c.channel] ?? c.channel}` : ''}</div>
                          </td>
                          <td className="stack-hide"><code>{c.documentVersion}</code></td>
                          <td className="muted stack-hide">{c.channel ? CONSENT_CHANNEL[c.channel] ?? c.channel : '—'}</td>
                          <td className="muted">{fechaHora(c.grantedAt)}</td>
                          <td>
                            {c.revokedAt ? <Badge>Retirado {fecha(c.revokedAt)}</Badge>
                              : c.needsResign ? <Badge tone="warn" dot>Debe volver a firmar</Badge>
                                : c.granted ? <Badge tone="ok" dot>Aceptado</Badge> : <Badge tone="danger" dot>Rechazado</Badge>}
                            {c.needsResign && c.currentVersion && <div className="tiny muted mt-2">La vigente es la {c.currentVersion}</div>}
                          </td>
                          <td className="right">
                            {/* El texto exacto que firmó, para enseñárselo en el mostrador (3-21). */}
                            <Button size="sm" variant="ghost" onClick={() => setLeerFirma(c)}>Leer</Button>
                            {/* Retirar (PS-07): lo opcional y la biometría (revoca su rostro); el aviso y el reglamento se van con la baja. */}
                            {can('members:update') && c.granted && !c.revokedAt && (REVOCABLES_EN_RECEPCION as readonly string[]).includes(c.consentType)
                              && <Button size="sm" variant="ghost" onClick={() => setRetirar(c)}>Retirar</Button>}
                            {/* El texto biométrico cambió: se firma el vigente sin volver a capturar (6-03, 21-09). */}
                            {c.needsResign && can('access:biometric:enroll') && activo('biometrics')
                              && <Button size="sm" variant="secondary" icon={<FileSignature />} onClick={() => setVolverAFirmar(true)}>Firmar la vigente</Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </Card>
        <SolicitudesArco memberId={m.id} />
        {retirar && <RetirarConsentimientoDialog memberId={m.id} consentId={retirar.id} consentType={retirar.consentType} nombre={CONSENT_TYPE[retirar.consentType] ?? retirar.consentType}
          onClose={() => setRetirar(null)} onHecho={() => { setRetirar(null); void consentsCarga.recargar(); void bioCarga.recargar(); }} />}
        {leerFirma && <LeerFirmaDialog memberId={m.id} consentId={leerFirma.id} onClose={() => setLeerFirma(null)} />}
        {volverAFirmar && <FirmarTextoVigenteDialog memberId={m.id} memberName={m.firstName}
          onClose={() => setVolverAFirmar(false)} onDone={() => { setVolverAFirmar(false); void consentsCarga.recargar(); }} />}
        </div>
      )}

      {tab === 'cuenta' && (
        <div className="stack">
          {st && neto > 0n && (
            <div className="callout callout-warn items-center">
              <Wallet />
              <div className="flex-1">
                <p className="callout-title">Debe {pesos(neto)}</p>
                {/* Desde cuándo y cuántos: es lo que recepción dice en voz alta. */}
                {abiertos.length > 0 && masViejo ? `${abiertos.length === 1 ? 'Un cargo' : `${abiertos.length} cargos`}${masViejo < hoyNegocio ? `, ${abiertos.length === 1 ? 'vencido' : 'el más antiguo vencido'} desde el ${fecha(masViejo)}` : `, vence el ${fecha(masViejo)}`}. ` : ''}
                {credito > 0n ? `Ya descuenta ${pesos(credito)} que tiene a favor, que se aplica primero. ` : ''}El pago se aplica al cargo más antiguo; si liquida la cuota, la membresía se activa.
              </div>
              {can('payments:record') && <Button size="sm" onClick={() => setCobrar(true)}>Cobrar</Button>}
            </div>
          )}
          {cuentaCarga.error && <ErrorCarga titulo="No se pudo cargar su estado de cuenta" mensaje={cuentaCarga.error} onReintentar={() => void cuentaCarga.recargar()} />}
          {/* Por páginas, con quién cobró, qué cubrió y cómo quedó saldado cada cargo (bloque 1.6). */}
          {!cuentaCarga.error && <EstadoDeCuenta memberId={m.id} st={st} branchId={m.homeBranchId} onCambio={() => void recargarCuenta()} />}
          {/* Lo que compró en la tienda (8-01): el punto de venta dice «queda en su ficha», y es aquí. */}
          {activo('pos') && <ComprasSocio memberId={m.id} />}
        </div>
      )}
      {entrada && (
        <EntradaDialog memberId={m.id} memberName={m.firstName} onClose={() => setEntrada(false)}
          onDone={() => { setEntrada(false); void recargarCuenta(); }} />
      )}
      {editar && (
        <EditarSocioDialog socio={m} onClose={() => setEditar(false)}
          onGuardado={() => { setEditar(false); void recargarCuenta(); }} />
      )}
      {vender && (
        <VenderDialog memberId={m.id} memberName={m.firstName} homeBranchId={m.homeBranchId}
          onClose={() => setVender(false)}
          onDone={() => { setVender(false); setVentas((n) => n + 1); void recargarCuenta(); void pasesCarga.recargar(); }} />
      )}
      {cobrar && st && (
        <CobrarDialog memberId={m.id} memberName={m.firstName} branchIds={sedesDeCobro(st, m.homeBranchId)} saldoCents={neto.toString()}
          onClose={() => setCobrar(false)}
          onDone={() => { setCobrar(false); void recargarCuenta(); }} />
      )}
    </>
  );
}

/** `version`: cambia cuando la ficha recarga sus membresías (una venta, un cobro); los pasos se vuelven a pedir. */
function FranjaDelAlta({ memberId, version, alPulsar }: { memberId: string; version: unknown; alPulsar: Parameters<typeof PasosDelAlta>[0]['alPulsar'] }) {
  const carga = useOnboarding(memberId);
  const recargar = carga.recargar;
  useEffect(() => { if (version !== undefined) void recargar(); }, [version, recargar]);
  if (!carga.datos?.show) return null;
  return (
    <div className="mb-24">
      <Card title="Para terminar su alta" sub="Lo que le falta para quedar listo. Desaparece cuando todo está hecho.">
        <PasosDelAlta carga={carga} alPulsar={alPulsar} />
      </Card>
    </div>
  );
}
