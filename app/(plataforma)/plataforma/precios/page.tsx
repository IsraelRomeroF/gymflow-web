'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { pesos } from '@gymflow/ui/format';
import type { PlatformPriceChangePreview } from '@gymflow/core/contracts';
import { useToast, errorText } from '@/components/session';
import { Breadcrumb, Button, Callout, Card, ErrorCarga, PageHeader, EsqueletoTabla } from '@/components/ui';
import { periodo } from '../cobro';
import { AnunciarCambio, CambiosAnunciados } from './anunciados';
import { Iva } from './iva';

type Precio = { key: string; name: string; monthlyCents: string | null; /** El cambio ya anunciado de este precio, si lo hay (D-38). */ pending: { id: string; monthlyCents: string | null; effectiveFrom: string } | null };
/** Lo que responde guardar: cuántos quedaron en el acto y cuáles se anunciaron para una fecha. */
type Guardado = { changed: number; scheduled: Array<{ effectiveFrom: string }>; affected: number; prices: Precio[] };

/**
 * PRECIOS DE LA PLATAFORMA (ADR-038). Lo que GymFlow cobra al mes por lo
 * básico y por cada módulo. Los fija quien opera la plataforma: aquí no hay
 * tarifas inventadas, y sin precio no se factura.
 *
 * Un cambio que le mueve la mensualidad a alguna marca NO se guarda en el
 * acto (D-38, bloque 3.11): se anuncia para una factura con al menos un mes
 * de aviso, y antes de anunciarlo se ve a quién le cambia y en cuánto.
 */
