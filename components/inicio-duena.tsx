'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, DoorOpen, FileSignature, Lock, Receipt, RotateCw, ShieldAlert, ShoppingBag, UserPlus, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { fecha as fechaLarga, hora, pesos } from '@/lib/format';
import { errorText, useSession } from './session';
import { Button, ButtonLink, Callout, Cambio, Card, PageHeader, Skeleton } from './ui';
import { AvisosEnTelefono } from './push';
import { AvisosDeLaDuenaTarjeta } from './avisos-duena';
import { AvisoSolicitudesArco } from './cumplimiento';
import { GLOSARIO } from '@/lib/glosario';
import { GlosarioDinero } from './glosario-dinero';
import { hoyEn } from '@/lib/zonas';
import { useCarga } from '@/lib/carga';
import { useCuentaConGymflow } from './cuenta-gymflow';
import type { NoticeSignatureRequests, PrivacyConservation, Pulse as Pulso, RetentionSummary, StoreSummary } from '@gymflow/core/contracts';

/** «Ana», «Ana y Luis», «Ana, Luis y Eva». */
const enFrase = (nombres: string[]) => (nombres.length <= 1 ? nombres[0] ?? '' : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`);

/**
 * CUÁNTOS SE ESTÁN YENDO, sin nombres (15-01, D15-01): la cifra que la dueña
 * pregunta desde el teléfono. Tres estados que no se confunden: llegando, «no
 * se pudo cargar» (con Reintentar) y la cifra, que puede ser cero de verdad.
 * Antes el error se tragaba y la tarjeta desaparecía: no cargó parecía cero.
 */
function SociosEnRiesgo() {
  const carga = useCarga(useCallback(() => api<RetentionSummary>('/retention/summary'), []));
  const c = carga.datos;
  if (carga.error) {
    return (
      <div className="stack-sm mt-8" data-testid="riesgo-duena" data-estado="error" role="alert">
        <p className="small text-warn">No se pudo cargar cuántos socios están en riesgo de irse. No es que no haya: la cifra no llegó.</p>
        <div><Button size="sm" variant="secondary" icon={<RotateCw />} onClick={() => void carga.recargar()}>Reintentar</Button></div>
      </div>
    );
  }
  if (!c) return <div className="mt-8" data-testid="riesgo-duena" data-estado="cargando"><Skeleton h={18} /></div>;
  const medidos = Object.values(c.counts).reduce((a, b) => a + b, 0);
  return (
    <div className="mt-8" data-testid="riesgo-duena" data-estado="listo">
      {medidos === 0 ? (
        <p className="small muted">Todavía no hay socios con membresía activa para medir quién deja de venir.</p>
      ) : c.atRisk === 0 ? (
        <p className="small">Nadie en riesgo de irse: de {medidos.toLocaleString('es-MX')} socios con membresía activa, ninguno ha dejado de venir.</p>
      ) : (
        <>
          <p className="small"><strong className="num" data-testid="riesgo-total">{c.atRisk.toLocaleString('es-MX')}</strong> {c.atRisk === 1 ? 'socio en riesgo de irse' : 'socios en riesgo de irse'}</p>
          <p className="tiny muted">{c.counts.ONBOARDING_AT_RISK} no arrancaron · {c.counts.SLIPPING} aflojando · {c.counts.DORMANT} dejaron de venir</p>
        </>
      )}
    </div>
  );
}

/**
 * LA TIENDA EN CIFRAS (3.7 · D-25): cuánto vendió hoy y en el mes, qué se
 * vende más y qué se está acabando. La dueña lo consulta sin operar el punto
 * de venta ni entrar a Productos. Si no carga, se dice: callar parecería cero.
 */
function TiendaDeLaDuena() {
  const { branchName, branches } = useSession();
  const carga = useCarga(useCallback(() => api<StoreSummary>('/reports/store'), []));
  const t = carga.datos;
  const variasSedes = branches.filter((b) => b.isActive).length > 1;
  return (
    <Card title={<span className="row gap-6"><ShoppingBag size={16} aria-hidden />Tu tienda</span>} data-testid="tienda-duena">
      {carga.error ? (
        <div className="stack-sm" role="alert">
          <p className="small text-warn">No se pudieron cargar las ventas y existencias de la tienda. No es que no haya: la cifra no llegó.</p>
          <div><Button size="sm" variant="secondary" icon={<RotateCw />} onClick={() => void carga.recargar()}>Reintentar</Button></div>
        </div>
      ) : !t ? <Skeleton h={72} /> : t.products.active === 0 ? (
        <p className="small muted">Todavía no hay productos dados de alta en la tienda.</p>
      ) : (
        <>
          <div className="duena-cifra-chica num">{pesos(t.month.totalCents, { decimals: false })} <span className="small muted">este mes</span></div>
          <p className="small muted">
            {t.month.sales.toLocaleString('es-MX')} {t.month.sales === 1 ? 'venta' : 'ventas'} en el mes · hoy {pesos(t.today.totalCents, { decimals: false })} en {t.today.sales}
            {t.month.voided > 0 ? ` · ${t.month.voided} ${t.month.voided === 1 ? 'anulada' : 'anuladas'}` : ''}
          </p>
          {t.top.length > 0 && (
            <>
              <p className="tiny strong mt-8">Lo más vendido del mes</p>
              <ul className="duena-renglones small">
                {t.top.slice(0, 4).map((x) => <li key={x.productId}><span>{x.name} <span className="muted">× {x.quantity}</span></span><span className="num">{pesos(x.totalCents, { decimals: false })}</span></li>)}
              </ul>
            </>
          )}
          <p className="tiny strong mt-8">Existencias{t.products.outOfStock > 0 ? ` · ${t.products.outOfStock} ${t.products.outOfStock === 1 ? 'producto agotado' : 'productos agotados'}` : ''}</p>
          {t.stock.length === 0 ? <p className="small muted">Ningún producto lleva inventario.</p> : (
            <ul className="duena-renglones small">
              {t.stock.slice(0, 6).map((x) => (
                <li key={`${x.productId}-${x.branchId}`}>
                  <span>{x.name}{variasSedes && x.branchId ? <span className="muted"> · {branchName(x.branchId)}</span> : null}</span>
                  <span className={`num${x.stock === 0 ? ' text-danger' : ''}`}>{x.stock === 0 ? 'Agotado' : x.stock.toLocaleString('es-MX')}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="tiny muted mt-8">Lo que menos queda va primero. Vender, surtir y cambiar precios lo hace la gerencia.</p>
        </>
      )}
    </Card>
  );
}

/**
 * EL AVISO DE PRIVACIDAD ESPERA TU FIRMA (3.7 · D-25): no se publica sin ella.
 * Lleva a Textos de consentimiento, donde lo lee completo y lo firma.
 */
function AvisoPorFirmar() {
  const carga = useCarga(useCallback(() => api<NoticeSignatureRequests>('/consent-documents/signature-requests'), []));
  const pendientes = (carga.datos?.requests ?? []).filter((r) => r.status === 'PENDING');
  if (!carga.datos?.canSign || pendientes.length === 0) return null;
  const s = pendientes[0]!;
  return (
    <div data-testid="aviso-por-firmar">
      <Callout tone="warn" title="El aviso de privacidad espera tu firma">
        <p>{s.requestedByName ?? 'La gerencia'} pidió publicar la versión {s.version}: «{s.reason}». No se publica hasta que lo leas y lo firmes.</p>
        <div className="row gap-8 flex-wrap callout-accion">
          <ButtonLink href="/consentimientos" size="sm" icon={<FileSignature />}>Leer y firmar</ButtonLink>
        </div>
      </Callout>
    </div>
  );
}

/**
 * LA LISTA DE EXSOCIOS ESPERA TU FIRMA (3.9 · D-32; renglón de 3.12): una vez
 * al mes se arma la lista de quienes cumplieron el plazo de baja y nada se
 * anonimiza sin su firma. Hasta hoy solo se enteraba al abrir Autorizaciones.
 * Si la consulta falla no se dice nada: la lista sigue en Autorizaciones.
 */
function ListaDeExsociosPorFirmar() {
  const carga = useCarga(useCallback(() => api<PrivacyConservation>('/privacy/conservation'), []));
  const c = carga.datos;
  const n = c?.batch?.counts.listed ?? 0;
  if (!c?.canSign || !c.batch || n === 0) return null;
  return (
    <div data-testid="exsocios-por-firmar">
      <Callout tone="warn" title={n === 1 ? 'Tienes una lista por firmar: un exsocio' : `Tienes una lista por firmar: ${n.toLocaleString('es-MX')} exsocios`}>
        <p>{n === 1 ? 'Lleva' : 'Llevan'} {c.batch.monthsAfterArchive} meses de baja. Con tu firma sus datos personales se borran y quedan solo las cuentas; sin ella no se toca nada.</p>
        <div className="row gap-8 flex-wrap callout-accion">
          <ButtonLink href="/autorizaciones" size="sm" icon={<FileSignature />}>Ver la lista y firmar</ButtonLink>
        </div>
      </Callout>
    </div>
  );
}

/**
 * TU CUENTA CON GYMFLOW (3.11 · D-37; tarjeta de 3.12): lo que el gimnasio le
 * paga a GymFlow, en dos renglones y siempre a la vista, también cuando está al
 * corriente (el aviso de arriba del panel solo sale si hay algo que avisar).
 * Solo consulta. Si no carga no estorba: la pantalla completa está en el menú.
 */
function CuentaConGymflowTarjeta() {
  const { cuenta } = useCuentaConGymflow();
  if (!cuenta?.visible) return null;
  const porPagar = cuenta.invoices.filter((f) => f.state === 'PENDIENTE' || f.state === 'PAGADA_EN_PARTE' || f.state === 'VENCIDA');
  const proxima = [...porPagar].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const vencida = cuenta.status.code === 'VENCIDA';
  const suspendida = cuenta.serviceStatus === 'SUSPENDED';
  return (
    <Card title={<span className="row gap-6"><Receipt size={16} aria-hidden />Tu cuenta con GymFlow</span>} data-testid="cuenta-gymflow-duena" data-cobro={cuenta.status.code}>
      <div className="duena-cifra-chica num">{pesos(cuenta.monthly.totalCents, { decimals: false })} <span className="small muted">al mes</span></div>
      {suspendida ? <p className="small text-danger">El servicio está suspendido hasta que GymFlow registre el pago.</p>
        : vencida ? (
          <p className="small text-danger">
            Debes {pesos(cuenta.status.pendingCents)} · {cuenta.status.overdueDays} {cuenta.status.overdueDays === 1 ? 'día' : 'días'} de atraso
            {cuenta.suspendsOn ? ` · el servicio se suspende el ${fechaLarga(cuenta.suspendsOn)}` : ''}
          </p>
        ) : proxima ? <p className="small muted">Por pagar {pesos(proxima.balanceCents)} · vence el {fechaLarga(proxima.dueDate)}</p>
          : <p className="small muted">Al corriente: no hay facturas por pagar.</p>}
      {cuenta.upcoming && <p className="tiny muted">Desde el {fechaLarga(cuenta.upcoming.effectiveFrom)} la mensualidad será de {pesos(cuenta.upcoming.totalCents, { decimals: false })}.</p>}
      <p className="tiny muted mt-8"><Link href="/cuenta-gymflow">Ver facturas y avisos</Link>. El pago lo registra GymFlow cuando llega.</p>
    </Card>
  );
}

type PersonaDelEquipo = { id: string; fullName: string; isActive: boolean; role: { key: string } | null; sectionsReviewPending?: boolean };

/**
 * GERENTE NUEVO: DECIDE QUÉ VE (17-06, pendiente de 1.14). El gerente nace
 * viendo solo la operación (D17-03) y la llave es de la dueña: si nadie se lo
 * dice aquí, se entera cuando el gerente le pregunta por qué no ve el Tablero.
 * Si la consulta falla también se dice: callar sería «no hay ninguno».
 */
function GerenteNuevo() {
  const carga = useCarga(useCallback(() => api<{ users: PersonaDelEquipo[] }>('/users'), []));
  if (carga.error) {
    return (
      <Callout tone="warn" title="No se pudo revisar si hay un gerente nuevo">
        <p>Si diste de alta a un gerente, falta decidir qué ve. {carga.error}</p>
        <div className="row gap-8 flex-wrap callout-accion">
          <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={() => void carga.recargar()}>Reintentar</Button>
        </div>
      </Callout>
    );
  }
  const nuevos = (carga.datos?.users ?? []).filter((u) => u.isActive && u.role?.key === 'MANAGER' && u.sectionsReviewPending);
  if (nuevos.length === 0) return null;
  const uno = nuevos.length === 1;
  return (
    <div data-testid="gerente-nuevo">
      <Callout tone="warn" title={uno ? 'Gerente nuevo: decide qué ve' : 'Gerentes nuevos: decide qué ven'}>
        <p>{enFrase(nuevos.map((u) => u.fullName))} {uno ? 'entró como gerente y hoy ve' : 'entraron como gerentes y hoy ven'} solo la operación. Tú decides qué {uno ? 've' : 'ven'} de Dirección y Cumplimiento (Tablero, Movimientos, Retención, Personal…).</p>
        <div className="row gap-8 flex-wrap callout-accion">
          <ButtonLink href="/personal" size="sm" icon={<Lock />}>Decidir qué {uno ? 've' : 'ven'}</ButtonLink>
        </div>
      </Callout>
    </div>
  );
}

/**
 * LO QUE LLEVA EL DÍA, ACUMULADO (UX5-D-01): una línea que sube cada vez que
 * entra dinero, contra la del mismo día de la semana pasada (punteada). Se lee
 * de un vistazo si va arriba o abajo; las barras por hora salían casi planas.
 */
function LineaAcumulada({ horas, horaActual }: { horas: Array<{ hour: number; cents: string; lastWeekCents: string }>; horaActual: number }) {
  const DESDE = 6; const HASTA = 23;
  const tramo = horas.filter((h) => h.hour >= DESDE && h.hour < HASTA);
  let a = 0; let b = 0;
  const hoy = tramo.map((h) => (a += Number(h.cents)));
  const pasada = tramo.map((h) => (b += Number(h.lastWeekCents)));
  const max = Math.max(1, ...hoy, ...pasada);
  const W = 320; const H = 64;
  const x = (i: number) => (i / (tramo.length - 1)) * W;
  const y = (v: number) => H - 4 - (v / max) * (H - 8);
  const hasta = Math.max(0, Math.min(tramo.length - 1, horaActual - DESDE));
  const linea = (vals: number[], n: number) => vals.slice(0, n + 1).map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  if (hoy[hoy.length - 1] === 0 && pasada[pasada.length - 1] === 0) return null;
  return (
    <figure className="duena-linea" aria-label={`Lo que lleva hoy: ${pesos(String(hoy[hasta] ?? 0), { decimals: false })}; la semana pasada a esta hora: ${pesos(String(pasada[hasta] ?? 0), { decimals: false })}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden>
        <path d={linea(pasada, pasada.length - 1)} className="duena-linea-pasada" />
        <path d={linea(hoy, hasta)} className="duena-linea-hoy" />
        <circle cx={x(hasta)} cy={y(hoy[hasta] ?? 0)} r="3.5" className="duena-linea-punto" />
      </svg>
      <figcaption className="row-between tiny muted">
        <span>6:00</span>
        <span className="row gap-12"><span><span className="duena-leyenda-hoy" /> Hoy</span><span><span className="duena-leyenda-pasada" /> Semana pasada</span></span>
        <span>22:00</span>
      </figcaption>
    </figure>
  );
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * INICIO DE LA DUEÑA (UXD-01): ella no opera, consulta. La pantalla contesta
 * en este orden lo que pregunta al abrir el teléfono:
 *   1. ¿cómo va hoy? — a esta hora, contra ayer y contra la semana pasada;
 *   2. ¿cuánto llevo ganado este mes? — contra el mes pasado al mismo día;
 *   3. ¿hay algo que me deba preocupar? — faltantes, devoluciones, cajas;
 *   4–6. lo que le deben, sus socios y cada sucursal.
 * Sin un solo botón de acción: cada tarjeta lleva a su detalle de consulta.
 */
