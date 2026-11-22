'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, Minus, Plus, X, ShoppingCart, Ban, Package, CircleCheck, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { hora, pesos } from '@/lib/format';
import { METODO } from '@/lib/caja';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, ButtonLink, CampoMotivo, Card, Dialog, Empty, ERROR_MOTIVO, faltaMotivo, PageHeader, Skeleton, ErrorCarga, EsqueletoLista } from '@/components/ui';
import { useFormulario } from '@/lib/formulario';
import { CambioEfectivo, CobroFields, cobroListo, cuerpoDelCobro, COBRO_INICIAL, type Cobro } from '@/components/cobro';
import { IconButton } from '@/components/compartido';
import type { PosSale, Product } from '@gymflow/core/contracts';

/** Contratos del núcleo (8-19): antes `Producto` estaba copiado en tres pantallas. */
type Producto = Product;
type Venta = PosSale;

/**
 * PUNTO DE VENTA — agua, suplementos, toallas.
 *
 * Entra al MISMO corte de caja que las membresías: por eso cobra con la caja
 * abierta de la sucursal. El precio lo pone el catálogo, no la pantalla, y la
 * venta del día se puede anular (con motivo) mientras el corte siga abierto.
 */
/** `useSearchParams` exige un límite de Suspense para el prerender. */
export default function PuntoDeVentaPage() {
  return <Suspense fallback={<EsqueletoLista filas={4} />}><PuntoDeVenta /></Suspense>;
}