export default function PreciosPage() {
  const toast = useToast();
  const [precios, setPrecios] = useState<Precio[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, string>>({});

  const cargar = useCallback(() => {
    setFallo(false);
    api<{ prices: Precio[] }>('/platform/prices').then((r) => { setPrecios(r.prices); setBorrador({}); }).catch(() => setFallo(true));
  }, []);
  useEffect(cargar, [cargar]);

  // Se captura en pesos con centavos; la API habla en centavos enteros.
  const aCentavos = (texto: string): string | null => {
    const m = /^\s*\$?\s*(\d{1,10})(?:[.,](\d{1,2}))?\s*$/.exec(texto.replace(/,/g, ''));
    if (!m) return null;
    return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'))).toString();
  };
  const aPesos = (cents: string | null): string => (cents === null ? '' : (Number(cents) / 100).toFixed(2));

  // Un solo formulario (UX7 Plataforma): se capturan todos los cambios y se guardan juntos.
  const cambios = (precios ?? []).filter((p) => (borrador[p.key] ?? '').trim() !== '' && aCentavos(borrador[p.key]!) !== p.monthlyCents);
  const invalidos = cambios.filter((p) => aCentavos(borrador[p.key]!) === null);
  const [guardandoTodo, setGuardandoTodo] = useState(false);
  /** La vista previa de un cambio que le mueve la mensualidad a alguna marca: se confirma antes de anunciarlo. */
  const [previa, setPrevia] = useState<PlatformPriceChangePreview | null>(null);
  const [version, setVersion] = useState(0);
  const pedidos = () => cambios.map((p) => ({ key: p.key, monthlyCents: aCentavos(borrador[p.key]!) }));
  async function guardar(effectiveFrom?: string) {
    // Todos juntos (23-09): o se guardan todos o ninguno, y queda UN asiento con lo de antes y lo de ahora.
    const r = await api<Guardado>('/platform/prices', { method: 'PUT', body: JSON.stringify({ prices: pedidos(), ...(effectiveFrom ? { effectiveFrom } : {}) }) });
    setPrecios(r.prices);
    setBorrador({});
    setPrevia(null);
    setVersion((v) => v + 1);
    const cuantos = cambios.length === 1 ? `${cambios[0]!.name}: precio guardado` : `${cambios.length} precios guardados`;
    toast('ok', r.scheduled.length > 0
      ? `${cuantos}. ${r.scheduled.length === 1 ? 'El cambio aplica' : 'Los cambios aplican'} desde la factura de ${periodo(r.scheduled[0]!.effectiveFrom).toLowerCase()}; a ${r.affected === 1 ? 'la marca afectada' : `las ${r.affected} marcas afectadas`} se les avisa.`
      : `${cuantos} al mes.`);
  }
  async function guardarTodo() {
    if (cambios.length === 0 || invalidos.length > 0) return;
    setGuardandoTodo(true);
    try {
      // Primero, qué pasaría: si a nadie le cambia la mensualidad, se guarda ya; si no, se confirma con la lista a la vista.
      const v = await api<PlatformPriceChangePreview>('/platform/prices/preview', { method: 'POST', body: JSON.stringify({ prices: pedidos() }) });
      if (v.immediate) await guardar();
      else setPrevia(v);
    } catch (e) {
      toast('error', errorText(e, 'No se pudieron guardar los precios: no cambió ninguno'));
    } finally { setGuardandoTodo(false); }
  }

  const sinPrecio = precios?.filter((p) => p.monthlyCents === null).length ?? 0;
  return (
    <>
      <Breadcrumb items={[{ label: 'Marcas', href: '/plataforma' }, { label: 'Precios' }]} />
      <PageHeader title="Precios" sub="Lo que cobra GymFlow al mes por lo básico y por cada módulo, sin IVA. La mensualidad de cada marca se arma con estos precios y lo que tiene contratado; las facturas ya emitidas no cambian. Un cambio que le mueve la mensualidad a alguna marca se anuncia con al menos un mes de aviso: hasta esa fecha cada marca paga lo que pagaba. Todo queda en Seguridad → «Lo que hizo la plataforma»." />
      {fallo && <ErrorCarga mensaje="No se pudieron cargar los precios." onReintentar={cargar} />}
      {!precios && !fallo && <div className="card"><EsqueletoTabla filas={10} /></div>}
      {precios && (
        <div className="stack">
          {sinPrecio > 0 && <Callout tone="warn">{sinPrecio === 1 ? 'Falta un precio' : `Faltan ${sinPrecio} precios`}: a una marca que tenga contratado algo sin precio no se le puede facturar.</Callout>}
          <Card pad={false} data-testid="precios">
            <div className="table-wrap">
              <table className="table table-stack">
                <thead><tr><th>Concepto</th><th className="right">Precio al mes (MXN)</th><th>Nuevo precio</th></tr></thead>
                <tbody>
                  {precios.map((p) => {
                    const texto = borrador[p.key] ?? '';
                    const malo = texto.trim() !== '' && aCentavos(texto) === null;
                    return (
                      <tr key={p.key} data-precio={p.key}>
                        <td data-label="Concepto"><span className="strong">{p.name}</span>{p.key === 'core' && <div className="tiny muted">Se cobra a toda marca liberada: panel, socios, cobranza y accesos.</div>}</td>
                        <td className="right num" data-label="Precio al mes">{p.monthlyCents === null ? <span className="muted">Sin precio</span> : pesos(p.monthlyCents)}
                          {p.pending && <div className="tiny muted" data-anunciado={p.key}>{p.pending.monthlyCents === null ? 'Sin precio' : pesos(p.pending.monthlyCents)} desde {periodo(p.pending.effectiveFrom).toLowerCase()}</div>}</td>
                        <td data-label="Nuevo precio">
                          <input className="input mono" style={{ maxWidth: 160 }} inputMode="decimal" aria-label={`Nuevo precio de ${p.name}`} aria-invalid={malo || undefined} placeholder={p.monthlyCents === null ? '0.00' : aPesos(p.monthlyCents)}
                            disabled={!!p.pending} title={p.pending ? 'Ya tiene un cambio anunciado: cancélalo abajo antes de anunciar otro' : undefined}
                            value={texto} onChange={(e) => setBorrador({ ...borrador, [p.key]: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') void guardarTodo(); }} />
                          {malo && <div className="tiny text-danger">Escribe pesos, por ejemplo 1500 o 1500.50</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-foot row precios-pie gap-10 justify-end">
              <span className="small muted" style={{ marginRight: 'auto' }} data-testid="precios-pendientes">
                {cambios.length === 0 ? 'Escribe el precio nuevo en los conceptos que quieras cambiar.'
                  : invalidos.length > 0 ? `Corrige ${invalidos.length === 1 ? 'un importe' : `${invalidos.length} importes`} para poder guardar.`
                    : `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'} sin guardar`}
              </span>
              {cambios.length > 0 && <Button variant="secondary" onClick={() => setBorrador({})} disabled={guardandoTodo}>Descartar</Button>}
              <Button icon={<Check />} loading={guardandoTodo} disabled={cambios.length === 0 || invalidos.length > 0} onClick={() => void guardarTodo()}>
                {cambios.length > 1 ? `Guardar ${cambios.length} precios` : 'Guardar precios'}
              </Button>
            </div>
          </Card>
          <CambiosAnunciados version={version} onCambio={cargar} />
          {/* D-39 (bloque 4.9): el IVA de las facturas, apagado mientras nadie lo anuncie, y los datos de GymFlow como emisor. */}
          <Iva />
          <Callout tone="info">La factura que emite la plataforma es un estado de cuenta: no es un CFDI ni se timbra. El comprobante fiscal se emite por fuera, con la razón social y el RFC de cada marca.</Callout>
        </div>
      )}
      {previa && (
        <AnunciarCambio previa={previa} titulo={cambios.length === 1 ? `Cambiar el precio de ${cambios[0]!.name}` : `Cambiar ${cambios.length} precios`}
          onClose={() => setPrevia(null)} onConfirmar={guardar} />
      )}
    </>
  );
}
