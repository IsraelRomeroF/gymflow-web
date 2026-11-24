'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, PackagePlus, Package, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { fechaHora, pesos } from '@/lib/format';
import { aCentavos } from '@/lib/caja';
import { useSession, useToast, errorText } from '@/components/session';
import { Badge, Button, Card, Dialog, Empty, ErrorCarga, Field, PageHeader, EsqueletoTabla, Switch } from '@/components/ui';
import { EstadoCarga, useCarga } from '@/lib/carga';
import type { InventoryMovement, InventoryMovementList, Product } from '@gymflow/core/contracts';
import { MOVIMIENTO_DE_INVENTARIO, etiqueta } from '@gymflow/core/vocabulario';

/** El producto del catálogo: contrato del núcleo (8-19). */
type Producto = Product;

const MOVIMIENTOS = [
  { value: 'PURCHASE', label: 'Entrada de mercancía', signo: 1 },
  { value: 'ADJUSTMENT', label: 'Ajuste por conteo', signo: 0 },
  { value: 'SHRINKAGE', label: 'Merma (caducó, se rompió)', signo: -1 },
] as const;

/**
 * PRODUCTOS E INVENTARIO. El precio de aquí es el que cobra el punto de
 * venta —la pantalla de venta no lo puede cambiar— y cada cambio de precio
 * queda en la bitácora. Las existencias son por sucursal.
 *
 * Cada producto puede tener, además del precio de público, un precio de
 * socio (se cobra a socios con membresía vigente) y su costo (D-21, bloque
 * 3.6). Los dos son opcionales. El costo solo lo recibe quien administra el
 * catálogo: con él se sabe cuánto deja cada producto.
 */
