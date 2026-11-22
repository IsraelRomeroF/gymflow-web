'use client';

import Link from 'next/link';
import { Check, Plus, TriangleAlert } from 'lucide-react';
import { fecha, hace, pesos } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { IconTile } from '@/components/compartido';
import type { Marca } from './tipos';

/** Un pendiente de la bandeja "Requiere atención" (UX7 Plataforma): qué pasa y a dónde ir a resolverlo. */
type Aviso = { clave: string; marcaId: string | null; marca: string; texto: string; tono: 'danger' | 'warn'; accion: string; href: string };
const HORA = 3_600_000;

/**
 * Una marca en uso que nadie usa (22-06). Se mide con la actividad de SU
 * gente: lo que hace la plataforma (facturarle, darle una cuenta) ya no la
 * «revive». Recién liberada tiene 48 horas antes de que se avise.
 */
function quieta(m: Marca, ahora: number): string | null {
  if (m.serviceStatus !== 'ACTIVE') return null;
  const desde = (iso: string | null) => (iso ? ahora - new Date(iso).getTime() : Infinity);
  if (desde(m.lastActivityAt) <= 48 * HORA || desde(m.activatedAt ?? m.createdAt) <= 48 * HORA) return null;
  if (!m.lastStaffLoginAt) return 'Nadie de su personal ha entrado al panel todavía';
  if (!m.lastActivityAt) return `Su personal entró ${hace(m.lastStaffLoginAt)} y todavía no registra nada`;
  return `Sin actividad de su personal ${hace(m.lastActivityAt)}`;
}

/** Todo lo que una marca necesita hoy, en orden de gravedad. */
export function avisosDe(m: Marca, ahora = Date.now()): Aviso[] {
  const a: Aviso[] = [];
  const ficha = `/plataforma/${m.id}`;
  const base = { marcaId: m.id, marca: m.tradeName };
  const c = m.lastDailyRun;
  if (c?.chain === 'broken') a.push({ ...base, clave: `${m.id}-cadena`, tono: 'danger', texto: 'La bitácora no cuadra: alguien alteró un registro', accion: 'Ver soporte', href: `${ficha}#soporte` });
  if (c && c.failed.length > 0) a.push({ ...base, clave: `${m.id}-cierre`, tono: 'danger', texto: `El cierre diario falló en ${c.failed.length === 1 ? c.failed[0] : `${c.failed.length} tareas`}`, accion: 'Ver soporte', href: `${ficha}#soporte` });
  if (m.serviceStatus === 'ACTIVE' && (!c || ahora - new Date(c.at).getTime() > 36 * HORA)) a.push({ ...base, clave: `${m.id}-sincierre`, tono: 'warn', texto: c ? `El cierre diario no corre desde ${hace(c.at)}` : 'El cierre diario nunca ha corrido', accion: 'Ver soporte', href: `${ficha}#soporte` });
  // El estado de cobro lo dice el servidor, el mismo de la ficha (23-02): la bandeja ya no lo deriva.
  if (m.billing.status === 'VENCIDA') a.push({ ...base, clave: `${m.id}-vencida`, tono: 'danger', texto: `Factura vencida hace ${m.billing.overdueDays} ${m.billing.overdueDays === 1 ? 'día' : 'días'} · ${pesos(m.billing.pendingCents)}`, accion: 'Ver cobranza', href: '/plataforma/cobranza' });
  if (m.billing.status === 'SIN_FACTURA_DEL_MES') a.push({ ...base, clave: `${m.id}-sin-factura`, tono: 'warn', texto: 'En uso y sin la factura de este mes', accion: 'Emitir en Cobranza', href: '/plataforma/cobranza' });
  if (m.billing.status === 'NO_FACTURABLE') a.push({ ...base, clave: `${m.id}-sin-precio`, tono: 'warn', texto: 'No se le puede facturar: algo de lo que tiene contratado no tiene precio', accion: 'Ver su cobro', href: ficha });
  if (m.serviceStatus === 'SUSPENDED') a.push({ ...base, clave: `${m.id}-susp`, tono: 'warn', texto: `Suspendida${m.suspendedAt ? ` desde ${fecha(m.suspendedAt)}` : ''}`, accion: 'Ver marca', href: ficha });
  if (m.serviceStatus === 'PENDING' && ahora - new Date(m.createdAt).getTime() > 7 * 24 * HORA) a.push({ ...base, clave: `${m.id}-pend`, tono: 'warn', texto: `Sin liberar desde hace ${hace(m.createdAt).replace(/^hace /, '')}`, accion: 'Liberar', href: ficha });
  const sinUso = quieta(m, ahora);
  if (sinUso) a.push({ ...base, clave: `${m.id}-quieta`, tono: 'warn', texto: sinUso, accion: 'Ver marca', href: ficha });
  return a;
}
export const requiereAtencion = (m: Marca): boolean => avisosDe(m).length > 0;

