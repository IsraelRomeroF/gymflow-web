'use client';

import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';
import { ArrowRight, Banknote, CalendarCheck, DoorOpen, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha, hace, pesos, telefono } from '@gymflow/ui/format';
import { useCarga } from '@gymflow/ui/carga';
import { AccesoBadge, useResumenAcceso, type ResumenAcceso } from '@/components/acceso';
import { useSession } from '@/components/session';
import { Avatar, Button } from '@/components/ui';
import { EntradaDialog } from '@/components/entrada';
import { InscribirClaseDialog } from '@/components/inscribir-clase';
import { CobrarDialog, VenderDialog } from '@/components/venta';
import type { SocioHallado } from '@/lib/buscar-socios';

/** Lo que la tarjeta necesita del socio: lo trae cualquier búsqueda (`MemberSummary`). */
export type SocioDeTarjeta = Pick<SocioHallado, 'id' | 'firstName' | 'lastName' | 'memberCode' | 'phoneE164' | 'homeBranchId' | 'status' | 'balanceCents'>;

const VIGENTE = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE', 'FROZEN', 'SUSPENDED', 'PENDING']);

/**
 * La línea de dinero (una verdad por socio, 3-01): hasta dónde pagó y cuánto
 * debe, en una frase. La insignia ya dice si entra; esto dice por qué.
 */
function lineaDeDinero(s: SocioDeTarjeta, r: ResumenAcceso | undefined): { texto: string; debe: string | null } {
  const partes: string[] = [];
  const m = r?.membership;
  if (m) {
    partes.push(m.planName ?? 'Membresía');
    if (m.paidThrough) partes.push(`pagada hasta ${fecha(m.paidThrough)}`);
  } else if (r?.dayPass) partes.push('Pase del día');
  else if (r?.pack) partes.push('Paquete de visitas');
  else if (r) partes.push('Sin plan');
  const saldo = s.balanceCents === null ? null : BigInt(s.balanceCents);
  if (saldo !== null && saldo < 0n) partes.push(`${pesos(-saldo)} a favor`);
  // «No debe nada» solo cuando la insignia no está pidiendo un pago: dos verdades distintas confunden (3-01).
  const lePidePago = !!m && (m.status === 'PAST_DUE' || m.status === 'SUSPENDED');
  if (saldo !== null && saldo === 0n && r && !lePidePago) partes.push('no debe nada');
  return { texto: partes.join(' · '), debe: saldo !== null && saldo > 0n ? pesos(saldo) : null };
}

/**
 * LA TARJETA DEL SOCIO (auditoría 8, bloque 2.1; 2-08, A1-T2, DA-07).
 *
 * Con el socio delante, todo lo que se le hace en el mostrador está aquí:
 * Entrada · Cobrar $X · Vender · Clase, y la ficha para lo demás. Antes era
 * buscar → ficha → cobrar → cerrar → volver a buscar → entrada. La misma
 * tarjeta sale en `/socios`, en el inicio de recepción, en Caja («¿A quién le
 * cobras?») y en Ctrl K: una sola manera de atender.
 *
 * No decide nada: cada botón abre la pieza que ya existía (`EntradaDialog`,
 * `CobrarDialog`, `VenderDialog`, `InscribirClaseDialog`) y solo aparece si el
 * puesto de quien mira lo permite. El primario es lo que toca: la entrada si
 * puede pasar; si no, el cobro; si no tiene plan, la venta.
 */
