'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { fecha, pesos } from '@/lib/format';
import { ESTADO_IMPORTACION } from '@/lib/importar';
import { useToast, errorText } from '@/components/session';
import { Badge, Breadcrumb, Callout, ErrorCarga, NoExiste, PageHeader, EsqueletoPagina, Tabs, esNoExiste } from '@/components/ui';
import { useCarga } from '@/lib/carga';
import { Aplicada, BarraAplicar } from './aplicar';
import { Asignaciones } from './asignaciones';
import { ListaFilas } from './filas';
import type { Detalle, Kind, Pestana, Plan } from './tipos';

const PESTANAS: Array<{ value: Pestana; label: string; texto: string }> = [
  { value: 'REVIEW', label: 'Por revisar', texto: 'Se parecen a alguien pero no es seguro. Tú decides: nadie más reconoce las caras. Si es otra persona del padrón, búscala con «Es otro socio…».' },
  { value: 'DATA', label: 'Con datos dudosos', texto: 'Traen un saldo, una vigencia o una fecha de alta que no se entendió. Decide cada una: entra sin ese dato, con el valor correcto, o se omite. Así no se pierde dinero ni una membresía sin que lo veas.' },
  { value: 'NEW', label: 'Nuevos', texto: 'No se parecen a ningún socio: se dan de alta.' },
  { value: 'MATCH', label: 'Ya son socios', texto: 'Mismo código anterior, o mismo celular o correo y mismo nombre: se unen a su ficha. Solo se completa lo que le falta, se conserva la antigüedad más vieja y su saldo inicial no se vuelve a cargar si ya lo tenía.' },
  { value: 'FILE_DUP', label: 'Repetidos en el archivo', texto: 'La misma persona aparece más de una vez (p. ej. en dos sucursales): queda una sola ficha y se suman sus saldos de cada sucursal.' },
  { value: 'INVALID', label: 'No se importan', texto: 'Filas sin nombre. Corrígelas en el archivo y vuelve a importarlo: lo ya importado se reconoce y no se duplican fichas ni saldos.' },
];

type EstadoPaso = 'hecho' | 'actual' | 'falta';

/**
 * UNA IMPORTACIÓN, EN CUATRO PASOS (18): 1 Archivo (ya cargado) → 2 Planes y
 * sucursales (cada plan del archivo exige una decisión) → 3 Revisar (lo
 * dudoso, uno por uno) → 4 Aplicar (con confirmación y un solo motivo). Las
 * cifras de arriba incluyen el dinero, para cotejarlo con el reporte de
 * cartera del sistema anterior antes de que entre nada (18-04).
 */