function PuntoDeVenta() {
  const { branches, inScope, can } = useSession();
  const toast = useToast();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  // Venta ligada a un socio (desde su ficha): la venta guarda quién compró,
  // pero todavía no se ve en su ficha ni en su portal (8-01). La pantalla no
  // promete un historial que no existe.
  const params = useSearchParams();
  const socio = params.get('socio');
  const socioNombre = params.get('nombre');
  const sedeInicial = params.get('sede');
  const [sede, setSede] = useState(sedeInicial && sedes.some((b) => b.id === sedeInicial) ? sedeInicial : sedes[0]?.id ?? '');
  const [productos, setProductos] = useState<Producto[] | null>(null);
  // null = inventario sin confirmar (MC-05): no es lo mismo que cero existencias.
  const [stock, setStock] = useState<Map<string, number> | null>(new Map());
  const [ultima, setUltima] = useState<{ id: string; folio: string | null; totalCents: string; method: string; recibidoCents: bigint | null } | null>(null);
  const [ventas, setVentas] = useState<Venta[] | null>(null);
  const [q, setQ] = useState('');
  const [carrito, setCarrito] = useState<Map<string, number>>(new Map());
  const [cobro, setCobro] = useState<Cobro>(COBRO_INICIAL);
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState(false);
  const [anular, setAnular] = useState<Venta | null>(null);
  const cambiarCobro = useCallback((c: Cobro) => setCobro(c), []);
  const [recibido, setRecibido] = useState<bigint | null>(null);

  const cargar = useCallback(async () => {
    if (!sede) return;
    const [p, inv, v] = await Promise.all([
      api<{ products: Producto[] }>('/products'),
      // Si el inventario no responde, se vende igual: existencias desconocidas, no agotadas (MC-05).
      api<{ stock: Array<{ productId: string; quantityOnHand: number }> }>(`/inventory?branchId=${sede}`).catch(() => null),
      api<{ sales: Venta[] }>(`/pos/sales?branchId=${sede}`),
    ]);
    setProductos(p.products); setStock(inv ? new Map(inv.stock.map((s) => [s.productId, s.quantityOnHand])) : null); setVentas(v.sales);
  }, [sede]);
  const [fallo, setFallo] = useState<string | null>(null);
  useEffect(() => { setFallo(null); void cargar().catch((e) => { setFallo(errorText(e, 'No se pudo cargar el punto de venta')); setProductos([]); setVentas([]); }); }, [cargar]);

  const porId = useMemo(() => new Map((productos ?? []).map((p) => [p.id, p])), [productos]);
  const visibles = (productos ?? []).filter((p) => !q.trim() || `${p.name} ${p.sku}`.toLowerCase().includes(q.trim().toLowerCase()));
  const lineas = [...carrito.entries()].map(([id, n]) => ({ p: porId.get(id)!, n })).filter((l) => l.p);
  const piezas = lineas.reduce((a, l) => a + l.n, 0);
  const total = lineas.reduce((t, l) => t + BigInt(l.p.priceCents) * BigInt(l.n), 0n);

  const poner = (id: string, delta: number) => setCarrito((c) => {
    const m = new Map(c);
    const n = (m.get(id) ?? 0) + delta;
    if (n <= 0) m.delete(id); else m.set(id, Math.min(99, n));
    return m;
  });

  async function cobrar() {
    setEnviando(true);
    try {
      const v = await api<{ id: string; folio: string | null; totalCents: string }>('/pos/sales', {
        method: 'POST',
        body: JSON.stringify({
          branchId: sede, ...cuerpoDelCobro(cobro), idempotencyKey: `pos-${clave}`,
          ...(socio ? { memberId: socio } : {}),
          lines: lineas.map((l) => ({ productId: l.p.id, quantity: l.n })),
        }),
      });
      // El cambio no se pierde al cobrar (MC-06): queda a la vista con el ticket.
      setUltima({ id: v.id, folio: v.folio, totalCents: v.totalCents, method: cobro.method, recibidoCents: cobro.method === 'CASH' ? recibido : null });
      setCarrito(new Map()); setClave(crypto.randomUUID()); setRecibido(null);
      await cargar();
    } catch (e) { toast('error', errorText(e, 'No se pudo cobrar')); } finally { setEnviando(false); }
  }

  return (
    <div className="stack gap-20">
      <PageHeader title="Punto de venta" sub={socio ? <>Venta para <Link href={`/socios/${socio}`} className="row-link strong">{socioNombre ?? 'el socio'}</Link>. Se cobra con la caja abierta y entra al mismo corte que las membresías.</> : 'Se cobra con la caja abierta y entra al mismo corte que las membresías.'}
        actions={sedes.length > 1 ? (
          <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => { setSede(e.target.value); setCarrito(new Map()); }}>
            {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : undefined} />

      <div className="pos">
        <Card pad={false}>
          <div className="card-body">
            <div className="input-icon"><Search /><input className="input" aria-label="Buscar producto" placeholder="Buscar producto o código" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          {fallo ? <div className="card-body"><ErrorCarga mensaje={fallo} onReintentar={() => { setFallo(null); setProductos(null); void cargar().catch((e) => setFallo(errorText(e, 'No se pudo cargar'))); }} /></div>
            : productos === null ? <EsqueletoLista filas={4} /> : visibles.length === 0 ? (
            <Empty icon={<Package />} title="Sin productos" text={productos.length === 0 ? 'Da de alta el catálogo en Productos.' : 'Ninguno coincide con la búsqueda.'}
              action={productos.length === 0 && can('pos:product:manage') && <ButtonLink size="sm" href="/productos" icon={<Plus />}>Ir a Productos</ButtonLink>} />
          ) : (
            <div className="pos-grid">
              {visibles.map((p) => {
                // Sin inventario confirmado no se bloquea la venta (MC-05).
                const hay = p.tracksInventory && stock ? stock.get(p.id) ?? 0 : null;
                const sinConfirmar = p.tracksInventory && !stock;
                const enCarrito = carrito.get(p.id) ?? 0;
                const agotado = hay !== null && hay - enCarrito <= 0;
                return (
                  <button key={p.id} type="button" className="pos-producto" disabled={agotado} onClick={() => poner(p.id, 1)}>
                    {enCarrito > 0 && <span className="pos-cuenta">{enCarrito}</span>}
                    <span className="strong small">{p.name}</span>
                    <span className="tiny muted">{p.sku}</span>
                    <span className="pos-precio">{pesos(p.priceCents)}</span>
                    {hay !== null && <span className={`tiny ${agotado ? 'danger' : 'muted'}`}>{agotado ? 'Agotado' : `${hay} en existencia`}</span>}
                    {sinConfirmar && <span className="tiny muted">Existencias sin confirmar</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Ticket" data-testid="pos-ticket" actions={lineas.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setCarrito(new Map())}>Vaciar</Button> : undefined}>
          {lineas.length === 0 && ultima ? (
            // Estado "cobrado" (MC-06): total, cambio y ticket a la mano hasta la siguiente venta.
            <div className="empty py-8" data-testid="pos-cobrado">
              <div className="empty-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', borderColor: 'var(--ok-line)' }}><CircleCheck /></div>
              <p className="empty-title">Cobrados {pesos(ultima.totalCents)}</p>
              <p className="empty-text">
                {ultima.recibidoCents !== null && ultima.recibidoCents > BigInt(ultima.totalCents)
                  ? <>Recibidos {pesos(ultima.recibidoCents)} · <strong>cambio {pesos(ultima.recibidoCents - BigInt(ultima.totalCents))}</strong>. </>
                  : null}
                {ultima.folio ? <>Folio <code>{ultima.folio}</code> · </> : null}{METODO[ultima.method] ?? ultima.method}.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 12, width: '100%' }}>
                <a className="btn btn-secondary flex-1" href={`/recibo/venta/${ultima.id}`} target="_blank" rel="noreferrer"><Printer />Ticket</a>
                <Button variant="ghost" style={{ flex: 1 }} onClick={() => setUltima(null)}>Nueva venta</Button>
              </div>
            </div>
          ) : lineas.length === 0 ? <Empty icon={<ShoppingCart />} title="Ticket vacío" text="Toca un producto para agregarlo." /> : (
            <div className="stack">
              <ul className="pos-lineas">
                {lineas.map(({ p, n }) => (
                  // Nombre completo en su renglón y los controles debajo (UX7 Mostrador 10): "Barra de c…" no servía.
                  <li key={p.id} className="pos-linea">
                    <div className="small strong pos-linea-nombre">{p.name}</div>
                    <div className="pos-linea-ctrl">
                      <span className="tiny muted">{pesos(p.priceCents)} c/u</span>
                      <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                        <IconButton label="Uno menos" onClick={() => poner(p.id, -1)}><Minus /></IconButton>
                        <span className="num strong" style={{ width: 22, textAlign: 'center' }}>{n}</span>
                        <IconButton label="Uno más" onClick={() => poner(p.id, 1)}><Plus /></IconButton>
                      </div>
                      <span className="num strong" style={{ minWidth: 72, textAlign: 'right' }}>{pesos(BigInt(p.priceCents) * BigInt(n))}</span>
                      <IconButton label="Quitar" onClick={() => poner(p.id, -n)}><X /></IconButton>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <span className="strong">Total</span><span className="num strong" style={{ fontSize: 26 }}>{pesos(total)}</span>
              </div>
              <CobroFields branchId={sede} value={cobro} onChange={cambiarCobro} />
              {cobro.method === 'CASH' && <CambioEfectivo totalCents={total} onRecibido={setRecibido} />}
              <Button size="lg" block loading={enviando} disabled={!cobroListo(cobro) || total <= 0n} onClick={() => void cobrar()}>Cobrar {pesos(total)}</Button>
            </div>
          )}
        </Card>
      </div>

      {/* En tableta y teléfono el ticket queda debajo de los productos: esta
          barra fija dice cuánto lleva y baja al cobro en un toque (UX5-M-07). */}
      {lineas.length > 0 && (
        <div className="pos-barra" data-testid="pos-barra">
          <span className="small"><strong className="num">{piezas}</strong> {piezas === 1 ? 'producto' : 'productos'} · <strong className="num">{pesos(total)}</strong></span>
          <Button onClick={() => document.querySelector('[data-testid="pos-ticket"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Cobrar</Button>
        </div>
      )}

      <Card title="Ventas de hoy" pad={false}>
        {ventas === null ? <div className="card-body"><Skeleton h={80} /></div> : ventas.length === 0 ? (
          <Empty icon={<ShoppingCart />} title="Aún no hay ventas hoy" text="Cada venta cobrada aparece aquí y entra al corte de la caja." />
        ) : (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Hora</th><th>Folio</th><th>Productos</th><th>Pago</th><th className="right num">Total</th><th /></tr></thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} style={v.status === 'VOIDED' ? { opacity: .55 } : undefined}>
                    <td className="num">{hora(v.soldAt)}</td>
                    <td className="tiny"><code className="nowrap">{v.folio ?? '—'}</code></td>
                    <td className="small">{v.lines.map((l) => `${l.quantity}× ${porId.get(l.productId)?.name ?? 'Producto'}`).join(', ')}</td>
                    <td className="small stack-hide">{v.method ? METODO[v.method] ?? v.method : '—'}</td>
                    <td className="right num strong" data-label="Total">{pesos(v.totalCents)}</td>
                    <td className="right text-right">
                      {v.status === 'VOIDED' ? <span title={v.voidReason ?? ''}><Badge>Anulada</Badge></span>
                        : can('pos:sale:void') && <Button size="sm" variant="ghost" icon={<Ban />} onClick={() => setAnular(v)}>Anular</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {anular && <AnularDialog venta={anular} onClose={() => setAnular(null)} onListo={() => { setAnular(null); void cargar(); }} />}
    </div>
  );
}

function AnularDialog({ venta, onClose, onListo }: { venta: Venta; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  // El principal queda encendido: si falta el motivo, el campo lo dice (26-02, 26-09; adopción 2.12).
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function anular() {
    try {
      await api(`/pos/sales/${venta.id}/void`, { method: 'POST', body: JSON.stringify({ reason: motivo.trim() }) });
      toast('ok', 'Venta anulada: el producto vuelve al inventario');
      onListo();
    } catch (e) { toast('error', errorText(e, 'No se pudo anular')); }
  }
  return (
    <Dialog open size="sm" onClose={onClose} title={`Anular venta de ${pesos(venta.totalCents)}`} sub="Solo el mismo día. Queda en el corte con tu nombre y el motivo."
      footer={<><Button variant="secondary" onClick={onClose} disabled={f.enviando}>Cancelar</Button><Button variant="danger" loading={f.enviando} onClick={() => void f.enviar(anular)}>Anular venta</Button></>}>
      <CampoMotivo id="an-mot" autoFocus value={motivo} onChange={setMotivo} error={f.error('motivo')} placeholder="Se registró el producto equivocado" hint="Queda en el corte y en la bitácora con tu nombre." />
    </Dialog>
  );
}