export function TarjetaSocio({ socio, resumen: resumenDado, enEspera = false, sedeDeCobro, onCambio, onEntrada, onIrAFicha }: {
  socio: SocioDeTarjeta;
  /** El resumen de acceso, si quien la pinta ya lo pidió para su lista; si no, la tarjeta lo pide. */
  resumen?: ResumenAcceso | undefined;
  /** La lista de donde salió está en espera (5-01): nada se registra sobre ella. */
  enEspera?: boolean;
  /** La sucursal de la caja desde donde se cobra (Caja); va primero al cobrar. */
  sedeDeCobro?: string;
  /** Cambió su dinero o su plan: quien la pinta vuelve a pedir lo suyo. */
  onCambio?: () => void;
  /** Se registró su entrada (o se resolvió su rechazo): el mostrador queda listo para el siguiente. */
  onEntrada?: () => void;
  /** Se va a su ficha: quien la pinta se cierra (Ctrl K). */
  onIrAFicha?: () => void;
}) {
  const { can, activo, branchName, inScope, branches } = useSession();
  const [abierto, setAbierto] = useState<'entrada' | 'cobrar' | 'vender' | 'clase' | null>(null);
  const [version, setVersion] = useState(0);
  // Si nadie le dio el resumen, lo pide; tras un cobro o una venta lo vuelve a pedir en cualquier caso.
  const propio = useResumenAcceso(resumenDado && version === 0 ? [] : [socio.id], String(version));
  const resumen = propio.get(socio.id) ?? resumenDado;
  const archivado = socio.status === 'ARCHIVED';
  const verDinero = can('billing:statement:read');
  // Tras un cobro o una venta, su saldo se vuelve a pedir aquí: quien pinta la tarjeta puede tener el de antes (Ctrl K).
  const cargarSaldo = useCallback(async () => {
    const m = await api<{ balanceCents: string | null }>(`/members/${socio.id}`);
    // `version` va en la respuesta para que cada cambio vuelva a pedirlo.
    return { balanceCents: m.balanceCents, version };
  }, [socio.id, version]);
  const alDia = useCarga(version > 0 ? cargarSaldo : null, { conservar: true });
  const balanceCents = alDia.datos ? alDia.datos.balanceCents : socio.balanceCents;
  const dinero = lineaDeDinero({ ...socio, balanceCents }, resumen);

  // Última visita: una petición ligera, solo para quien ve la asistencia.
  const verVisitas = can('access:attendance:read');
  const cargarVisita = useCallback(
    () => api<{ decisions: Array<{ at: string }> }>(`/access/decisions?memberId=${socio.id}&outcome=GRANTED&limit=1`),
    [socio.id],
  );
  const visita = useCarga(verVisitas && !archivado ? cargarVisita : null);
  const ultima = visita.datos?.decisions[0]?.at ?? null;

  const saldo = balanceCents === null ? 0n : BigInt(balanceCents);
  const puedeEntrada = can('access:monitor') && !archivado;
  const puedeCobrar = can('payments:record') && saldo > 0n && !archivado;
  const conPlan = !!resumen?.membership && VIGENTE.has(resumen.membership.status);
  const puedeVender = can('memberships:create') && !archivado && !!resumen && !conPlan;
  const puedeClase = can('classes:book_for_member') && activo('classes') && !archivado;
  // Un primario (regla de acabado): lo que toca con este socio.
  const primario: 'entrada' | 'cobrar' | 'vender' | null = puedeEntrada && (resumen?.canEnter ?? true) ? 'entrada'
    : puedeCobrar ? 'cobrar' : puedeVender ? 'vender' : puedeEntrada ? 'entrada' : null;
  const variante = (a: 'entrada' | 'cobrar' | 'vender') => (primario === a ? 'primary' as const : 'secondary' as const);

  // Dónde se le cobra: la caja desde donde se atiende, su sucursal de casa y, si ninguna es de quien cobra, las suyas.
  const preferidas = [...new Set([sedeDeCobro, socio.homeBranchId].filter((b): b is string => !!b && inScope(b)))];
  const sedesDeCobro = preferidas.length > 0 ? preferidas : branches.filter((b) => b.isActive && inScope(b.id)).map((b) => b.id);
  const deOtraSede = !!socio.homeBranchId && !inScope(socio.homeBranchId);
  const cambio = () => { setVersion((v) => v + 1); onCambio?.(); };

  return (
    <section className="tarjeta-socio" data-testid="tarjeta-socio" data-socio={socio.memberCode} aria-label={`${socio.firstName} ${socio.lastName}`}>
      <div className="tarjeta-socio-cabeza">
        <Avatar name={`${socio.firstName} ${socio.lastName}`} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="tarjeta-socio-nombre">{socio.firstName} {socio.lastName}</h2>
          <p className="tiny muted"><code>{socio.memberCode}</code>{socio.phoneE164 ? ` · ${telefono(socio.phoneE164)}` : ''}</p>
          <p className="tiny muted">{deOtraSede ? `De otra sucursal: ${branchName(socio.homeBranchId)}` : branchName(socio.homeBranchId)}</p>
        </div>
      </div>

      <div className="tarjeta-socio-estado">
        <AccesoBadge resumen={resumen} archivado={archivado} />
        {verDinero && !archivado && (dinero.texto || dinero.debe) && (
          <p className="small muted" data-testid="tarjeta-dinero">
            {dinero.texto}{dinero.texto && dinero.debe ? ' · ' : ''}{dinero.debe && <strong className="text-danger">debe {dinero.debe}</strong>}
          </p>
        )}
        {verVisitas && !archivado && visita.datos && (
          <p className="tiny muted">{ultima ? `Última visita: ${fecha(ultima)} (${hace(ultima)})` : 'Sin visitas registradas'}</p>
        )}
      </div>

      {/* El primario va primero, a todo lo ancho (2.12): lo que toca con este socio se lee y se alcanza antes que lo demás. */}
      <div className="tarjeta-socio-acciones">
        {([
          puedeEntrada && { clave: 'entrada' as const, icono: <DoorOpen />, texto: 'Entrada' },
          puedeCobrar && { clave: 'cobrar' as const, icono: <Banknote />, texto: `Cobrar ${pesos(saldo)}` },
          puedeVender && { clave: 'vender' as const, icono: <ShoppingBag />, texto: 'Vender' },
          puedeClase && { clave: 'clase' as const, icono: <CalendarCheck />, texto: 'Clase' },
        ].filter((a) => !!a) as Array<{ clave: 'entrada' | 'cobrar' | 'vender' | 'clase'; icono: ReactNode; texto: string }>)
          .sort((a, b) => Number(b.clave === primario) - Number(a.clave === primario))
          .map((a) => (
            <Button key={a.clave} variant={a.clave !== 'clase' ? variante(a.clave) : 'secondary'} icon={a.icono} disabled={enEspera} onClick={() => setAbierto(a.clave)}>{a.texto}</Button>
          ))}
      </div>
      <Link href={`/socios/${socio.id}`} className="btn btn-ghost btn-sm tarjeta-socio-ficha" onClick={onIrAFicha}>Ver su ficha<ArrowRight /></Link>
      {archivado && <p className="small muted">Está dado de baja. Desde su ficha la gerencia puede reactivarlo.</p>}
      {can('members:read') && !can('access:monitor') && !puedeCobrar && !puedeVender && !puedeClase && !archivado && (
        <p className="tiny muted">Lo demás está en <Link href={`/socios/${socio.id}`} className="strong" onClick={onIrAFicha}>su ficha</Link>.</p>
      )}

      {abierto === 'entrada' && (
        <EntradaDialog memberId={socio.id} memberName={socio.firstName}
          onClose={() => setAbierto(null)}
          onDone={() => { setAbierto(null); cambio(); onEntrada?.(); }} />
      )}
      {abierto === 'cobrar' && (
        <CobrarDialog memberId={socio.id} memberName={socio.firstName} saldoCents={saldo.toString()} branchIds={sedesDeCobro}
          onClose={() => setAbierto(null)} onDone={() => { setAbierto(null); cambio(); }} />
      )}
      {abierto === 'vender' && (
        <VenderDialog memberId={socio.id} memberName={socio.firstName} homeBranchId={socio.homeBranchId}
          onClose={() => setAbierto(null)} onDone={() => { setAbierto(null); cambio(); }} />
      )}
      {abierto === 'clase' && (
        <InscribirClaseDialog memberId={socio.id} nombre={socio.firstName} homeBranchId={socio.homeBranchId} onClose={() => setAbierto(null)} />
      )}
    </section>
  );
}
