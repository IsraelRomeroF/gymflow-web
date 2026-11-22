'use client';

import { Eye, KeyRound, Plus, UserCheck, Users, UserX } from 'lucide-react';
import { hace } from '@/lib/format';
import { rolDe } from '@/lib/labels';
import { Badge, Button, Card, Empty, MenuMas } from '@/components/ui';
import type { Detalle, Usuario } from './tipos';

/**
 * PERSONAL CON ACCESO AL PANEL. Es lo que se consulta al atender una llamada
 * («olvidé mi contraseña», «ya no trabaja aquí»): por eso va arriba en la
 * ficha (22-04) y cada fila deja a la mano «Nueva contraseña», lo más pedido.
 * Lo demás (qué ve el dueño, suspender, reactivar) va en «Más»: en el teléfono
 * los tres botones juntos se cortaban (22-05).
 */
export function PersonalMarca({ marca, onAgregar, onNuevaContrasena, onQueVe, onActivar }: {
  marca: Detalle;
  onAgregar: () => void;
  onNuevaContrasena: (u: Usuario) => void;
  onQueVe: (u: Usuario) => void;
  onActivar: (u: Usuario) => void;
}) {
  const sede = (ids: string[] | null) => (ids === null ? 'Todo el gimnasio' : ids.map((b) => marca.branches.find((x) => x.id === b)?.name ?? 'Sucursal').join(', '));
  return (
    <Card title="Personal con acceso al panel" sub="Quién entra, con qué puesto y en qué sedes. Cada cuenta nace con contraseña temporal." pad={false} data-testid="personal-marca"
      actions={<Button size="sm" icon={<Plus />} onClick={onAgregar}>Agregar cuenta</Button>}>
      {marca.users.length === 0 ? (
        <Empty icon={<Users />} title="Esta marca no tiene cuentas" text="Agrega la del dueño para que pueda entrar." />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead><tr><th>Persona</th><th>Rol</th><th>Alcance</th><th>Último acceso</th><th>Cuenta</th><th /></tr></thead>
            <tbody>
              {marca.users.map((u) => (
                <tr key={u.id} data-cuenta={u.email}>
                  <td><span className="strong">{u.fullName}</span><div className="tiny muted">{u.email}</div></td>
                  <td data-label="Rol">{rolDe(u.roleKeys)}</td>
                  <td data-label="Alcance" className="small">{sede(u.branchIds)}</td>
                  <td data-label="Último acceso" className="small muted stack-hide">{u.lastLoginAt ? hace(u.lastLoginAt) : 'Nunca ha entrado'}</td>
                  <td data-label="Cuenta">{!u.isActive ? <Badge tone="danger" dot>Suspendida</Badge> : u.mustChangePassword ? <Badge tone="warn" dot>Contraseña temporal</Badge> : <Badge tone="ok" dot>Activa</Badge>}</td>
                  <td className="right">
                    <span className="row gap-4 justify-end">
                      <Button size="sm" variant="ghost" icon={<KeyRound />} onClick={() => onNuevaContrasena(u)}>Nueva contraseña</Button>
                      <MenuMas tam="sm" etiqueta={`Más acciones de ${u.fullName}`} items={[
                        // Lo que ve el dueño lo decide la plataforma, con el mismo modal que él usa con su personal.
                        u.roleKeys.includes('OWNER') && { label: u.platformSections ? 'Qué ve · limitado' : 'Qué ve', icon: <Eye />, onClick: () => onQueVe(u) },
                        u.isActive
                          ? { label: 'Suspender la cuenta', icon: <UserX />, onClick: () => onActivar(u), peligro: true }
                          : { label: 'Reactivar la cuenta', icon: <UserCheck />, onClick: () => onActivar(u) },
                      ]} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
