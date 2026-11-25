'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { ALL_SECTIONS_UNLOCKED, LOCKABLE_SECTIONS, SECTION_GROUP_NAMES, effectiveSections, isSectionOpen, onlyEffectiveSections, setSectionOpen } from '@gymflow/core/secciones';
import { api } from '@/lib/api';
import { useFormulario } from '@gymflow/ui/formulario';
import { errorText, useToast } from '@/components/session';
import { Button, CampoMotivo, Dialog, ERROR_MOTIVO, faltaMotivo, Switch } from '@/components/ui';

/** Las secciones que tienen efecto para un Dueño (17-05, 22-13): las pantallas que su puesto sí trae. */
const DEL_DUENO = (() => {
  const efecto = new Set(effectiveSections('OWNER'));
  return LOCKABLE_SECTIONS.filter((s) => efecto.has(s.key));
})();
/**
 * El dueño consulta, no opera (D-23, D-25): donde el texto del núcleo habla
 * de operar («Abrir y cerrar turnos»), aquí se dice lo que él hace con esa
 * pantalla. Quitarle «Caja» es quitarle leer los cortes.
 */
const PARA_EL_DUENO: Record<string, string> = {
  caja: 'Ver los cortes y los turnos de caja.',
  sucursales: 'Consultar las sucursales, sus cajas y sus equipos.',
  modulos: 'Consultar qué secciones usa el gimnasio.',
  personal: 'Ver al personal; lo administra si el gimnasio no tiene gerente.',
};
const GRUPO: Record<string, string> = { ...SECTION_GROUP_NAMES, operacion: 'Consulta de operación' };
const GRUPOS = ['operacion', 'direccion', 'cumplimiento'] as const;

/**
 * QUÉ VE EL DUEÑO: lo libera o lo bloquea la plataforma (2026-10-09). Solo
 * se ofrecen las secciones que le cambian algo: antes salían las catorce de
 * la llave del personal, con textos de operación que a él no le aplican, y
 * cinco de ellas no hacían nada. La API guarda con la misma regla
 * (`onlyEffectiveSections`).
 */
export function QueVeDueno({ marcaId, persona, onClose, onListo }: {
  marcaId: string; persona: { id: string; fullName: string; platformSections?: string[] | null };
  onClose: () => void; onListo: () => void;
}) {
  const toast = useToast();
  const [sinLimite, setSinLimite] = useState(!persona.platformSections);
  const [liberadas, setLiberadas] = useState<string[]>(() => onlyEffectiveSections(persona.platformSections ?? ALL_SECTIONS_UNLOCKED, 'OWNER'));
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const f = useFormulario({ motivo: faltaMotivo(motivo) && ERROR_MOTIVO });
  async function guardar() {
    setError(null);
    try {
      await api(`/platform/organizations/${marcaId}/users/${persona.id}/sections`, { method: 'PUT', body: JSON.stringify({ sections: sinLimite ? null : liberadas, reason: motivo.trim() }) });
      toast('ok', sinLimite ? `${persona.fullName} vuelve a ver todo.` : `Listo: ${persona.fullName} solo ve lo marcado.`);
      onListo();
    } catch (e) { setError(errorText(e, 'No se pudo guardar')); }
  }
  return (
    <Dialog open onClose={onClose} error={error} title={`Qué ve ${persona.fullName}`} sub="Dueño de la marca. Lo que le quites deja de verlo en su menú y en su teléfono desde su siguiente pantalla."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon={<Lock />} loading={f.enviando} onClick={() => void f.enviar(guardar)}>Guardar</Button></>}>
      <div className="stack">
        <Switch checked={sinLimite} onChange={setSinLimite}>Sin límite: ve todo lo que tiene contratado la marca</Switch>
        {!sinLimite && (
          <div className="field" data-testid="secciones-llave">
            <span className="label">Qué ve</span>
            <p className="hint mb-8">Lo de consulta de operación viene abierto y aquí se le puede quitar; lo de Dirección y Cumplimiento solo lo ve si lo marcas.</p>
            {GRUPOS.map((g) => {
              const del = DEL_DUENO.filter((x) => x.group === g);
              if (del.length === 0) return null;
              const todas = del.every((x) => isSectionOpen(x.key, liberadas));
              return (
                <div key={g} className="mb-8">
                  <div className="row-between mb-4">
                    <span className="eyebrow">{GRUPO[g]}</span>
                    <button type="button" className="row-link tiny" onClick={() => setLiberadas(del.reduce((lista, x) => setSectionOpen(x.key, lista, !todas), liberadas))}>{todas ? 'Quitar todo' : 'Marcar todo'}</button>
                  </div>
                  <div className="grid grid-2 gap-4">
                    {del.map((x) => (
                      <div key={x.key} data-seccion={x.key}>
                        <Switch checked={isSectionOpen(x.key, liberadas)} onChange={(v) => setLiberadas(setSectionOpen(x.key, liberadas, v))}>{x.name}</Switch>
                        <p className="hint">{PARA_EL_DUENO[x.key] ?? x.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <CampoMotivo id="qv-m" value={motivo} onChange={setMotivo} error={f.error('motivo')} hint="Queda en la bitácora de la marca."
          motivos={['Lo pidió el dueño', 'Cambio de contrato']} />
      </div>
    </Dialog>
  );
}
