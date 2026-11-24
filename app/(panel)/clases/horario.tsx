'use client';

import { useMemo } from 'react';
import { Clock, Pencil, Plus, RotateCcw, Trash2, UserRound, Users } from 'lucide-react';
import { fechaCorta, pesos } from '@/lib/format';
import { DIAS, aHora, type Plantilla, type Slot, type Tipo } from '@/lib/clases';
import { Badge, Button, Card, MenuMas, Skeleton } from '@/components/ui';
import { PausasCard, ReglasCard } from './reglas';

/**
 * HORARIO: qué clases se dan, la semana tipo, las pausas por fechas y las
 * reglas de reserva. Es consulta para recepción y coach (11-17: antes ocupaba
 * media pantalla de su vista de trabajo) y el lugar donde la gerencia arma.
 *
 * Un bloque del horario se abre para editarlo (11-06): hora, días, cupo,
 * salón, coach y hasta cuándo, sin cancelar las reservas que ya existen.
 */
export function Horario({ sede, tipos, plantillas, weekdayHoy, gestiona, cancela, onNuevaClase, onEditarTipo, onRetirarTipo, onReactivar, onNuevoBloque, onEditarHorario, alCambiar }: {
  sede: string; tipos: Tipo[]; plantillas: Plantilla[] | null;
  /** Qué día de la semana es hoy en la sucursal (0 = domingo). */
  weekdayHoy: number;
  gestiona: boolean;
  /** Dejar de dar una clase cancela sus sesiones: solo la gerencia (D-28). */
  cancela: boolean;
  onNuevaClase: () => void; onEditarTipo: (t: Tipo) => void; onRetirarTipo: (t: Tipo) => void; onReactivar: (t: Tipo) => void;
  onNuevoBloque: (weekday: number) => void; onEditarHorario: (p: Plantilla) => void;
  /** Una pausa puesta o quitada cambia las sesiones: la página las vuelve a pedir. */
  alCambiar: () => void;
}) {
  const activos = tipos.filter((t) => t.isActive);
  const retirados = tipos.filter((t) => !t.isActive);
  const horariosDe = (tipoId: string) => (plantillas ?? []).filter((p) => p.classTypeId === tipoId);

  /** Bloques del horario semanal, por día. */
  const porDia = useMemo(() => {
    const m = new Map<number, Array<Slot & { plantilla: Plantilla }>>();
    for (const p of plantillas ?? []) for (const s of p.slots) m.set(s.weekday, [...(m.get(s.weekday) ?? []), { ...s, plantilla: p }]);
    for (const xs of m.values()) xs.sort((a, b) => a.startMinute - b.startMinute);
    return m;
  }, [plantillas]);

  const contenido = (b: Slot & { plantilla: Plantilla }) => (
    <>
      <span className="bloque-hora">{aHora(b.startMinute)}</span>
      <span className="bloque-nombre">{b.plantilla.className}</span>
      <span className="bloque-meta">{b.durationMin} min · {b.capacity} lugares{b.plantilla.room ? ` · ${b.plantilla.room}` : ''}</span>
      <span className="bloque-meta row gap-4" data-sin-coach={(gestiona && !b.plantilla.coachName) || undefined}><UserRound size={11} />{b.plantilla.coachName ?? (gestiona ? 'Asignar coach' : 'Sin coach')}</span>
      {b.plantilla.until && <span className="bloque-meta">hasta el {fechaCorta(b.plantilla.until)}</span>}
    </>
  );

  return (
    <>
      {activos.length > 0 && (
        <section className="mb-28">
          <div className="row-between mb-12">
            <h2 className="section-title m-0">Horario semanal</h2>
            <span className="small muted">{gestiona ? 'Toca un bloque para editarlo. Las sesiones de las próximas 3 semanas se generan solas' : 'Las sesiones de las próximas 3 semanas se generan solas'}</span>
          </div>
          {plantillas === null ? <Skeleton h={260} r={16} /> : (
            <div className="card semana-card">
              <div className="semana">
                {DIAS.map((d) => (
                  <div key={d.w} className="semana-dia" data-hoy={d.w === weekdayHoy || undefined} data-vacio={(porDia.get(d.w) ?? []).length === 0 || undefined}>
                    <div className="semana-cab"><span className="semana-corto">{d.corto}</span><span className="semana-largo">{d.largo}</span>{d.w === weekdayHoy && <span className="semana-hoy">hoy</span>}</div>
                    {(porDia.get(d.w) ?? []).map((b) => (gestiona ? (
                      // El bloque entero abre «Editar»; quitar el horario vive dentro, con su confirmación (antes era una «×» al pasar el cursor).
                      <button key={`${b.plantilla.id}-${b.startMinute}`} type="button" className="bloque bloque-editable" onClick={() => onEditarHorario(b.plantilla)}
                        aria-label={`Cambiar ${b.plantilla.className ?? 'la clase'} del ${d.largo} a las ${aHora(b.startMinute)}`}>
                        {contenido(b)}
                      </button>
                    ) : <div key={`${b.plantilla.id}-${b.startMinute}`} className="bloque">{contenido(b)}</div>))}
                    {gestiona && (
                      <button type="button" className="bloque-nuevo" onClick={() => onNuevoBloque(d.w)} aria-label={`Agregar clase el ${d.largo}`}>
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {activos.length > 0 && (
        <section className="mb-28">
          <div className="row-between mb-12">
            <h2 className="section-title m-0">Clases que se dan</h2>
            {gestiona && <Button size="sm" variant="secondary" icon={<Plus />} onClick={onNuevaClase}>Nueva clase</Button>}
          </div>
          <div className="grid grid-3">
            {activos.map((t) => {
              const bloques = horariosDe(t.id).reduce((a, h) => a + h.slots.length, 0);
              return (
                <Card key={t.id} pad={false}>
                  <div className="card-body stack-sm">
                    <div className="row-between flex-wrap gap-6">
                      <span className="strong tipo-nombre">{t.name}</span>
                      {bloques > 0 ? <Badge tone="ok" dot>{bloques} {bloques === 1 ? 'sesión' : 'sesiones'} / semana</Badge> : <Badge tone="warn" dot>Sin horario aquí</Badge>}
                    </div>
                    {t.description && <p className="small muted">{t.description}</p>}
                    <div className="row wrap tiny muted tipo-datos">
                      <span className="row gap-4"><Clock size={13} />{t.defaultDurationMin} min</span>
                      <span className="row gap-4"><Users size={13} />cupo {t.defaultCapacity}</span>
                      <span>{BigInt(t.dropInPriceCents) > 0n ? `clase suelta ${pesos(t.dropInPriceCents, { decimals: false })}` : 'sin costo extra'}</span>
                      <span>{t.includableInPlans ? 'se puede incluir en planes' : 'solo se paga suelta'}</span>
                    </div>
                  </div>
                  {gestiona && (
                    <div className="card-foot row gap-6">
                      <Button variant="ghost" size="sm" icon={<Pencil />} onClick={() => onEditarTipo(t)}>Editar</Button>
                      <span className="flex-1" />
                      {/* Lo destructivo no pesa igual que Editar (UX7 Clases 8): va en "Más". */}
                      {cancela && <MenuMas items={[{ label: `Dejar de dar ${t.name}`, icon: <Trash2 />, peligro: true, onClick: () => onRetirarTipo(t) }]} />}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {activos.length > 0 && (
        <section className="mb-28 grid grid-2">
          <PausasCard sede={sede} alCambiar={alCambiar} />
          <ReglasCard />
        </section>
      )}

      {retirados.length > 0 && (
        <section className="mt-28">
          <h2 className="small muted strong mb-12">Clases que se dejaron de dar</h2>
          <div className="row wrap gap-8">
            {retirados.map((t) => (
              <span key={t.id} className="badge tipo-retirado">
                {t.name}
                {gestiona && <Button variant="ghost" size="sm" icon={<RotateCcw />} onClick={() => onReactivar(t)}>Reactivar</Button>}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