export function InicioDuena() {
  const { me, org, branchName, activo, can } = useSession();
  const [p, setP] = useState<Pulso | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cargar = () => api<Pulso>('/reports/pulse').then((x) => { setP(x); setError(null); })
      .catch((e) => setError(errorText(e, 'No se pudieron cargar las cifras de hoy')));
    cargar();
    // Se refresca sola cada minuto mientras está a la vista.
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 60_000);
    return () => clearInterval(t);
  }, []);

  const nombre = (me.fullName ?? '').split(' ')[0];
  const fecha = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: org.timezone });
  if (error && !p) return (<><PageHeader title={`Hola, ${nombre}`} sub={org.tradeName} /><Callout tone="danger">{error}</Callout></>);
  if (!p) return (<><PageHeader title={`Hola, ${nombre}`} sub={org.tradeName} /><div className="grid grid-2"><Skeleton h={220} r={16} /><Skeleton h={220} r={16} /></div></>);

  const t = p.today;
  const horaActual = new Date(p.asOf).getHours();
  const mes = p.month;
  const mesNombre = MESES[Number(mes.to.slice(5, 7)) - 1];
  const a = p.alerts;
  const hayAlertas = a.shortCounts.length > 0 || a.refundsToday.count > 0 || a.cashOpenSinceYesterday.length > 0 || a.pendingApprovals.count > 0;
  const avance = BigInt(mes.lastMonthTotalProfitCents) > 0n ? Math.min(100, Math.round((Number(mes.profitCents) / Number(mes.lastMonthTotalProfitCents)) * 100)) : null;

  return (
    <>
      <PageHeader eyebrow={fecha.charAt(0).toUpperCase() + fecha.slice(1)} title={`Hola, ${nombre}`} sub={`${org.tradeName} · actualizado a las ${hora(p.asOf)}`} actions={<AvisosEnTelefono />} />
      {error && <Callout tone="warn">No se pudo actualizar; ves las cifras de las {hora(p.asOf)}.</Callout>}

      <div className="grid grid-2 duena-arriba">
        <Card title={`Hoy, hasta las ${hora(p.asOf)}`}>
          <div className="stack-sm">
            <div className="tiny muted">Entró a caja</div>
            <div className="duena-cifra num">{pesos(t.collectedCents, { decimals: false })}</div>
            <Cambio actual={BigInt(t.collectedCents)} antes={BigInt(t.yesterdaySameTimeCents)} contra="ayer a esta hora" />
            {/* Ventas por hora: barra llena = hoy; la línea, el mismo día de la semana pasada. */}
            <LineaAcumulada horas={t.byHour} horaActual={horaActual} />
            <div className="row wrap" style={{ gap: 16, marginTop: 6 }}>
              <span className="row small gap-6"><DoorOpen size={15} aria-hidden /><strong className="num">{t.visits}</strong> entradas
                <Cambio conteo actual={t.visits} antes={t.visitsYesterdaySameTime} contra="ayer" /></span>
              <span className="row small gap-6"><UserPlus size={15} aria-hidden /><strong className="num">{t.newMembers}</strong> socios nuevos</span>
            </div>
          </div>
        </Card>

        <Card title={`Este mes (1–${Number(mes.to.slice(8, 10))} de ${mesNombre})`}>
          <div className="stack-sm">
            <div className="tiny muted">{GLOSARIO.gananciaCaja.nombre}</div>
            <div className="duena-cifra num" style={BigInt(mes.profitCents) < 0n ? { color: 'var(--danger)' } : undefined}>{pesos(mes.profitCents, { decimals: false })}</div>
            <Cambio actual={BigInt(mes.profitCents)} antes={BigInt(mes.lastMonthSameDayProfitCents)} contra="el mes pasado al mismo día" />
            {/* Sin renta ni nómina registradas, la "ganancia" es solo lo que entró (UX5-D-05). */}
            {/* El día y el mes del gimnasio, no los de la computadora (26-06). */}
            {mes.fixedExpensesCents === '0' && Number(hoyEn(org.timezone).slice(8, 10)) > 3 && (
              <p className="tiny text-warn mt-6">Todavía no hay renta ni nómina de {MESES[Number(hoyEn(org.timezone).slice(5, 7)) - 1]} registradas: tu ganancia real será menor. {can('expenses:manage') ? <Link href="/movimientos" className="enlace-en-linea">Regístralas en Movimientos</Link> : 'Las registran la dueña y la gerencia en Movimientos.'}</p>
            )}
            {avance !== null && (
              <div>
                <div className="meter mt-8"><div style={{ width: `${avance}%` }} /></div>
                <div className="tiny muted mt-4">Llevas el {avance} % de lo que ganaste todo el mes pasado ({pesos(mes.lastMonthTotalProfitCents, { decimals: false })})</div>
              </div>
            )}
            <div className="row wrap small" style={{ gap: 16, marginTop: 6 }}>
              <span>{GLOSARIO.entro.nombre} <strong className="num">{pesos(mes.incomeCents, { decimals: false })}</strong></span>
              <span>{GLOSARIO.gastos.nombre} <strong className="num">{pesos(-BigInt(mes.expensesCents), { decimals: false })}</strong></span>
              {/* Gastos incluye los faltantes de caja; un sobrante no los compensa: se dice aparte. */}
              {mes.cashOverageCents && BigInt(mes.cashOverageCents) > 0n && (
                <span className="muted">Sobró en caja <strong className="num">{pesos(mes.cashOverageCents, { decimals: false })}</strong> por aclarar</span>
              )}
            </div>
            {/* El mismo glosario que el Tablero y Movimientos (D-24). */}
            <GlosarioDinero titulo="¿Por qué no es lo mismo que lo que entró?" terminos={['gananciaCaja', 'gastos', 'descuadre', 'utilidad', 'retiroDueno']}>
              <Link href="/movimientos?rango=mes">Ver este mes en Movimientos</Link>.
            </GlosarioDinero>
          </div>
        </Card>
      </div>

      {/* En escritorio, dos columnas (UX5-D-09): lo que pide atención a la
          derecha y la operación del día a la izquierda. En el teléfono, en
          este mismo orden: primero lo que pide atención. */}
      <div className="duena-columnas">
      <div className="duena-col-lado stack">
      {/* D-05 (bloque 4.2): lo que el sistema le avisó y su resumen del lunes; lo mismo que suena en su teléfono. */}
      <AvisosDeLaDuenaTarjeta />
      {/* La llave es suya: solo quien la tiene (y ve al personal) recibe el aviso. */}
      {can('staff:unlock') && can('staff:read') && <GerenteNuevo />}
      {/* El aviso de privacidad no se publica sin su firma (D-25). */}
      {can('approvals:grant') && can('settings:consent:read') && <AvisoPorFirmar />}
      {/* La lista mensual de exsocios no se anonimiza sin su firma (D-32). */}
      {can('approvals:grant') && <ListaDeExsociosPorFirmar />}
      {/* Solicitudes de privacidad con plazo de ley: solo cifras (21-01). */}
      <AvisoSolicitudesArco />
      <Card title="Lo que conviene revisar" className="duena-alertas">
        {!hayAlertas ? (
          <p className="row small" style={{ gap: 8, color: 'var(--ok)' }}><CircleCheck size={16} aria-hidden />Todo en orden: sin faltantes, devoluciones ni cajas olvidadas.</p>
        ) : (
          <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {a.shortCounts.map((c) => (
              <li key={c.id} className="duena-alerta small"><ShieldAlert size={15} style={{ color: 'var(--danger)' }} aria-hidden /><span>
                Corte de {c.registerName} ({branchName(c.branchId)}): faltaron <strong>{pesos(-BigInt(c.varianceCents))}</strong>{c.closedByName ? ` · cerró ${c.closedByName}` : ''}{c.reason ? ` · "${c.reason}"` : ''}
              </span></li>
            ))}
            {a.refundsToday.count > 0 && (
              <li className="duena-alerta small"><ShieldAlert size={15} style={{ color: 'var(--warn)' }} aria-hidden /><span>
                {a.refundsToday.count} {a.refundsToday.count === 1 ? 'devolución' : 'devoluciones'} hoy · {pesos(-BigInt(a.refundsToday.cents))}
                {' '}<Link className="enlace-en-linea" href="/bitacora">Ver quién</Link>
              </span></li>
            )}
            {a.cashOpenSinceYesterday.map((c) => (
              <li key={c.id} className="duena-alerta small"><Wallet size={15} style={{ color: 'var(--warn)' }} aria-hidden /><span>
                {c.registerName} ({branchName(c.branchId)}) sigue abierta desde ayer{c.openedByName ? ` · la abrió ${c.openedByName}` : ''}
              </span></li>
            ))}
            {a.pendingApprovals.count > 0 && (
              <li className="duena-alerta small"><ShieldAlert size={15} style={{ color: 'var(--danger)' }} aria-hidden /><span>
                {/* La segunda firma es suya (2026-10-05): el aviso lleva a su bandeja. */}
                <Link href="/autorizaciones" className="strong">{a.pendingApprovals.count} {a.pendingApprovals.count === 1 ? 'autorización espera tu firma' : 'autorizaciones esperan tu firma'}</Link>
              </span></li>
            )}
          </ul>
        )}
        {a.sensitiveToday > 0 && <p className="tiny muted mt-8">{a.sensitiveToday} operaciones para revisar hoy en la <Link href="/bitacora">bitácora</Link>.</p>}
        {/* D-06: cuántas veces se dejó entrar a alguien sin su rostro; el detalle, en la bitácora (3.12). */}
        {a.entriesWithoutFace7d > 0 && <p className="tiny muted mt-8" data-testid="sin-rostro-7d">{a.entriesWithoutFace7d === 1 ? 'Una entrada autorizada' : `${a.entriesWithoutFace7d} entradas autorizadas`} sin rostro en los últimos 7 días: quién y por qué, en la <Link href="/bitacora">bitácora</Link>.</p>}
      </Card>

        <Card title="Lo que te deben">
          <div className="duena-cifra-chica num">{pesos(p.owed.overdueCents, { decimals: false })} <span className="small muted">atrasado</span></div>
          {(() => {
            const base = p.members.base ?? p.members.active;
            const tasa = base > 0 ? p.owed.membersBehind / base : 0;
            return (
              <p className="small muted">
                <span className="strong" style={{ color: tasa >= .15 ? 'var(--danger)' : tasa >= .08 ? 'var(--warn)' : undefined }}>
                  {p.owed.membersBehind} de {base.toLocaleString('es-MX')} socios atrasados ({(tasa * 100).toFixed(1)} %)
                </span>
                {' '}· por cobrar en total {pesos(p.owed.outstandingCents, { decimals: false })}
              </p>
            );
          })()}
          {/* La deuda por sucursal, en cifras y sin nombres (D-25). */}
          {p.owed.byBranch.length > 0 && (
            <ul className="duena-renglones small" data-testid="deuda-por-sucursal">
              {p.owed.byBranch.map((b) => (
                <li key={b.branchId ?? 'sin'}>
                  <span>{b.branchId ? branchName(b.branchId) : 'Sin sucursal'}{b.membersBehind > 0 ? <span className="muted"> · {b.membersBehind} {b.membersBehind === 1 ? 'atrasado' : 'atrasados'}</span> : null}</span>
                  <span className="num">{pesos(b.outstandingCents, { decimals: false })}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="tiny muted mt-8">Por sucursal donde se hizo el cargo. El detalle de quién debe lo lleva la gerencia.</p>
        </Card>
        {/* Ventas y existencias de la tienda, en cifras (D-25). */}
        {activo('pos') && <TiendaDeLaDuena />}
        <Card title="Tus socios">
          <div className="duena-cifra-chica num"><Users size={18} aria-hidden /> {p.members.active.toLocaleString('es-MX')} <span className="small muted">activos</span></div>
          <p className="small muted">Este mes: {mes.newMembers} nuevos · {mes.leftMembers} se dieron de baja{mes.trialPasses > 0 ? <span data-testid="pases-de-prueba-mes"> · {mes.trialPasses} {mes.trialPasses === 1 ? 'pase de prueba' : 'pases de prueba'}</span> : null}</p>
          {/* La cifra sin nombres; la lista con nombres es de la operación (ADR-039). */}
          {activo('retention') && <SociosEnRiesgo />}
          {activo('retention') && <p className="tiny muted mt-8">A quién llamar antes de que deje de venir está en Retención: la ve la gerencia y a quien tú se la liberes en Personal.</p>}
        </Card>
        {/* Lo que el gimnasio le paga a GymFlow (D-37): siempre a la vista, también al corriente. */}
        <CuentaConGymflowTarjeta />
      </div>
      <div className="duena-col-principal stack">

      {/* UNA tarjeta por sede (UX5-D-02): antes cada sede salía tres veces,
          en Sucursales, Puertas y Cajas. */}
      <Card title="Tus sucursales hoy" sub={p.doors.length ? 'A qué hora abrió cada una, cuánto lleva y quién está en caja.' : 'Todavía no entra nadie hoy.'} pad={false} data-testid="sedes">
        <ul className="list">
          {[...new Set([...p.branches.map((x) => x.branchId), ...p.doors.map((x) => x.branchId), ...p.openCash.map((x) => x.branchId)])].map((id) => {
            const b = p.branches.find((x) => x.branchId === id);
            const d = p.doors.find((x) => x.branchId === id);
            const cajas = p.openCash.filter((x) => x.branchId === id);
            const abrio = d?.cashOpenedAt && (!d.firstEntryAt || d.cashOpenedAt < d.firstEntryAt) ? d.cashOpenedAt : d?.firstEntryAt ?? null;
            return (
              <li key={id} className="duena-sede-fila">
                <div className="row-between gap-12">
                  <span className="strong">{branchName(id)}</span>
                  <span className="num strong">{pesos(b?.todayCents ?? '0', { decimals: false })}</span>
                </div>
                <div className="row-between small muted gap-12 flex-wrap">
                  <span>
                    {abrio ? `Abrió ${hora(abrio)}` : 'Aún no abre'}
                    {d ? ` · ${d.entries} ${d.entries === 1 ? 'entrada' : 'entradas'} · la última ${hora(d.lastEntryAt)}` : ''}
                    {d?.cashClosedAt ? ` · cerró caja ${hora(d.cashClosedAt)}` : ''}
                  </span>
                  {b && <Cambio actual={BigInt(b.todayCents)} antes={BigInt(b.yesterdaySameTimeCents)} contra="ayer" />}
                </div>
                {cajas.length > 0 && <p className="tiny muted">En caja: {cajas.map((x) => `${x.openedByName ?? 'alguien'} (${x.registerName}) desde ${hora(x.openedAt)}`).join(' · ')}</p>}
              </li>
            );
          })}
        </ul>
        {p.recentEntries.length > 0 && (
          <details className="duena-entradas-plegadas">
            <summary className="small strong">Quién acaba de entrar ({p.recentEntries.length})</summary>
            <ul className="duena-entradas" aria-label="Últimas entradas">
              {p.recentEntries.map((e) => (
                <li key={`${e.memberId}-${e.at}`} className="row-between small">
                  <span><span className="strong">{e.memberName}</span> <code className="tiny muted">{e.memberCode}</code></span>
                  <span className="muted">{hora(e.at)}{p.branches.length > 1 ? ` · ${branchName(e.branchId)}` : ''}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Tu equipo hoy" sub={p.staff.length ? 'Quién ha entrado al panel, qué ha hecho y cuánto ha cobrado.' : 'Todavía no hay personal dado de alta.'} data-testid="equipo">
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {p.staff.map((e) => {
            const hoyEntro = !!e.lastActionAt || (!!e.lastLoginAt && hoyEn(org.timezone, new Date(e.lastLoginAt)) === hoyEn(org.timezone));
            return (
              <li key={e.userId} className="row-between duena-sede small" data-equipo={e.roleKey}>
                <span>
                  <span className="strong">{e.fullName}</span> <span className="muted">· {e.roleName}{e.branchId ? ` · ${branchName(e.branchId)}` : ''}</span>
                </span>
                <span className="muted text-right">
                  {!hoyEntro && 'Sin actividad hoy'}
                  {hoyEntro && [
                    e.lastActionAt ? `última acción ${hora(e.lastActionAt)}` : 'entró al panel',
                    e.paymentsToday > 0 ? `${e.paymentsToday} ${e.paymentsToday === 1 ? 'cobro' : 'cobros'}` : null,
                    e.manualEntriesToday > 0 ? `${e.manualEntriesToday} ${e.manualEntriesToday === 1 ? 'entrada manual' : 'entradas manuales'}` : null,
                    e.openCash ? 'caja abierta' : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="tiny muted mt-8">Quién hizo qué, con detalle, está en la <Link href="/bitacora">bitácora</Link>; las cuentas, en <Link href="/personal">Personal</Link>.</p>
      </Card>
      </div>
      </div>

    </>
  );
}
