'use client';

import { use, useCallback, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import type { MemberPosSales, MemberStatement, StatementCharge, StatementChargesPage, StatementPayment, StatementPaymentsPage } from '@gymflow/core/contracts';
import { COMO_SE_SALDO, METODO_DE_PAGO, etiqueta } from '@gymflow/core/vocabulario';
import { api } from '@/lib/api';
import { concepto, fecha, hoyEn, masDias, pesos } from '@gymflow/ui/format';
import { useCarga } from '@gymflow/ui/carga';
import { useSession } from '@/components/session';
import { Button, ErrorCarga, Segmented, Skeleton } from '@/components/ui';
import { queCompro } from '@/components/ficha/compras';

type Socio = { id: string; memberCode: string; firstName: string; lastName: string; homeBranchId: string | null };
type Periodo = 'todo' | 'anio' | 'tres';
const PERIODOS: ReadonlyArray<{ value: Periodo; label: string }> = [
  { value: 'tres', label: 'Últimos 3 meses' }, { value: 'anio', label: 'Este año' }, { value: 'todo', label: 'Todo' },
];
/** Tope de páginas por lista: 20 × 200 renglones. Si no alcanza, la hoja lo dice. */
const PAGINAS = 20;

type Datos = { socio: Socio; st: MemberStatement; cargos: StatementCharge[]; pagos: StatementPayment[]; compras: MemberPosSales['items'] | null; completo: boolean };

const ESTADO: Record<string, string> = { OPEN: 'Por pagar', PARTIALLY_PAID: 'Pago parcial', OVERDUE: 'Vencido', VOID: 'Anulado', WRITTEN_OFF: 'Condonado', PAID: 'Pagado' };

/**
 * ESTADO DE CUENTA PARA EL SOCIO (auditoría 8, bloque 2.2; A1 DA-25).
 *
 * Una hoja para imprimir o guardar como PDF desde el navegador («Imprimir» →
 * «Guardar como PDF») y mandársela por WhatsApp: lo que se le cargó, lo que
 * pagó, lo que debe o tiene a favor y, si la Tienda está encendida, lo que
 * compró. Es lo primero que pide un socio y lo que necesita su contador. No
 * es un CFDI y así lo dice. Trae TODOS sus movimientos (la ficha los enseña
 * por páginas), filtrados por periodo.
 */
export default function EstadoParaElSocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { org, branchName, can, activo } = useSession();
  const [periodo, setPeriodo] = useState<Periodo>('tres');
  const conTienda = can('billing:statement:read') && activo('pos');

  const carga = useCarga(useCallback(async (): Promise<Datos> => {
    const [socio, st] = await Promise.all([api<Socio>(`/members/${id}`), api<MemberStatement>(`/members/${id}/statement?limit=200`)]);
    const cargos = [...st.charges];
    const pagos = [...st.payments];
    let completo = true;
    let c = st.pages.charges.nextCursor;
    for (let i = 0; c; i++) {
      if (i >= PAGINAS) { completo = false; break; }
      const p = await api<StatementChargesPage>(`/members/${id}/statement/charges?limit=200&cursor=${encodeURIComponent(c)}`);
      cargos.push(...p.items); c = p.nextCursor;
    }
    let g = st.pages.payments.nextCursor;
    for (let i = 0; g; i++) {
      if (i >= PAGINAS) { completo = false; break; }
      const p = await api<StatementPaymentsPage>(`/members/${id}/statement/payments?limit=200&cursor=${encodeURIComponent(g)}`);
      pagos.push(...p.items); g = p.nextCursor;
    }
    let compras: MemberPosSales['items'] | null = null;
    if (conTienda) {
      // Sin las compras la hoja sigue sirviendo: se dice que no vienen.
      try {
        compras = [];
        let v: string | null = null;
        for (let i = 0; i < PAGINAS; i++) {
          const p: MemberPosSales = await api<MemberPosSales>(`/members/${id}/pos-sales?limit=200${v ? `&cursor=${encodeURIComponent(v)}` : ''}`);
          compras.push(...p.items); v = p.nextCursor;
          if (!v) break;
        }
      } catch { compras = null; }
    }
    // La deuda vieja llega también con la primera respuesta: sin repetir.
    const unicos = [...new Map(cargos.map((x) => [x.id, x])).values()];
    return { socio, st, cargos: unicos, pagos, compras, completo };
  }, [id, conTienda]));

  const d = carga.datos;
  const hoy = d?.st.today ?? hoyEn(org.timezone);
  const desde = periodo === 'todo' ? null : periodo === 'anio' ? `${hoy.slice(0, 4)}-01-01` : masDias(hoy, -92);

  const filas = useMemo(() => {
    if (!d) return [];
    const dentro = (dia: string) => !desde || dia.slice(0, 10) >= desde;
    return [
      // Un cargo anulado nunca se le cobró: no va en la hoja del socio. Lo que debe va siempre, aunque sea viejo.
      ...d.cargos.filter((c) => c.status !== 'VOID' && c.status !== 'DRAFT' && (dentro(c.dueDate) || BigInt(c.balanceCents) > 0n)).map((c) => ({
        id: `c-${c.id}`, dia: c.dueDate.slice(0, 10), orden: `${c.dueDate.slice(0, 10)}T00`, que: concepto(c.concept),
        nota: c.status === 'PAID' && c.settledBy ? COMO_SE_SALDO[c.settledBy]?.socio ?? 'Pagado' : BigInt(c.balanceCents) > 0n && c.balanceCents !== c.amountCents ? `Pendiente ${pesos(c.balanceCents)}` : ESTADO[c.status] ?? '',
        cargo: c.amountCents as string | null, abono: null as string | null,
      })),
      ...d.pagos.filter((p) => dentro(p.receivedAt) && ['SUCCEEDED', 'REVERSED'].includes(p.status)).map((p) => {
        const contra = BigInt(p.amountCents) < 0n;
        return {
          id: `p-${p.id}`, dia: p.receivedAt.slice(0, 10), orden: p.receivedAt,
          que: contra ? (p.reversalReason?.startsWith('Reembolso') ? 'Reembolso' : 'Cobro cancelado') : `Pago · ${etiqueta(METODO_DE_PAGO, p.method, p.method)}`,
          nota: [p.folio ? `Folio ${p.folio}` : '', p.externalRef && !contra ? `Ref. ${p.externalRef}` : ''].filter(Boolean).join(' · '),
          cargo: null as string | null, abono: p.amountCents as string | null,
        };
      }),
    ].sort((a, b) => a.orden.localeCompare(b.orden));
  }, [d, desde]);
  const compras = useMemo(() => (d?.compras ?? []).filter((v) => v.status !== 'VOIDED' && (!desde || v.businessDate >= desde)), [d, desde]);

  if (carga.error) return <ErrorCarga titulo="No se pudo armar el estado de cuenta" mensaje={carga.error} onReintentar={() => void carga.recargar()} />;
  if (!d) return <div className="estado-doc"><Skeleton h={520} r={12} /></div>;

  const debe = BigInt(d.st.outstandingCents);
  const aFavor = BigInt(d.st.creditCents);
  const totalCargos = filas.reduce((a, f) => a + BigInt(f.cargo ?? 0), 0n);
  const totalAbonos = filas.reduce((a, f) => a + BigInt(f.abono ?? 0), 0n);
  const totalCompras = compras.reduce((a, v) => a + BigInt(v.totalCents), 0n);

  return (
    <div className="stack items-center">
      <div className="no-print row wrap gap-12">
        <Segmented value={periodo} onChange={setPeriodo} options={PERIODOS} etiqueta="Periodo" />
        <Button icon={<Printer />} onClick={() => window.print()}>Imprimir o guardar como PDF</Button>
      </div>
      <article className="estado-doc" data-testid="estado-para-el-socio">
        <header>
          <div>
            <p className="estado-doc-org">{org.tradeName}</p>
            {d.socio.homeBranchId && <p>{branchName(d.socio.homeBranchId)}</p>}
          </div>
          <div className="estado-doc-titulo">
            <h1>Estado de cuenta</h1>
            <p>{desde ? `Del ${fecha(desde)} al ${fecha(hoy)}` : `Todos sus movimientos al ${fecha(hoy)}`}</p>
          </div>
        </header>
        <p className="estado-doc-socio">{d.socio.firstName} {d.socio.lastName} <span>· {d.socio.memberCode}</span></p>

        <dl className="estado-doc-saldo">
          <div><dt>{debe > 0n ? 'Debe hoy' : 'Saldo hoy'}</dt><dd>{debe > 0n ? pesos(debe) : 'Al corriente'}</dd></div>
          {aFavor > 0n && <div><dt>A favor</dt><dd>{pesos(aFavor)}</dd></div>}
          <div><dt>Cargos del periodo</dt><dd>{pesos(totalCargos)}</dd></div>
          <div><dt>Pagos del periodo</dt><dd>{pesos(totalAbonos)}</dd></div>
        </dl>

        <h2>Cargos y pagos</h2>
        {filas.length === 0 ? <p className="estado-doc-vacio">Sin movimientos en este periodo.</p> : (
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Cargo</th><th className="num">Pago</th></tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="nowrap">{fecha(f.dia)}</td>
                  <td>{f.que}{f.nota && <span className="estado-doc-nota"> · {f.nota}</span>}</td>
                  <td className="num">{f.cargo ? pesos(f.cargo) : ''}</td>
                  <td className="num">{f.abono ? pesos(f.abono) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Totales del periodo</td><td className="num">{pesos(totalCargos)}</td><td className="num">{pesos(totalAbonos)}</td></tr></tfoot>
          </table>
        )}

        {d.compras !== null && compras.length > 0 && (
          <>
            <h2>Compras en la tienda</h2>
            <table>
              <thead><tr><th>Fecha</th><th>Qué compró</th><th className="num">Total</th></tr></thead>
              <tbody>
                {compras.map((v) => (
                  <tr key={v.id}>
                    <td className="nowrap">{fecha(v.businessDate)}</td>
                    <td>{queCompro(v)}{v.folio && <span className="estado-doc-nota"> · Folio {v.folio}</span>}</td>
                    <td className="num">{pesos(v.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}>Total de compras del periodo (ya pagadas en la tienda)</td><td className="num">{pesos(totalCompras)}</td></tr></tfoot>
            </table>
          </>
        )}
        {conTienda && d.compras === null && <p className="estado-doc-vacio">Sus compras de la tienda no se pudieron consultar: no vienen en esta hoja.</p>}
        {!d.completo && <p className="estado-doc-vacio">Esta hoja trae sus movimientos más recientes; los más antiguos se consultan en recepción.</p>}

        <footer>
          Emitido el {fecha(hoy)}. Estado de cuenta informativo: no es un comprobante fiscal (CFDI). Si necesitas factura, pídela en recepción.
        </footer>
      </article>
    </div>
  );
}
