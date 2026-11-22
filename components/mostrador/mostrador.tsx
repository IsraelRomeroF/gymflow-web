'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, RotateCw, Search, UserPlus, UserSearch } from 'lucide-react';
import { pesos, telefono } from '@/lib/format';
import { codigoExacto, useBuscarSocios, type SocioHallado } from '@/lib/buscar-socios';
import { useResumenAccesoPorLotes } from '@/lib/resumen-acceso';
import { AccesoBadge } from '@/components/acceso';
import { useSession } from '@/components/session';
import { Avatar, Badge, Button, Card, Dialog, Empty, ErrorCarga } from '@/components/ui';
import { IconButton } from '@/components/compartido';
import { EntradaDialog } from '@/components/entrada';
import { TarjetaSocio } from './tarjeta-socio';

/** Desde este ancho la tarjeta va en su columna; por debajo, en una hoja (teléfono) o diálogo (tableta). */
const ANCHO_DE_COLUMNA = '(min-width: 1024px)';
function useCabeLaColumna(): boolean {
  return useSyncExternalStore(
    (avisar) => { const m = window.matchMedia(ANCHO_DE_COLUMNA); m.addEventListener('change', avisar); return () => m.removeEventListener('change', avisar); },
    () => window.matchMedia(ANCHO_DE_COLUMNA).matches,
    () => true,
  );
}

/**
 * EL MOSTRADOR (auditoría 8, bloque 2.1; 1-03, 2-08, 2-09, A1-T2): buscar a
 * un socio y atenderlo ahí mismo. Un solo componente para los tres lugares
 * donde se atiende —el inicio de recepción, `/socios` y Caja—, con la misma
 * búsqueda (`useBuscarSocios`) y la misma tarjeta (`TarjetaSocio`).
 *
 * Lo que se conserva de `/socios` (5-01, 5-22): la lista EN ESPERA mientras
 * llega la respuesta de lo último tecleado (atenuada, y nada se registra sobre
 * ella), el código exacto + Enter que registra al socio correcto aunque el
 * Enter llegue antes que la respuesta, Enter abre la ficha y Ctrl+Enter
 * registra la entrada.
 *
 * Lo nuevo: el resultado elegido (el primero, o el que marquen las flechas o
 * un clic) muestra su tarjeta al lado; en teléfono y tableta la tarjeta sale
 * como hoja al tocar la fila. Las filas ya no llevan botones.
 */
