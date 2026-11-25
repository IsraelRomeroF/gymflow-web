'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Wallet } from 'lucide-react';
import type { PortfolioDebtors } from '@gymflow/core/contracts';
import { ESTADO_DE_SOCIO } from '@gymflow/core/vocabulario';
import { api, ApiError } from '@/lib/api';
import { fecha, pesos } from '@/lib/format';
import { errorText, useSession } from '@/components/session';
import { Badge, Button, ButtonLink, Callout, Card, Empty, ErrorCarga, EsqueletoTabla, PageHeader, Skeleton, Switch } from '@/components/ui';
import { GLOSARIO } from '@/lib/glosario';
import { useCarga } from '@/lib/carga';

/** Deudores por página; los siguientes, con «Cargar más». */
const POR_PAGINA = 50;
type Deudor = PortfolioDebtors['items'][number];

/**
 * QUIÉN DEBE (fase 4, bloque 4.15). Se llega desde «Ver quién debe» de la
 * Cartera del Tablero. Socio por socio, lo que cuenta en «Por cobrar» —también
 * de quien ya se dio de baja (D-12, bloque 4.11)—, desde cuándo y lo que de él
 * está dado por perdido (D-18). Cada renglón abre su ficha, donde se cobra o se
 * condona sin reactivarlo.
 *
 * Solo la gerencia ve nombres: la dueña ve la cartera en cifras (D-25) y la API
 * le responde 403. Las fichas anonimizadas no salen renglón por renglón: solo
 * su cifra, para que la suma siga cuadrando con «Por cobrar».
 */