export default function ImportacionPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [d, setD] = useState<Detalle | null>(null);
  const [fallo, setFallo] = useState<unknown>(null);
  const [tab, setTab] = useState<Pestana | null>(null);

  const cargar = useCallback(() => {
    setFallo(null);
    return api<Detalle>(`/member-imports/${id}`).then((x) => {
      setD(x);
      const conDatos = Object.values(x.byData ?? {}).reduce((a, n) => a + (n ?? 0), 0);
      setTab((t) => t ?? ((x.byDecision.PENDING ?? 0) > 0 ? 'REVIEW'
        : x.dataPending > 0 ? 'DATA'
        : (['NEW', 'MATCH', 'FILE_DUP', 'INVALID', 'REVIEW'] as Kind[]).find((k) => (x.byKind[k] ?? 0) > 0) ?? (conDatos > 0 ? 'DATA' : 'NEW')));
    }).catch(setFallo);
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);
  // Sin red no se ofrece solo «No cargar su vigencia» como si no hubiera planes (26-01).
  const planes = useCarga(useCallback(() => api<Plan[]>('/plans').then((p) => p.filter((x) => x.isActive && (x.billingModel === 'RECURRING' || x.billingModel === 'PREPAID_PERIOD'))), []));

  if (fallo) return esNoExiste(fallo) ? <NoExiste titulo="Esta importación no existe" texto="Puede ser de otro gimnasio o el enlace está incompleto." volverA="/importar" volverTexto="Importar socios" /> : <ErrorCarga mensaje={errorText(fallo, 'No se pudo cargar la importación')} onReintentar={() => void cargar()} />;
  if (!d || !tab) return <EsqueletoPagina />;

  const pendientes = d.byDecision.PENDING ?? 0;
  const porRevisar = pendientes + d.dataPending;
  const enRevision = d.status === 'REVIEW';
  const e = ESTADO_IMPORTACION[d.status];
  const conDatos = Object.values(d.byData ?? {}).reduce((a, n) => a + (n ?? 0), 0);
  const conteo = (p: Pestana) => (p === 'DATA' ? conDatos : d.byKind[p] ?? 0);
  const m = d.money;

  // En qué paso va: el primero que todavía pide algo.
  const planesListos = !d.labels.plans.some((p) => p.vigentes > 0 && !Object.prototype.hasOwnProperty.call(d.planMap, p.label));
  const aplicada = d.status === 'APPLIED';
  const primero = !enRevision ? 0 : !planesListos ? 2 : porRevisar > 0 ? 3 : 4;
  const paso = (num: number, listo: boolean): EstadoPaso => (!enRevision ? (aplicada ? 'hecho' : 'falta') : num === primero ? 'actual' : listo ? 'hecho' : 'falta');
  const PASOS: Array<{ num: number; nombre: string; estado: EstadoPaso }> = [
    { num: 1, nombre: 'Archivo', estado: d.status === 'CANCELED' ? 'falta' : 'hecho' },
    { num: 2, nombre: 'Planes y sucursales', estado: paso(2, planesListos) },
    { num: 3, nombre: 'Revisar', estado: paso(3, porRevisar === 0) },
    { num: 4, nombre: 'Aplicar', estado: paso(4, false) },
  ];

  return (
    <div className="stack gap-24">
      <PageHeader eyebrow={<Breadcrumb items={[{ label: 'Importar socios', href: '/importar' }, { label: d.fileName }]} />}
        title={d.fileName}
        sub={<>{d.totalRows.toLocaleString('es-MX')} filas · saldos al {fecha(d.cutoffDate)} · <Badge tone={e.tone} dot>{e.label}</Badge></>} />

      <ol className="importar-pasos" aria-label="Pasos de la importación" data-testid="importar-pasos">
        {PASOS.map((p) => (
          <li key={p.num} className="importar-paso" data-estado={p.estado} aria-current={p.estado === 'actual' ? 'step' : undefined}>
            <span className="importar-paso-num" aria-hidden>{p.estado === 'hecho' ? '✓' : p.num}</span>{p.nombre}
            <span className="sr-only">{p.estado === 'hecho' ? ' (listo)' : p.estado === 'actual' ? ' (aquí vas)' : ''}</span>
          </li>
        ))}
      </ol>

      {aplicada && <Aplicada d={d} />}
      {d.status === 'CANCELED' && <Callout tone="info" title="Importación descartada">No entró nada al padrón.{d.reason ? ` Motivo: «${d.reason}».` : ''} El archivo se puede volver a subir.</Callout>}

      {enRevision && pendientes > 0 && (
        <Callout tone="warn" title={`${pendientes} ${pendientes === 1 ? 'coincidencia espera' : 'coincidencias esperan'} tu decisión`}>
          Unir a dos personas distintas haría que una vea los datos de la otra; no unir a la misma le cobraría dos veces. Revisa cada caso en «Por revisar».
        </Callout>
      )}
      {enRevision && d.dataPending > 0 && (
        <Callout tone="warn" title={`${d.dataPending} ${d.dataPending === 1 ? 'fila con datos dudosos espera' : 'filas con datos dudosos esperan'} tu decisión`}>
          Traen un saldo, una vigencia o una fecha de alta que no se entendió. Decide cada una en «Con datos dudosos»: así nadie pierde dinero ni su membresía sin que lo veas.
        </Callout>
      )}

      {/* Seis cifras: cuatro de filas y dos de dinero, para cotejar con el reporte de cartera (18-04). */}
      <div className="grid grid-3" data-testid="importar-resumen">
        <Cifra valor={(d.byDecision.CREATE ?? 0).toLocaleString('es-MX')} texto="se dan de alta" />
        <Cifra valor={(d.byDecision.MERGE ?? 0).toLocaleString('es-MX')} texto="se unen a una ficha" />
        <Cifra valor={(d.byDecision.SKIP ?? 0).toLocaleString('es-MX')} texto="se omiten" />
        <Cifra valor={porRevisar.toLocaleString('es-MX')} texto="por revisar" alerta={porRevisar > 0} />
        <Cifra valor={pesos(m.debtCents)} texto={`de adeudo en ${m.debtRows.toLocaleString('es-MX')} ${m.debtRows === 1 ? 'socio' : 'socios'}`} testid="importar-adeudo" />
        <Cifra valor={pesos(m.creditCents)} texto={`a favor en ${m.creditRows.toLocaleString('es-MX')} ${m.creditRows === 1 ? 'socio' : 'socios'}`} testid="importar-a-favor" />
      </div>
      <p className="small muted importar-dinero" data-testid="importar-vigencias">
        Membresías vigentes que se crean: <strong>{m.memberships.toLocaleString('es-MX')}</strong>
        {m.membershipsNotLoaded > 0 && <> · sin cargar (por decisión o porque falta elegir su plan): <strong className="text-warn">{m.membershipsNotLoaded.toLocaleString('es-MX')}</strong></>}
        {m.expired > 0 && <> · vigencias ya vencidas: {m.expired.toLocaleString('es-MX')}</>}
        {m.unreadBalances > 0 && <> · saldos que no se entendieron: <strong className="text-warn">{m.unreadBalances.toLocaleString('es-MX')}</strong></>}
        . Solo cuenta lo que entra: lo omitido no suma.
      </p>

      {/* La decisión que más pesa del archivo (qué plan se carga a cada vigencia) va antes que las filas (18-03). */}
      {(d.labels.plans.length > 0 || d.labels.branches.length > 0) && (
        <Asignaciones d={d} planes={planes} editable={enRevision} onGuardado={() => { toast('ok', 'Asignaciones guardadas.'); void cargar(); }} />
      )}

      <section className="stack" aria-label="Revisar">
        <h2 className="section-title m-0">3 · Revisar</h2>
        <div className="importar-tabs">
          <Tabs value={tab} onChange={setTab} tabs={PESTANAS.filter((p) => conteo(p.value) > 0).map((p) => ({ value: p.value, label: p.label, count: conteo(p.value) }))} />
        </div>
        <p className="small muted">{PESTANAS.find((p) => p.value === tab)?.texto}</p>
        <ListaFilas key={tab} importId={d.id} pestana={tab} editable={enRevision} onCambio={() => void cargar()} />
      </section>

      {enRevision && <BarraAplicar d={d} onCambio={() => void cargar()} />}
    </div>
  );
}

function Cifra({ valor, texto, alerta, testid }: { valor: string; texto: string; alerta?: boolean; testid?: string }) {
  return (
    <div className="card card-pad" data-testid={testid}>
      <div className="num strong importar-cifra" data-alerta={alerta ? 'true' : undefined}>{valor}</div>
      <div className="small muted">{texto}</div>
    </div>
  );
}