export function Mostrador({
  etiqueta = 'Buscar socio', marcador = 'Nombre, código o teléfono', grande = true, autoFoco = false, consultaInicial = '',
  limite = 20, sedeDeCobro, onCambio, onRegistrar, onBuscando, pegajoso = false, ayuda = true, testid = 'resultados',
}: {
  etiqueta?: string; marcador?: string;
  /** El buscador alto del mostrador (`--h-lg`); en Caja va normal. */
  grande?: boolean;
  autoFoco?: boolean; consultaInicial?: string; limite?: number;
  /** La sucursal de la caja desde donde se atiende: va primero al cobrar. */
  sedeDeCobro?: string;
  /** Se cobró, se vendió o se registró una entrada. */
  onCambio?: () => void;
  /** «Registrar a …» cuando nadie coincide: quien lo pinta abre el alta. Sin él, no se ofrece. */
  onRegistrar?: (nombre: string) => void;
  /** Avisa si hay búsqueda en curso: `/socios` esconde el padrón mientras tanto. */
  onBuscando?: (buscando: boolean) => void;
  /** El buscador se queda arriba al desplazar (teléfono, 2-09). */
  pegajoso?: boolean;
  /** La línea de atajos de teclado. */
  ayuda?: boolean;
  testid?: string;
}): ReactNode {
  const router = useRouter();
  const { can, branchName, inScope } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(consultaInicial);
  useEffect(() => { if (consultaInicial) setQuery(consultaInicial); }, [consultaInicial]);
  useEffect(() => { if (autoFoco) inputRef.current?.focus(); }, [autoFoco]);

  const { hallados, consulta, enEspera, fallo, reintentar } = useBuscarSocios(query, { limit: limite, delay: 160 });
  const buscando = query.trim().length >= 2;
  useEffect(() => { onBuscando?.(buscando); }, [buscando, onBuscando]);
  const verDinero = can('billing:statement:read');

  // Su sede primero y las demás marcadas (DA-19): el orden del servidor se respeta dentro de cada grupo.
  const resultados: SocioHallado[] = hallados
    ? [...hallados.filter((m) => !m.homeBranchId || inScope(m.homeBranchId)), ...hallados.filter((m) => m.homeBranchId && !inScope(m.homeBranchId))]
    : [];

  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); setHoja(null); }, [consulta]);
  const elegido = resultados[sel] ?? null;
  const cabeColumna = useCabeLaColumna();
  // En pantallas angostas la tarjeta sale solo cuando se toca una fila.
  const [hoja, setHoja] = useState<string | null>(null);
  const enHoja = !cabeColumna && hoja ? resultados.find((m) => m.id === hoja) ?? null : null;

  const [version, setVersion] = useState(0);
  const { mapa: acceso, fallo: falloAcceso, reintentar: reintentarAcceso } = useResumenAccesoPorLotes(resultados.map((m) => m.id), String(version));
  const [entrada, setEntrada] = useState<SocioHallado | null>(null);

  const limpiar = useCallback(() => { setQuery(''); setHoja(null); inputRef.current?.focus(); }, []);
  const cambio = useCallback(() => { setVersion((v) => v + 1); reintentar(); onCambio?.(); }, [reintentar, onCambio]);

  // Enter que llegó mientras la respuesta venía en camino (el lector de código
  // teclea el código y Enter en milisegundos): se resuelve cuando llega SU respuesta.
  const pendiente = useRef<string | null>(null);
  /** Enter con la lista vigente. Un código exacto registra la entrada directo; si no, Enter abre la ficha y Ctrl+Enter, la entrada. */
  const actuar = useCallback((rs: readonly SocioHallado[], q: string, i: number, conCtrl: boolean) => {
    const puedeEntrada = (m: SocioHallado) => can('access:monitor') && m.status !== 'ARCHIVED';
    const exacto = codigoExacto(rs, q);
    if (exacto) { if (puedeEntrada(exacto)) setEntrada(exacto); else router.push(`/socios/${exacto.id}`); return; }
    const m = rs[i];
    if (!m) return;
    if (conCtrl && puedeEntrada(m)) setEntrada(m);
    else router.push(`/socios/${m.id}`);
  }, [can, router]);
  useEffect(() => {
    if (!hallados || pendiente.current === null || consulta !== pendiente.current.trim()) return;
    const q = pendiente.current;
    pendiente.current = null;
    // Solo un código exacto actúa solo; lo demás espera a que recepción vea la lista nueva.
    if (codigoExacto(hallados, q)) actuar(hallados, q, 0, false);
  }, [hallados, consulta, actuar]);

  /** La insignia de acceso; si su lote no cargó, «sin dato» con reintento en vez de «…» para siempre. */
  const insignia = (m: SocioHallado) => (falloAcceso && !acceso.has(m.id) && m.status !== 'ARCHIVED'
    ? <span className="row gap-4" title="No se pudo saber si puede entrar">
        <Badge tone="warn" dot>Sin dato</Badge>
        <IconButton label="Reintentar saber si puede entrar" onClick={(e) => { e.stopPropagation(); reintentarAcceso(); }}><RotateCw /></IconButton>
      </span>
    : <AccesoBadge resumen={acceso.get(m.id)} archivado={m.status === 'ARCHIVED'} />);

  const elegir = (m: SocioHallado, i: number) => { if (enEspera) return; setSel(i); if (!cabeColumna) setHoja(m.id); };
  const ofrecerAlta = !!onRegistrar && can('members:create') && !!consulta && !/\d{4}/.test(consulta);
  const tarjeta = (m: SocioHallado) => (
    <TarjetaSocio key={m.id} socio={m} resumen={acceso.get(m.id)} enEspera={enEspera} sedeDeCobro={sedeDeCobro}
      onCambio={cambio} onEntrada={() => { setHoja(null); limpiar(); }} />
  );

  return (
    <div className="mostrador" data-testid="mostrador">
      <div className={pegajoso ? 'mostrador-buscador es-pegajoso' : 'mostrador-buscador'}>
        <div className="input-icon">
          <Search />
          <input
            ref={inputRef} className={grande ? 'input input-lg' : 'input'} value={query} autoComplete="off" aria-label={etiqueta} placeholder={marcador}
            onChange={(e) => { pendiente.current = null; setQuery(e.target.value); }}
            onKeyDown={(e) => {
              const n = resultados.length;
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, n - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Escape' && query) { e.stopPropagation(); pendiente.current = null; setQuery(''); }
              // Con la lista en espera no se actúa sobre ella: el Enter espera a SU respuesta (5-01).
              if (e.key === 'Enter' && buscando) {
                if (enEspera) { pendiente.current = query; return; }
                if (hallados) actuar(resultados, query, sel, e.ctrlKey || e.metaKey);
              }
            }}
          />
        </div>
        <div className="mostrador-linea tiny muted">
          <span aria-live="polite">{buscando && (enEspera ? <>Buscando «{query.trim()}»…</> : hallados && <>{resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'}</>)}</span>
          {ayuda && <span className="ayuda-teclado"><kbd>↑</kbd> <kbd>↓</kbd> elegir · <kbd>Enter</kbd> abrir ficha{can('access:monitor') && <> · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> o código + <kbd>Enter</kbd> registrar entrada</>}</span>}
        </div>
      </div>

      {/* Sin red no es "sin resultados" (MC-16): el error ocupa el lugar del resultado. */}
      {buscando && fallo && <div className="mb-12"><ErrorCarga mensaje="No se pudo buscar. Revisa la conexión." onReintentar={reintentar} /></div>}

      {/* En espera: la lista de la búsqueda anterior se atenúa y no responde (5-01). */}
      {buscando && hallados && (
        <div className="mostrador-cuerpo" data-testid={testid} aria-busy={enEspera || undefined} data-en-espera={enEspera || undefined}>
          {resultados.length === 0 ? (
            <Card className="mostrador-vacio"><Empty icon={<UserSearch />} title="Sin resultados" text={`Nadie coincide con «${consulta}». Revisa la ortografía o busca por teléfono.`}
              action={ofrecerAlta && <Button size="sm" icon={<UserPlus />} disabled={enEspera} onClick={() => onRegistrar!(consulta!)}>Registrar a «{consulta}»</Button>} /></Card>
          ) : (
            <div className="mostrador-rejilla">
              <div className="mostrador-lista">
                <Card pad={false}>
                  <ul className="list">
                    {resultados.map((m, i) => {
                      const debe = m.balanceCents !== null && BigInt(m.balanceCents) > 0n;
                      const ajeno = !!m.homeBranchId && !inScope(m.homeBranchId);
                      return (
                        <li key={m.id} className="list-item is-link mostrador-fila" data-elegido={i === sel || undefined} onClick={() => elegir(m, i)}>
                          <Avatar name={`${m.firstName} ${m.lastName}`} size={40} />
                          <div className="mostrador-fila-quien">
                            <button type="button" className="strong ellipsis row-link" disabled={enEspera} aria-current={i === sel ? 'true' : undefined}
                              onClick={(e) => { e.stopPropagation(); elegir(m, i); }}>{m.firstName} {m.lastName}</button>
                            <div className="tiny muted ellipsis"><code>{m.memberCode}</code> · {telefono(m.phoneE164)} · {ajeno ? <span className="mostrador-ajeno">{branchName(m.homeBranchId)}</span> : branchName(m.homeBranchId)}</div>
                          </div>
                          {debe && verDinero && <Badge tone="danger">Debe {pesos(m.balanceCents!)}</Badge>}
                          {insignia(m)}
                          <ChevronRight size={16} className="faint mostrador-fila-fin" />
                        </li>
                      );
                    })}
                  </ul>
                </Card>
                {/* La búsqueda tolera errores: casi siempre hay parecidos. Si no es ninguno, también se registra desde aquí. */}
                {ofrecerAlta && (
                  <div className="mostrador-alta">
                    <Button variant="ghost" size="sm" icon={<UserPlus />} disabled={enEspera} onClick={() => onRegistrar!(consulta!)}>¿No es ninguno? Registrar a «{consulta}»</Button>
                  </div>
                )}
              </div>
              {cabeColumna && elegido && <aside className="mostrador-columna">{tarjeta(elegido)}</aside>}
            </div>
          )}
        </div>
      )}

      {enHoja && (
        <Dialog open onClose={() => setHoja(null)} title="Atender">
          {tarjeta(enHoja)}
        </Dialog>
      )}
      {entrada && (
        <EntradaDialog memberId={entrada.id} memberName={entrada.firstName}
          onClose={() => { setEntrada(null); inputRef.current?.focus(); }}
          onDone={() => { setEntrada(null); cambio(); limpiar(); }} />
      )}
    </div>
  );
}
