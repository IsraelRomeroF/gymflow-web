'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { FilePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useCarga } from '@gymflow/ui/carga';
import { fecha, pesos } from '@gymflow/ui/format';
import { errorText, useToast } from '@/components/session';
import { Button, Dialog, Field, VistaPrevia, sePuedeSeguir, type CifraPrevia } from '@/components/ui';
import { CampoMes, mesesRecientes } from './mes';
import { etiquetaDeIva, periodo, type Factura, type ResultadoDeEmitirMes, type VistaPreviaDeEmision } from './textos';

const facturas = (n: number): string => `${n} ${n === 1 ? 'factura' : 'facturas'}`;
const marcas = (n: number): string => `${n} ${n === 1 ? 'marca' : 'marcas'}`;

/**
 * EMITIR (23-05): un solo diálogo para una marca o para todas. Antes de
 * confirmar se ve lo que va a salir —a quién, por cuánto y a quién se salta
 * y por qué— con el mismo cálculo que hace la emisión
 * (`GET /platform/invoices/issue-month/preview`), y el botón lleva la cifra.
 *
 * Con `marca`, el diálogo es el de la ficha: ofrece los meses que a esa
 * marca se le pueden facturar (`meses`) y admite una nota.
 */
export function Emitir({ mesActual, marca, onClose, onHecho }: {
  /** El mes en curso en la Ciudad de México, como lo dijo el servidor. */
  mesActual: string;
  marca?: { id: string; tradeName: string; totalCents: string; meses: ReadonlyArray<{ month: string; invoiced: boolean }> };
  onClose: () => void; onHecho: () => void;
}) {
  const toast = useToast();
  const meses = marca ? marca.meses : mesesRecientes(mesActual);
  const [mes, setMes] = useState(meses.find((m) => m.month === mesActual)?.month ?? meses[0]?.month ?? mesActual);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDeEmitirMes | null>(null);
  // En la ficha ya se sabe qué meses tienen factura: ese no se pregunta, se dice en el campo.
  const yaFacturado = !!marca && meses.some((m) => m.month === mes && 'invoiced' in m && m.invoiced);
  const marcaId = marca?.id;
  const pedir = useCallback(
    () => api<VistaPreviaDeEmision>(`/platform/invoices/issue-month/preview?month=${mes}${marcaId ? `&organizationId=${marcaId}` : ''}`),
    [mes, marcaId],
  );
  const previa = useCarga(yaFacturado || resultado ? null : pedir);
  const v = previa.datos;

  async function emitir() {
    setEnviando(true); setError(null);
    try {
      if (marca) {
        const f = await api<Factura>(`/platform/organizations/${marca.id}/invoices`, { method: 'POST', body: JSON.stringify({ month: mes, ...(nota.trim() ? { note: nota.trim() } : {}) }) });
        toast('ok', `Factura ${f.folio} emitida: ${pesos(f.totalCents)}.`);
        onHecho();
      } else {
        setResultado(await api<ResultadoDeEmitirMes>('/platform/invoices/issue-month', { method: 'POST', body: JSON.stringify({ month: mes }) }));
      }
    } catch (e) { setError(errorText(e, marca ? 'No se pudo emitir la factura' : 'No se pudo emitir el mes')); } finally { setEnviando(false); }
  }

  // Una marca: lo que la impide es un bloqueo; lo que se cobra, sus líneas.
  const unaSaltada = marca ? v?.skipped[0] : undefined;
  const bloqueos = unaSaltada
    ? [unaSaltada.code === 'MISSING_PRICES' ? <>{unaSaltada.reason}. <Link href="/plataforma/precios">Fíjalo en Precios</Link>.</> : `${unaSaltada.reason}.`]
    : !marca && v && v.toIssue.length === 0 ? [`No hay ninguna factura que emitir de ${periodo(mes).toLowerCase()}: todas las marcas en uso ya la tienen o se saltan.`] : [];
  const cifras: CifraPrevia[] = !v ? []
    : marca
      ? [
        ...(v.toIssue[0]?.lines ?? []).map((l) => ({ etiqueta: l.name, valor: pesos(l.monthlyCents) })),
        // D-39: con IVA, el subtotal y el IVA van antes del total.
        ...(v.toIssue[0] && v.toIssue[0].taxRateBps > 0 ? [{ etiqueta: v.toIssue[0].taxIncluded ? 'Subtotal sin IVA' : 'Subtotal', valor: pesos(v.toIssue[0].subtotalCents) }, { etiqueta: etiquetaDeIva(v.toIssue[0]), valor: pesos(v.toIssue[0].taxCents) }] : []),
        ...(v.toIssue[0] ? [{ etiqueta: <strong>Total</strong>, valor: <span data-testid="emision-total">{pesos(v.totalCents)}</span>, nota: `Vence el ${fecha(v.dueDate)}, 10 días después de emitirse.` }] : []),
      ]
      : v.toIssue.map((x) => ({ etiqueta: x.tradeName, valor: pesos(x.totalCents) }));
  const avisos = !marca && v ? v.skipped.map((s) => <><strong>{s.tradeName}</strong> se salta: {s.reason.charAt(0).toLowerCase() + s.reason.slice(1)}.</>) : [];
  const listo = !!v && sePuedeSeguir(bloqueos) && v.toIssue.length > 0;
  // El importe del botón es el de la vista previa (lo que de verdad se emite): el primer mes va por días y puede no ser la mensualidad.
  const total = v?.totalCents;

  if (resultado) {
    return (
      <Dialog open onClose={onHecho} title={`${periodo(resultado.month)}: emitido`} footer={<Button onClick={onHecho}>Listo</Button>}>
        <div className="stack-sm" data-testid="emision-resultado">
          <p className="small">
            <strong>{resultado.issued.length}</strong> {resultado.issued.length === 1 ? 'factura emitida' : 'facturas emitidas'}
            {resultado.skipped.length ? ` · ${resultado.skipped.length} ${resultado.skipped.length === 1 ? 'marca saltada' : 'marcas saltadas'}` : ''}
            {resultado.failed.length ? ` · ${resultado.failed.length} con error` : ''}.
          </p>
          <ul className="list lista-acotada">
            {resultado.failed.map((x) => <li key={x.organizationId} className="list-item"><span className="flex-1 strong">{x.tradeName}</span><span className="tiny text-danger">No se emitió: {x.error}</span></li>)}
            {resultado.issued.map((x) => <li key={x.folio} className="list-item"><span className="flex-1">{x.tradeName}</span><code>{x.folio}</code><span className="num strong">{pesos(x.totalCents)}</span></li>)}
            {resultado.skipped.map((x) => <li key={x.organizationId} className="list-item"><span className="flex-1">{x.tradeName}</span><span className="tiny muted">{x.reason}</span></li>)}
          </ul>
          {resultado.failed.length > 0 && <p className="small muted">Las que fallaron no cortaron a las demás. Vuelve a emitir el mes para reintentarlas: las que ya tienen factura se saltan.</p>}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} error={error}
      title={marca ? `Generar factura a ${marca.tradeName}` : `Emitir ${periodo(mes).toLowerCase()}`}
      sub={marca
        ? 'Se cobra con los precios de ese mes y lo contratado hoy; el mes en que empezó y un módulo contratado a medio mes van por días. Después de emitida no cambia: si algo se ajusta, se anula y se emite otra.'
        : 'Una factura por cada marca en uso que no la tenga todavía. El día 1 de cada mes esto corre solo; el botón sirve para adelantarse o para una marca liberada a mitad de mes.'}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
        <Button loading={enviando} icon={<FilePlus />} disabled={!listo} onClick={() => void emitir()}>
          {marca ? `Emitir${total !== undefined ? ` ${pesos(total)}` : ''}` : v ? `Emitir ${facturas(v.toIssue.length)} · ${pesos(v.totalCents)}` : 'Emitir'}
        </Button>
      </>}>
      <div className="stack">
        <Field label="Mes" htmlFor="em-mes" hint={yaFacturado ? 'Ese mes ya tiene factura. Anúlala antes de emitir otra.' : marca ? undefined : 'El mes en curso es el de la Ciudad de México.'}>
          <CampoMes id="em-mes" value={mes} onChange={setMes} meses={meses} disabled={enviando} />
        </Field>
        {!yaFacturado && (
          <div data-testid="vista-previa-emision">
            {!marca && v && <p className="small mb-8">{v.toIssue.length > 0 ? <><strong>{facturas(v.toIssue.length)}</strong> por emitir</> : 'Nada por emitir'}{v.skipped.length > 0 ? ` · ${marcas(v.skipped.length)} ${v.skipped.length === 1 ? 'se salta' : 'se saltan'}` : ''}.</p>}
            <div className={marca ? undefined : 'lista-acotada'}>
              <VistaPrevia cargando={previa.cargando} error={previa.error} onReintentar={() => void previa.recargar()}
                titulo={marca ? 'Lo que se va a cobrar' : 'Se va a emitir a'} bloqueos={bloqueos} avisos={avisos} cifras={cifras} />
            </div>
          </div>
        )}
        {marca && <Field label="Nota (opcional)" htmlFor="em-nota" hint="Sale en el comprobante."><input id="em-nota" className="input" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} /></Field>}
      </div>
    </Dialog>
  );
}