export default function ProductosPage() {
  const { branches, inScope, can } = useSession();
  const sedes = branches.filter((b) => b.isActive && inScope(b.id));
  const [sede, setSede] = useState(sedes[0]?.id ?? '');
  const [editar, setEditar] = useState<Producto | 'nuevo' | null>(null);
  const [ajustar, setAjustar] = useState<Producto | null>(null);

  // Con la red caída ya no es «Sin productos» (26-01): se dice y se reintenta.
  const cargar = useCallback(async () => {
    const [p, inv] = await Promise.all([
      api<{ products: Producto[] }>('/products?includeInactive=true'),
      sede ? api<{ stock: Array<{ productId: string; quantityOnHand: number }> }>(`/inventory?branchId=${sede}`) : Promise.resolve({ stock: [] }),
    ]);
    return { productos: p.products, stock: new Map(inv.stock.map((s) => [s.productId, s.quantityOnHand])) };
  }, [sede]);
  const carga = useCarga(cargar);
  const stock = carga.datos?.stock ?? new Map<string, number>();
  // El libro se vuelve a pedir cuando se registra un movimiento.
  const [version, setVersion] = useState(0);
  const verLibro = can('pos:inventory:adjust') || can('reports:financial:read');

  return (
    <div className="stack gap-20">
      <PageHeader title="Productos" sub="El catálogo del punto de venta y sus existencias por sucursal."
        actions={<>
          {sedes.length > 1 && (
            <select className="select w-auto" aria-label="Sucursal" value={sede} onChange={(e) => setSede(e.target.value)}>
              {sedes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {can('pos:product:manage') && <Button icon={<Plus />} onClick={() => setEditar('nuevo')}>Nuevo producto</Button>}
        </>} />
      <Card pad={false}>
        <EstadoCarga carga={carga} titulo="No se pudieron cargar los productos" relleno esqueleto={<EsqueletoTabla />} esVacio={(d) => d.productos.length === 0}
          vacio={<Empty icon={<Package />} title="Sin productos" text="Agrega lo que vendes en el mostrador: agua, bebidas, suplementos, accesorios."
            action={can('pos:product:manage') ? <Button icon={<Plus />} onClick={() => setEditar('nuevo')}>Nuevo producto</Button> : undefined} />}>
          {({ productos }) => (
          <div className="table-wrap">
            <table className="table table-stack">
              <thead><tr><th>Producto</th><th>SKU</th><th className="num">Precio</th><th className="num">Socios</th>{conCosto(productos) && <><th className="num">Costo</th><th className="num">Deja</th></>}<th className="num">Existencia</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {productos.map((p) => {
                  const hay = stock.get(p.id) ?? 0;
                  return (
                    <tr key={p.id} style={p.isActive ? undefined : { opacity: .55 }}>
                      <td className="strong">{p.name}</td>
                      <td className="stack-hide"><code>{p.sku}</code></td>
                      <td className="num" data-label="Precio">{pesos(p.priceCents)}</td>
                      <td className="num" data-label="Socios">{p.memberPriceCents != null ? pesos(p.memberPriceCents) : <span className="muted">El mismo</span>}</td>
                      {conCosto(productos) && <>
                        <td className="num" data-label="Costo">{p.costCents != null ? pesos(p.costCents) : <span className="muted">Sin costo</span>}</td>
                        <td className="num" data-label="Deja">{p.costCents != null ? pesos(BigInt(p.priceCents) - BigInt(p.costCents)) : <span className="muted">—</span>}</td>
                      </>}
                      <td className="num" data-label="Existencia">{p.tracksInventory ? <span className={hay <= 3 ? 'danger strong' : ''}>{hay}</span> : <span className="muted">No se controla</span>}</td>
                      <td>{p.isActive ? <Badge tone="ok" dot>A la venta</Badge> : <Badge>Retirado</Badge>}</td>
                      <td className="right text-right nowrap">
                        {p.tracksInventory && can('pos:inventory:adjust') && <Button size="sm" variant="ghost" icon={<PackagePlus />} onClick={() => setAjustar(p)}>Existencias</Button>}
                        {can('pos:product:manage') && <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditar(p)}>Editar</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </EstadoCarga>
      </Card>
      {editar && <ProductoDialog producto={editar === 'nuevo' ? null : editar} onClose={() => setEditar(null)} onListo={() => { setEditar(null); void carga.recargar(); }} />}
      {verLibro && sede && <LibroDeInventario key={`${sede}-${version}`} sede={sede} />}
      {ajustar && <ExistenciasDialog producto={ajustar} sede={sede} actual={stock.get(ajustar.id) ?? 0} onClose={() => setAjustar(null)} onListo={() => { setAjustar(null); setVersion((v) => v + 1); void carga.recargar(); }} />}
    </div>
  );
}

/**
 * EL LIBRO DE INVENTARIO de la sucursal (8-02): cada entrada, venta, ajuste
 * por conteo y merma, con su motivo y quién lo registró. Antes los
 * movimientos se escribían y no había dónde leerlos: «¿cuánto se mermó este
 * mes y quién lo anotó?» obligaba a buscar en la bitácora.
 */
const TIPOS = ['PURCHASE', 'SALE', 'SALE_VOIDED', 'ADJUSTMENT', 'SHRINKAGE', 'TRANSFER_IN', 'TRANSFER_OUT'] as const;

function LibroDeInventario({ sede }: { sede: string }) {
  const { branchName } = useSession();
  const toast = useToast();
  const [tipo, setTipo] = useState<'' | (typeof TIPOS)[number]>('');
  const [filas, setFilas] = useState<InventoryMovement[] | null>(null);
  const [resto, setResto] = useState<{ total: number; cursor: string | null }>({ total: 0, cursor: null });
  const [fallo, setFallo] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const url = useCallback((cursor?: string) => `/inventory/movements?branchId=${sede}${tipo ? `&movementType=${tipo}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, [sede, tipo]);

  const cargar = useCallback(async () => {
    setFallo(null);
    try {
      const r = await api<InventoryMovementList>(url());
      setFilas(r.items); setResto({ total: r.total, cursor: r.nextCursor });
    } catch (e) { setFallo(errorText(e, 'No se pudieron cargar los movimientos')); }
  }, [url]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function cargarMas() {
    if (!resto.cursor) return;
    setPidiendo(true);
    try {
      const r = await api<InventoryMovementList>(url(resto.cursor));
      setFilas((a) => [...(a ?? []), ...r.items]); setResto({ total: r.total, cursor: r.nextCursor });
    } catch (e) { toast('error', errorText(e, 'No se pudieron cargar más movimientos')); } finally { setPidiendo(false); }
  }

  return (
    <Card pad={false} title="Movimientos de inventario" data-testid="libro-inventario"
      sub={`${branchName(sede)} · del más reciente al más viejo${filas && resto.total > 0 ? ` · ${filas.length < resto.total ? `se muestran ${filas.length} de ${resto.total}` : `${resto.total} en total`}` : ''}`}
      actions={(
        <select className="select w-auto" aria-label="Tipo de movimiento" value={tipo} onChange={(e) => { setFilas(null); setTipo(e.target.value as typeof tipo); }}>
          <option value="">Todos los movimientos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{MOVIMIENTO_DE_INVENTARIO[t]}</option>)}
        </select>
      )}
      footer={resto.cursor ? <Button size="sm" variant="secondary" loading={pidiendo} onClick={() => void cargarMas()}>Cargar más</Button> : undefined}>
      {fallo ? <div className="card-body"><ErrorCarga mensaje={fallo} onReintentar={() => void cargar()} /></div>
        : filas === null ? <EsqueletoTabla filas={4} />
          : filas.length === 0 ? <Empty icon={<ClipboardList />} title="Sin movimientos" text={tipo ? 'No hay movimientos de ese tipo en esta sucursal.' : 'Aquí quedan las entradas de mercancía, las ventas, los conteos y las mermas.'} />
            : (
              <div className="table-wrap">
                <table className="table table-stack">
                  <thead><tr><th>Cuándo</th><th>Producto</th><th>Movimiento</th><th className="num">Cantidad</th><th>Motivo</th><th>Registró</th></tr></thead>
                  <tbody>
                    {filas.map((m) => (
                      <tr key={m.id}>
                        <td className="small muted nowrap" data-label="Cuándo">{fechaHora(m.at)}</td>
                        <td className="strong stack-full">{m.productName ?? <span className="muted">Producto borrado</span>}</td>
                        <td data-label="Movimiento">{etiqueta(MOVIMIENTO_DE_INVENTARIO, m.movementType, m.movementType)}</td>
                        <td className={`num strong${m.quantityDelta < 0 ? ' danger' : ''}`} data-label="Cantidad">{m.quantityDelta > 0 ? '+' : '−'}{Math.abs(m.quantityDelta)}</td>
                        <td className="small" data-label="Motivo">{m.reason ?? <span className="muted">—</span>}</td>
                        <td className="small" data-label="Registró">{m.createdByName ?? <span className="muted">Ya no está en el personal</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </Card>
  );
}

/** ¿La lista trae costos? Solo se los manda la API a quien administra el catálogo. */
const conCosto = (ps: readonly Producto[]) => ps.some((p) => p.costCents !== undefined);
const enPesos = (c: string | null | undefined) => (c != null ? (Number(c) / 100).toFixed(2) : '');

function ProductoDialog({ producto, onClose, onListo }: { producto: Producto | null; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  // Opcionales (D-21): vacío = no tiene.
  const [socio, setSocio] = useState(enPesos(producto?.memberPriceCents));
  const [costo, setCosto] = useState(enPesos(producto?.costCents));
  const [sku, setSku] = useState(producto?.sku ?? '');
  const [nombre, setNombre] = useState(producto?.name ?? '');
  const [precio, setPrecio] = useState(producto ? (Number(producto.priceCents) / 100).toFixed(2) : '');
  const [inventario, setInventario] = useState(producto?.tracksInventory ?? true);
  const [activo, setActivo] = useState(producto?.isActive ?? true);
  const [enviando, setEnviando] = useState(false);
  const cents = aCentavos(precio);
  const socioCents = socio.trim() ? aCentavos(socio) : null;
  const costoCents = costo.trim() ? aCentavos(costo) : null;
  const errorSocio = socio.trim() && socioCents === null ? 'Importe inválido'
    : socioCents !== null && cents !== null && socioCents > cents ? 'No puede ser mayor que el precio de público' : null;
  const errorCosto = costo.trim() && costoCents === null ? 'Importe inválido' : null;
  const deja = cents !== null && costoCents !== null ? cents - costoCents : null;

  async function guardar() {
    setEnviando(true);
    try {
      // `null` quita el precio de socio o el costo; lo ya vendido conserva los suyos.
      const opcionales = { memberPriceCents: socioCents === null ? null : socioCents.toString(), costCents: costoCents === null ? null : costoCents.toString() };
      if (producto) {
        await api(`/products/${producto.id}`, { method: 'PATCH', body: JSON.stringify({ name: nombre.trim(), priceCents: cents!.toString(), isActive: activo, ...opcionales }) });
      } else {
        await api('/products', { method: 'POST', body: JSON.stringify({ sku: sku.trim().toUpperCase(), name: nombre.trim(), priceCents: cents!.toString(), tracksInventory: inventario, ...opcionales }) });
      }
      toast('ok', producto ? 'Producto actualizado' : 'Producto dado de alta');
      onListo();
    } catch (e) { toast('error', errorText(e, 'No se pudo guardar')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={producto ? `Editar ${producto.name}` : 'Nuevo producto'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={enviando} disabled={!nombre.trim() || cents === null || (!producto && !sku.trim()) || !!errorSocio || !!errorCosto} onClick={() => void guardar()}>Guardar</Button></>}>
      <div className="stack">
        {!producto && <Field label="SKU" htmlFor="pr-sku" hint="Clave corta, sin espacios: AGUA-600, PROT-VAIN."><input id="pr-sku" className="input mono" autoFocus value={sku} onChange={(e) => setSku(e.target.value)} /></Field>}
        <Field label="Nombre" htmlFor="pr-nom"><input id="pr-nom" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Agua natural 600 ml" /></Field>
        <Field label="Precio de público" htmlFor="pr-pre" hint={producto ? 'El cambio queda en la bitácora con el precio anterior.' : undefined}>
          <div className="input-money"><span>$</span><input id="pr-pre" className="input" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0.00" /></div>
        </Field>
        <div className="grid grid-2 gap-12">
          <Field label="Precio de socio" htmlFor="pr-soc" required={false} error={errorSocio} hint="Opcional. Se cobra a socios con membresía vigente; vacío, todos pagan el de público.">
            <div className="input-money"><span>$</span><input id="pr-soc" className="input" inputMode="decimal" value={socio} onChange={(e) => setSocio(e.target.value)} placeholder="El mismo" /></div>
          </Field>
          <Field label="Costo" htmlFor="pr-cos" required={false} error={errorCosto}
            hint={deja !== null ? `Deja ${pesos(deja)} por pieza a precio de público.` : 'Opcional. Lo que te cuesta a ti: con él el Tablero resta lo que costó lo vendido.'}>
            <div className="input-money"><span>$</span><input id="pr-cos" className="input" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Sin costo" /></div>
          </Field>
        </div>
        {!producto && <Switch checked={inventario} onChange={(v) => setInventario(v)}>Controlar existencias (no se vende si se agota)</Switch>}
        {producto && <Switch checked={activo} onChange={(v) => setActivo(v)}>A la venta</Switch>}
      </div>
    </Dialog>
  );
}

function ExistenciasDialog({ producto, sede, actual, onClose, onListo }: { producto: Producto; sede: string; actual: number; onClose: () => void; onListo: () => void }) {
  const toast = useToast();
  const { branchName } = useSession();
  const [tipo, setTipo] = useState<(typeof MOVIMIENTOS)[number]['value']>('PURCHASE');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const def = MOVIMIENTOS.find((m) => m.value === tipo)!;
  const n = Number(cantidad);
  // En el ajuste por conteo se escribe lo que HAY; el sistema calcula la diferencia.
  const delta = def.signo === 0 ? n - actual : def.signo * n;
  const valido = Number.isInteger(n) && cantidad !== '' && (def.signo === 0 ? n >= 0 && delta !== 0 : n > 0) && motivo.trim().length >= 3;

  async function registrar() {
    setEnviando(true);
    try {
      await api('/inventory/movements', { method: 'POST', body: JSON.stringify({ branchId: sede, productId: producto.id, movementType: tipo, quantityDelta: delta, reason: motivo.trim() }) });
      toast('ok', `Existencia de ${producto.name}: ${actual + delta}`);
      onListo();
    } catch (e) { toast('error', errorText(e, 'No se pudo registrar')); } finally { setEnviando(false); }
  }

  return (
    <Dialog open onClose={onClose} title={`Existencias · ${producto.name}`} sub={`${branchName(sede)} · hoy hay ${actual}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} disabled={!valido} onClick={() => void registrar()}>Registrar</Button></>}>
      <div className="stack">
        <Field label="Movimiento" htmlFor="ex-tipo">
          <select id="ex-tipo" className="select" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            {MOVIMIENTOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label={def.signo === 0 ? 'Cuántos hay contados' : 'Cantidad'} htmlFor="ex-n"
          hint={def.signo === 0 && cantidad !== '' && Number.isInteger(n) ? `Diferencia: ${delta > 0 ? '+' : ''}${delta}` : undefined}>
          <input id="ex-n" className="input" type="number" min={0} value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </Field>
        <Field label="Motivo" htmlFor="ex-mot"><input id="ex-mot" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={def.value === 'PURCHASE' ? 'Pedido del proveedor, factura 1234' : 'Conteo semanal'} /></Field>
      </div>
    </Dialog>
  );
}
