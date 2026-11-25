'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, CornerDownLeft } from 'lucide-react';
import { pesos, telefono } from '@gymflow/ui/format';
import { MEMBER_STATUS } from '@/lib/labels';
import { useBuscarSocios, type SocioHallado } from '@/lib/buscar-socios';
import { Avatar, Badge } from './ui';
import { useSession } from './session';
import { buscarSecciones } from '@/modules/registro';
import { IconTile } from '@gymflow/ui/compartido';
import { TarjetaSocio } from './mostrador/tarjeta-socio';

/**
 * Buscador global (Ctrl K). Tolera errores de captura igual que recepción: es
 * LA búsqueda del panel (`useBuscarSocios`), a un atajo de distancia.
 *
 * Elegir a un socio abre aquí mismo su tarjeta (bloque 2.1, A1-T2): la misma
 * de Socios, del inicio y de Caja, con Entrada, Cobrar, Vender y Clase. Antes
 * llevaba a la ficha y desde ahí había que empezar. La ficha sigue a un clic
 * («Ver su ficha»), y Esc regresa a la lista.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { can, mirada } = useSession();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [elegido, setElegido] = useState<SocioHallado | null>(null);
  // Quien no ve el padrón busca solo pantallas.
  const buscaSocios = can('members:read');
  const input = useRef<HTMLInputElement>(null);
  // El buscador no interrumpe: sin red se queda sin resultados de socios.
  const { hallados, consulta, enEspera } = useBuscarSocios(open ? q : '', { limit: 8, delay: 150, activa: buscaSocios });
  const items = hallados ?? [];

  useEffect(() => {
    if (open) { setQ(''); setSel(0); setElegido(null); setTimeout(() => input.current?.focus(), 10); }
  }, [open]);
  useEffect(() => { setSel(0); }, [consulta]);

  if (!open) return null;

  // Las pantallas que esta persona ve hoy: "caja", "gastos" u "horario" llevan a su sección.
  const secciones = buscarSecciones(q, mirada);
  const irA = (href: string) => { onClose(); router.push(href); };
  const volver = () => { setElegido(null); setTimeout(() => input.current?.focus(), 10); };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog cmd" role="dialog" aria-modal="true" aria-label="Buscar"
        onKeyDown={(e) => { if (e.key === 'Escape' && elegido && !e.defaultPrevented) { e.stopPropagation(); volver(); } }}>
        {elegido ? (
          <div className="cmd-tarjeta" data-testid="cmd-tarjeta">
            <button type="button" className="btn btn-ghost btn-sm" onClick={volver}><ArrowLeft />Volver a la búsqueda</button>
            <TarjetaSocio socio={elegido} onIrAFicha={onClose} onEntrada={onClose} />
          </div>
        ) : (
          <>
            <div className="cmd-input">
              <Search />
              <input
                ref={input} value={q} placeholder="Socio por nombre, código o teléfono; o una pantalla…" autoComplete="off"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose();
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  // Con la lista en espera no se elige a nadie: es de la búsqueda anterior (5-01).
                  if (e.key === 'Enter' && enEspera) return;
                  if (e.key === 'Enter' && items[sel]) setElegido(items[sel]);
                  else if (e.key === 'Enter' && items.length === 0 && secciones[0]) irA(secciones[0].href);
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="cmd-list" aria-busy={enEspera || undefined}>
              {q.trim().length < 2 && (
                <p className="muted small cmd-nota">
                  Escribe al menos dos letras. Funciona con errores de captura: «Martinz» encuentra a Martínez.
                </p>
              )}
              {secciones.map((sec) => {
                const Icono = sec.icono;
                return (
                  <div key={sec.href} className="cmd-item" role="link" tabIndex={0} onClick={() => irA(sec.href)}
                    onKeyDown={(e) => { if (e.key === 'Enter') irA(sec.href); }}>
                    <IconTile><Icono /></IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="strong ellipsis">Ir a {sec.etiqueta}</div>
                      <div className="tiny muted">Pantalla</div>
                    </div>
                  </div>
                );
              })}
              {q.trim().length >= 2 && !enEspera && items.length === 0 && secciones.length === 0 && (
                <p className="muted small cmd-nota">Sin coincidencias para «{q}».</p>
              )}
              {items.map((m, i) => {
                const st = MEMBER_STATUS[m.status];
                const debe = m.balanceCents !== null && BigInt(m.balanceCents) > 0n;
                return (
                  <div
                    key={m.id} className="cmd-item" aria-selected={i === sel} data-en-espera={enEspera || undefined}
                    onMouseEnter={() => setSel(i)} onClick={() => { if (!enEspera) setElegido(m); }}
                  >
                    <Avatar name={`${m.firstName} ${m.lastName}`} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="strong ellipsis">{m.firstName} {m.lastName}</div>
                      <div className="tiny muted"><code>{m.memberCode}</code> · {telefono(m.phoneE164)}</div>
                    </div>
                    {debe && <Badge tone="danger">Debe {pesos(m.balanceCents!, { decimals: false })}</Badge>}
                    {st && <Badge tone={st.tone === 'neutral' ? undefined : st.tone} dot>{st.label}</Badge>}
                  </div>
                );
              })}
            </div>
            <div className="cmd-foot">
              <span><kbd>↑</kbd> <kbd>↓</kbd> moverse</span>
              <span className="row gap-6"><kbd><CornerDownLeft size={10} /></kbd> atender al socio</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