export default function DeudoresPage() {
  const { branches, inScope, can, me } = useSession();
  const router = useRouter();
  const conNombres = can('billing:statement:read') && can('billing:portfolio:read');
  const sedes = branches.filter((b) => inScope(b.id));
  const deTodas = me.branchScopes.includes(null) || sedes.length === 1;
  const [sede, setSede] = useState(deTodas ? '' : sedes[0]?.id ?? '');
  const [conBajas, setConBajas] = useState(true);

  const consulta = `/portfolio/debtors?limit=${POR_PAGINA}${sede ? `&branchId=${sede}` : ''}${conBajas ? '' : '&includeArchived=false'}`;
  const cargar = useCallback(() => api<PortfolioDebtors>(consulta).catch((e: unknown) => {
    throw e instanceof ApiError && e.status === 403 ? new Error('Quién debe, con nombre, lo ve la gerencia.') : e;
  }), [consulta]);
  const lista = useCarga(conNombres ? cargar : null, { conservar: true });

  // Lo pedido con «Cargar más»; otra sede u otro filtro empiezan de nuevo.
  const [mas, setMas] = useState<{ items: Deudor[]; cursor: string | null } | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [errorMas, setErrorMas] = useState<string | null>(null);
  useEffect(() => { setMas(null); setErrorMas(null); }, [lista.datos]);
  const cursor = mas ? mas.cursor : lista.datos?.nextCursor ?? null;
  async function cargarMas() {
    if (!cursor || pidiendo) return;
    setPidiendo(true); setErrorMas(null);
    try {
      const r = await api<PortfolioDebtors>(`${consulta}&cursor=${encodeURIComponent(cursor)}`);
      setMas((antes) => ({ items: [...(antes?.items ?? []), ...r.items], cursor: r.nextCursor }));
    } catch (e) { setErrorMas(errorText(e, 'No se pudieron cargar más socios')); }
    finally { setPidiendo(false); }
  }

  const datos = lista.datos ?? null;
  const filas = useMemo(() => (datos ? [...datos.items, ...(mas?.items ?? [])] : null), [datos, mas]);
  const nombreSede = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const variasSedes = branches.length > 1;
  const r = datos?.summary ?? null;
  const volver = <ButtonLink href="/tablero" variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>Tablero</ButtonLink>;

  if (!conNombres) {
    return (
      <div className="stack gap-24">
        <PageHeader title="Quién debe" actions={volver} />
        <Callout tone="info" title="El detalle de quién debe lo lleva la gerencia">
          En el Tablero tienes lo que te deben por sucursal, sin nombres.
        </Callout>
      </div>
    );
  }

  return (
    <div className="stack gap-24">
      <PageHeader
        title="Quién debe"
        sub="Lo que cuenta en «Por cobrar», socio por socio, también de quien ya se dio de baja. Abre su ficha para cobrar o condonar: no hace falta reactivarlo."
        actions={<div className="row gap-8 flex-wrap justify-end">
          {volver}
          {sedes.length > 1 && (
            <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
              {deTodas && <option value="">Todas las sucursales</option>}
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>}
      />

      <Card title="Cartera" sub={GLOSARIO.porCobrar.explica} data-testid="deudores-resumen">
        {lista.error ? <ErrorCarga mensaje={lista.error} onReintentar={() => void lista.recargar()} />
          : r === null ? <Skeleton h={72} />
          : (
            <div className="stack-sm">
              <div className="row-between"><span className="muted">{GLOSARIO.porCobrar.nombre} ({r.all.members} {r.all.members === 1 ? 'socio' : 'socios'})</span><span className="num strong" data-testid="deudores-por-cobrar">{pesos(r.all.outstandingCents)}</span></div>
              {BigInt(r.archived.outstandingCents) > 0n && <div className="row-between"><span className="muted">De socios dados de baja ({r.archived.members})</span><span className="num">{pesos(r.archived.outstandingCents)}</span></div>}
              {(BigInt(r.anonymized.outstandingCents) > 0n || BigInt(r.anonymized.lostCents) > 0n) && (
                <div className="row-between" data-testid="deudores-anonimizados" title="Fichas que ya se anonimizaron: la deuda sigue contando, pero ya no dice de quién es. No salen en la lista.">
                  <span className="muted">De fichas anonimizadas ({r.anonymized.members}), sin nombre</span><span className="num">{pesos(r.anonymized.outstandingCents)}</span>
                </div>
              )}
              {BigInt(r.all.lostCents) > 0n && <div className="row-between"><span className="muted">Dada por perdida, aparte</span><span className="num">{pesos(r.all.lostCents)}</span></div>}
              <p className="tiny muted">
                La lista suma {pesos(r.listed.outstandingCents)} de {r.listed.members} {r.listed.members === 1 ? 'socio' : 'socios'}
                {datos && !datos.includeArchived && BigInt(r.archived.outstandingCents) > 0n ? '; no incluye a los dados de baja' : ''}
                {BigInt(r.anonymized.outstandingCents) > 0n ? '; las fichas anonimizadas solo cuentan en la cifra' : ''}.
              </p>
            </div>
          )}
      </Card>

      <Card title="Socios que deben" sub="De quien más debe a quien menos. «Desde» es el vencimiento más antiguo que no ha pagado." pad={false}
        actions={<Switch checked={conBajas} onChange={setConBajas}>Incluir dados de baja</Switch>}
        footer={cursor && !lista.error ? (
          <div className="stack-sm">
            {errorMas && <p className="small danger" role="alert">{errorMas}</p>}
            <Button size="sm" variant="secondary" loading={pidiendo} onClick={() => void cargarMas()} data-testid="deudores-cargar-mas">Cargar más</Button>
          </div>
        ) : undefined}>
        {lista.error ? <div className="card-body"><ErrorCarga mensaje={lista.error} onReintentar={() => void lista.recargar()} /></div>
          : filas === null ? <EsqueletoTabla filas={5} columnas={5} />
          : filas.length === 0 ? (
            <Empty icon={<Wallet />} title="Nadie debe" text={conBajas ? 'Con esta sucursal no hay deuda por cobrar.' : 'Ningún socio activo debe. Enciende «Incluir dados de baja» para ver a quien ya se fue.'} />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack" data-testid="deudores-lista">
                <thead><tr><th>Socio</th>{variasSedes && <th>Sucursal</th>}<th className="right num">Por cobrar</th><th>Desde</th><th>Dada por perdida</th><th /></tr></thead>
                <tbody>
                  {filas.map((d) => (
                    <tr key={d.memberId} className="is-link" data-testid="deudor"
                      onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) router.push(`/socios/${d.memberId}`); }}>
                      <td>
                        <div className="strong">{d.fullName}</div>
                        <div className="tiny muted"><code>{d.memberCode}</code>{d.archived && <> <Badge tone={ESTADO_DE_SOCIO.ARCHIVED!.tone}>{ESTADO_DE_SOCIO.ARCHIVED!.label}</Badge></>}</div>
                      </td>
                      {variasSedes && <td className="small" data-label="Sucursal">{d.homeBranchId ? nombreSede.get(d.homeBranchId) ?? 'Otra sucursal' : 'Sin sucursal'}</td>}
                      <td className="right num" data-label="Por cobrar">
                        <span className="strong">{pesos(d.outstandingCents)}</span>
                        {BigInt(d.overdueCents) > 0n && d.overdueCents !== d.outstandingCents && <div className="tiny muted">vencido {pesos(d.overdueCents)}</div>}
                      </td>
                      <td className="small" data-label="Desde">{datos && d.oldestDueDate >= datos.asOf ? `vence el ${fecha(d.oldestDueDate)}` : fecha(d.oldestDueDate)}</td>
                      <td data-label="Dada por perdida">{BigInt(d.lostCents) > 0n ? <Badge tone="warn">{pesos(d.lostCents)}</Badge> : <span className="muted">—</span>}</td>
                      <td className="right text-right"><Link className="btn btn-ghost btn-sm" href={`/socios/${d.memberId}`}>Abrir ficha</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}