/**
 * BANDEJA "REQUIERE ATENCIÓN" (UX7 Plataforma): lo que hoy estaba repartido
 * marca por marca —bitácora rota, cierre fallido, factura vencida, sin
 * liberar, sin precios, sin actividad— en una lista, cada renglón con su
 * acción. Cuántos precios faltan lo dice la misma respuesta de la lista (22-15).
 */
export function Bandeja({ marcas, sinPrecio }: { marcas: Marca[]; sinPrecio: number }) {
  const avisos: Aviso[] = [
    ...(sinPrecio > 0 ? [{ clave: 'precios', marcaId: null, marca: 'Toda la plataforma', tono: 'warn' as const, texto: `${sinPrecio === 1 ? 'Falta un precio' : `Faltan ${sinPrecio} precios`}: sin ellos no se puede facturar`, accion: 'Fijar precios', href: '/plataforma/precios' }] : []),
    ...marcas.flatMap((m) => avisosDe(m)),
  ].sort((a, b) => (a.tono === b.tono ? 0 : a.tono === 'danger' ? -1 : 1));
  return (
    <Card pad={false} title={<span className="row gap-8">Requiere atención {avisos.length > 0 && <Badge tone={avisos.some((x) => x.tono === 'danger') ? 'danger' : 'warn'}>{avisos.length}</Badge>}</span>}
      data-testid="bandeja-plataforma" className="bandeja-plataforma">
      {avisos.length === 0 ? (
        <div className="list-item"><IconTile tone="ok"><Check /></IconTile><p className="small">Nada pendiente: cierres al día, bitácoras íntegras y cobros al corriente.</p></div>
      ) : (
        <ul className="list">
          {avisos.slice(0, 8).map((x) => (
            <li key={x.clave} className="list-item" data-aviso={x.clave}>
              <IconTile tone={x.tono} size="sm"><TriangleAlert /></IconTile>
              <div className="flex-1 min-w-0">
                <p className="small strong">{x.marca}</p>
                <p className="small muted">{x.texto}</p>
              </div>
              <Link href={x.href} className="btn btn-secondary btn-sm">{x.accion}</Link>
            </li>
          ))}
          {avisos.length > 8 && <li className="list-item small muted">Y {avisos.length - 8} más: usa el filtro "Requieren atención" de abajo.</li>}
        </ul>
      )}
    </Card>
  );
}

/**
 * PRIMER USO DE LA CONSOLA: en orden, lo que deja lista la plataforma para
 * su primer gimnasio. Fijar precios va primero: sin ellos la marca no se puede
 * facturar.
 */
export function PrimerosPasos({ sinPrecio, onNueva }: { sinPrecio: number; onNueva: () => void }) {
  return (
    <Card title="Primeros pasos" sub="Así queda lista la plataforma para tu primer gimnasio." data-testid="primeros-pasos">
      <ol className="primeros-pasos">
        <li data-hecho={sinPrecio === 0 || undefined}>
          <div className="flex-1"><p className="strong">Fija tus precios</p><p className="small muted">{sinPrecio === 0 ? 'Listo: lo básico y cada módulo tienen precio.' : 'Lo que cobras al mes por lo básico y por cada módulo. Sin precios no se puede facturar.'}</p></div>
          <Link href="/plataforma/precios" className="btn btn-secondary btn-sm">{sinPrecio === 0 ? 'Revisar' : 'Fijar precios'}</Link>
        </li>
        <li>
          <div className="flex-1"><p className="strong">Da de alta la primera marca</p><p className="small muted">En tres pasos: la marca y su primera sucursal, lo que contrató, y las cuentas del dueño y su equipo.</p></div>
          <Button size="sm" icon={<Plus />} onClick={onNueva}>Nueva marca</Button>
        </li>
        <li>
          <div className="flex-1"><p className="strong">Libérala y entrega los accesos</p><p className="small muted">La marca nace sin liberar, salvo que marques «Liberar el software al terminar»: nadie entra hasta que esté en uso. Las contraseñas temporales se ven una sola vez y cada una va a su dueño.</p></div>
        </li>
      </ol>
    </Card>
  );
}
