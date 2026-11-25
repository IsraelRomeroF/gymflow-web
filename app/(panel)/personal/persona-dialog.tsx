'use client';

import Link from 'next/link';
import { useState } from 'react';
import { KeyRound, UserCheck, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import { hace, telefono as telefonoLegible } from '@gymflow/ui/format';
import { useSession, useToast, errorText, erroresPorCampo } from '@/components/session';
import { Badge, Button, Callout, Dialog, Field } from '@/components/ui';
import { PermisosPersona, type Ajustes } from '@/components/permisos-persona';
import { Alcance, celularParaEditar } from './alta-dialog';
import { ConfirmarCuenta } from './cuenta-dialogs';
import { QueVe } from './que-ve';
import { estadoCuenta, frase, queVeHoy, soloConEfecto, type Persona, type Rol } from './persona';

type Parte = 'datos' | 'puesto' | 'permisos' | 'secciones';
const NOMBRE_PARTE: Record<Parte, string> = { datos: 'sus datos', puesto: 'su puesto', permisos: 'sus excepciones', secciones: 'lo que ve' };
const BOTON: Record<Parte, string> = { datos: 'Guardar datos', puesto: 'Guardar puesto', permisos: 'Guardar permisos', secciones: 'Guardar secciones' };

const ordenado = (xs: readonly string[] | null | undefined) => [...(xs ?? [])].sort().join();
const claves = (a: Ajustes | null | undefined) => `${ordenado(a?.add)}|${ordenado(a?.remove)}`;
/** El celular como lo guardaría la API: 10 dígitos → +52…; vacío → null; lo demás, tal cual (la API dirá qué falta). */
const comoE164 = (tel: string) => { const d = tel.replace(/\D/g, ''); return d.length === 0 ? null : d.length === 10 ? `+52${d}` : tel.trim(); };

/**
 * LA PERSONA, en cuatro bloques y siempre en el mismo orden para la dueña y
 * para la gerencia (17-11): Cuenta · Puesto y sucursales · Qué ve · Qué puede
 * hacer. Lo que no te toca se lee, no desaparece. Un solo motivo, encima del
 * pie, y un solo botón que dice lo que va a guardar; «Nueva contraseña» y
 * «Dar de baja» viven en Cuenta, cada una con su confirmación.
 */
export function PersonaDialog({ persona, roles, gente, onClose, onListo, onCambio, onClave }: {
  persona: Persona; roles: Rol[]; gente: readonly Persona[];
  onClose: () => void;
  /** Guardó todo: cierra y recarga la lista. */
  onListo: () => void;
  /** Guardó una parte (y otra falló): recarga la lista sin cerrar. */
  onCambio: () => void;
  onClave: (c: string) => void;
}) {
  const { can, branchName } = useSession();
  const toast = useToast();
  // Lo último que dijo el servidor: si una parte se guarda y otra falla, lo que falta se compara contra esto.
  const [actual, setActual] = useState(persona);
  const esDueno = actual.role?.key === 'OWNER';
  // La cuenta del dueño la administra GymFlow (DP-01): aquí no se toca.
  const gestiona = can('staff:manage') && !esDueno;
  // El dueño rescata a su gerente cuando este olvidó la contraseña o se fue (DP-02).
  const rescata = can('staff:rescue') && !gestiona && actual.role?.key === 'MANAGER';
  const libera = can('staff:unlock') && actual.unlockedSections !== null && actual.unlockedSections !== undefined;
  const conLlave = actual.unlockedSections !== null && actual.unlockedSections !== undefined;
  const ajustable = actual.permissionOverrides !== null && actual.permissionOverrides !== undefined;

  const [nombre, setNombre] = useState(actual.fullName);
  const [telefono, setTelefono] = useState(celularParaEditar(actual.phoneE164));
  const [rol, setRol] = useState(actual.role?.key ?? '');
  const [sedes, setSedes] = useState(actual.branchIds);
  const [ajustes, setAjustes] = useState<Ajustes>(actual.permissionOverrides ?? { add: [], remove: [] });
  const [liberadas, setLiberadas] = useState<string[]>(actual.unlockedSections ?? []);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [accion, setAccion] = useState<'clave' | 'baja' | null>(null);

  const puestoCambia = gestiona && !!rol && rol !== (actual.role?.key ?? '');
  // Lo que verá con el puesto que queda: si la gerencia lo cambia, la llave se mide contra el nuevo.
  const puestoFinal = puestoCambia ? rol : actual.role?.key ?? '';
  const pendiente = libera && !!actual.sectionsReviewPending;

  const cambios: Parte[] = [];
  if (gestiona && (nombre.trim() !== actual.fullName || comoE164(telefono) !== (actual.phoneE164 ?? null))) cambios.push('datos');
  if (gestiona && !!rol && (puestoCambia || ordenado(sedes) !== ordenado(actual.branchIds))) cambios.push('puesto');
  if (gestiona && ajustable && !puestoCambia && claves(ajustes) !== claves(actual.permissionOverrides)) cambios.push('permisos');
  // Al gerente nuevo, dejar lo que ve como está también es decidir (17-06).
  if (libera && (ordenado(liberadas) !== ordenado(actual.unlockedSections) || pendiente)) cambios.push('secciones');
  const listoMotivo = motivo.trim().length >= 3;

  // Cambiar de puesto borra las excepciones (17-03): se dice ANTES de guardar.
  const excepciones = (actual.permissionOverrides?.add.length ?? 0) + (actual.permissionOverrides?.remove.length ?? 0);
  const borraExcepciones = puestoCambia && excepciones > 0;

  // Del mismo puesto, para «Copiar lo de…» (D17-04): primero las activas.
  const mismoPuesto = gente.filter((o) => o.id !== actual.id && o.role?.key === puestoFinal)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.fullName.localeCompare(b.fullName, 'es'));
  const copiado = (de: { fullName: string }) => {
    if (!motivo.trim()) setMotivo(`Lo mismo que ${de.fullName}`);
    toast('ok', `Copiado de ${de.fullName}: revísalo y guarda`);
  };

  async function guardar() {
    setEnviando(true);
    setErrores({});
    const hechas: Parte[] = [];
    let ultima = actual;
    const reason = motivo.trim();
    for (const parte of cambios) {
      try {
        if (parte === 'datos') {
          ultima = await api<Persona>(`/users/${actual.id}`, { method: 'PATCH', body: JSON.stringify({ fullName: nombre.trim(), phoneE164: comoE164(telefono), reason }) });
        } else if (parte === 'puesto') {
          ultima = await api<Persona>(`/users/${actual.id}/role`, { method: 'PUT', body: JSON.stringify({ roleKey: rol, branchIds: sedes, reason }) });
        } else if (parte === 'permisos') {
          ultima = await api<Persona>(`/users/${actual.id}/permissions`, { method: 'PUT', body: JSON.stringify({ ...ajustes, reason }) });
        } else {
          // Solo lo que tiene efecto para su puesto: lo demás no hacía nada y se limpia (17-05).
          ultima = await api<Persona>(`/users/${actual.id}/sections`, { method: 'PUT', body: JSON.stringify({ sections: soloConEfecto(liberadas, puestoFinal), reason }) });
        }
        hechas.push(parte);
        setActual(ultima);
      } catch (e) {
        setErrores(erroresPorCampo(e));
        toast('error', `${hechas.length ? `Se guardó ${frase(hechas.map((h) => NOMBRE_PARTE[h]))}, pero no ` : 'No se pudo guardar '}${NOMBRE_PARTE[parte]}: ${errorText(e, 'intenta de nuevo')}`);
        if (hechas.length) {
          // Lo que sí se guardó ya es la base: el resto se vuelve a comparar contra eso.
          setRol(ultima.role?.key ?? rol);
          setSedes(ultima.branchIds);
          onCambio();
        }
        setEnviando(false);
        return;
      }
    }
    setEnviando(false);
    const cierraSesion = hechas.some((h) => h !== 'datos');
    const una = hechas.length === 1 ? hechas[0] : null;
    toast('ok', una === 'secciones' ? 'Secciones guardadas: tendrá que volver a entrar'
      : una === 'permisos' ? 'Permisos guardados: tendrá que volver a entrar'
        : una === 'puesto' ? (borraExcepciones ? 'Puesto cambiado: se quitaron sus excepciones y tendrá que volver a entrar' : 'Puesto guardado: tendrá que volver a entrar')
          : una === 'datos' ? 'Datos guardados'
            : `Cambios guardados${cierraSesion ? ': tendrá que volver a entrar' : ''}`);
    onListo();
  }

  const estado = estadoCuenta(actual);
  const boton = cambios.length === 1 ? BOTON[cambios[0]!] : 'Guardar cambios';
  const editaAlgo = gestiona || libera;
  const alcance = actual.branchIds.length === 0 ? 'todo el gimnasio' : actual.branchIds.map((b) => branchName(b)).join(', ');

  return (
    <Dialog open onClose={onClose} size="lg" title={actual.fullName} sub={actual.email}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={enviando}>{editaAlgo ? 'Cancelar' : 'Cerrar'}</Button>
        {editaAlgo && <Button loading={enviando} disabled={cambios.length === 0 || !listoMotivo} onClick={() => void guardar()} data-testid="guardar-persona">{boton}</Button>}
      </>}>
      <div className="stack">
        {esDueno && <Callout tone="info">La cuenta del dueño la administra GymFlow: su contraseña, su puesto y su baja se cambian desde la plataforma, no desde aquí.</Callout>}
        {pendiente && (
          <Callout tone="warn" title="Gerente nuevo: decide qué ve">
            Nació viendo {queVeHoy(actual).length ? `la operación y ${frase(queVeHoy(actual))}` : 'solo la operación'}. Si reemplaza a otro gerente, trae lo suyo con «Copiar lo de…»; si así está bien, guárdalo con un motivo y el aviso se quita.
          </Callout>
        )}

        {/* 1 · Cuenta */}
        <section className="dialog-seccion" aria-label="Cuenta">
          <span className="eyebrow">Cuenta</span>
          {gestiona ? (
            <div className="grid grid-2 gap-12">
              <Field label="Nombre" htmlFor="pd-nom" error={errores.fullName}>
                <input id="pd-nom" className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </Field>
              <Field label="Celular" htmlFor="pd-tel" hint="Para mandarle su contraseña por WhatsApp." error={errores.phoneE164}>
                <input id="pd-tel" className="input" inputMode="tel" placeholder="10 dígitos" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
              </Field>
            </div>
          ) : (
            <p className="small">Celular: {actual.phoneE164 ? telefonoLegible(actual.phoneE164) : <span className="muted">sin capturar</span>}</p>
          )}
          <div className="row gap-8 flex-wrap items-center">
            <Badge tone={estado.tone === 'neutral' ? undefined : estado.tone} dot>{estado.label}</Badge>
            <span className="small muted">{!actual.isActive ? 'Dada de baja' : actual.lastLoginAt ? `Último acceso ${hace(actual.lastLoginAt)}` : 'Nunca ha entrado'}</span>
            {/* Aquí y no en el subtítulo: ahí el «·» quedaba colgando al envolver (17-13). */}
            {can('audit:read') && <Link className="row-link small" href={`/bitacora?persona=${actual.id}`}>Lo que ha hecho</Link>}
            {(gestiona || rescata) && (
              <span className="row gap-8 flex-wrap">
                <Button size="sm" variant="ghost" icon={<KeyRound />} onClick={() => setAccion('clave')}>Nueva contraseña</Button>
                <Button size="sm" variant={actual.isActive ? 'danger-ghost' : 'secondary'} icon={actual.isActive ? <UserX /> : <UserCheck />} onClick={() => setAccion('baja')}>
                  {actual.isActive ? 'Dar de baja' : 'Reactivar'}
                </Button>
              </span>
            )}
          </div>
          {actual.temporaryExpired && actual.isActive && <p className="hint text-danger">Su contraseña temporal venció sin usarla: dale una nueva.</p>}
        </section>

        {/* 2 · Puesto y sucursales */}
        {!esDueno && (
          <section className="dialog-seccion" aria-label="Puesto y sucursales">
            <span className="eyebrow">Puesto y sucursales</span>
            {gestiona
              ? <Alcance roles={roles} rol={rol} setRol={setRol} sedes={sedes} setSedes={setSedes} />
              : <p className="small">{actual.role?.name ?? 'Sin puesto'} · {alcance}. <span className="muted">El puesto y las sucursales los cambia la gerencia.{rescata ? ' Si tu gerente olvidó su contraseña o se fue, aquí le das una temporal o lo das de baja.' : ''}</span></p>}
            {borraExcepciones && (
              <Callout tone="warn">Al cambiar de puesto se {excepciones === 1 ? 'quita su excepción' : `quitan sus ${excepciones} excepciones`} de «Qué puede hacer»: tendrá exactamente lo del puesto nuevo.</Callout>
            )}
          </section>
        )}

        {/* 3 · Qué ve (la llave de la dueña) */}
        {conLlave && puestoFinal && (
          <section className="dialog-seccion" aria-label="Qué ve">
            <QueVe puesto={puestoFinal} liberadas={liberadas} onChange={setLiberadas} editable={libera} otras={mismoPuesto} onCopiar={copiado}
              hint={libera
                ? 'Solo aparece lo que cambia algo para su puesto. Lo de Operación viene con el puesto y aquí se le quita; lo de Dirección y Cumplimiento solo lo ve si lo marcas.'
                : actual.sectionsReviewPending ? 'La dueña todavía no decide qué ve: por ahora, solo la operación.' : 'Lo decide la dueña.'} />
          </section>
        )}

        {/* 4 · Qué puede hacer (excepciones al puesto) */}
        {ajustable && actual.role && (
          <section className="dialog-seccion" aria-label="Qué puede hacer">
            {puestoCambia
              ? <p className="small muted">Las excepciones del puesto nuevo se ajustan después de guardar el cambio de puesto.</p>
              : <PermisosPersona roleKey={actual.role.key} valor={ajustes} onChange={setAjustes} editable={gestiona} otras={mismoPuesto} onCopiar={copiado} />}
          </section>
        )}

        {editaAlgo && (
          <Field label="Motivo" htmlFor="ed-mot" required
            hint={cambios.length > 0 && !listoMotivo ? 'Escribe el motivo para poder guardar: queda en la bitácora con tu nombre.' : 'Queda en la bitácora con tu nombre.'}>
            <input id="ed-mot" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Cambio de turno, nuevas tareas…" />
          </Field>
        )}
      </div>
      {accion && (
        <ConfirmarCuenta persona={actual} accion={accion} rescate={rescata}
          onClose={() => setAccion(null)}
          onHecho={(clave) => { setAccion(null); onListo(); if (clave) onClave(clave); }} />
      )}
    </Dialog>
  );
}
