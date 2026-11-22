import type { OrganizationModule, OrganizationModules } from '@gymflow/core/contracts';
import { api } from '@/lib/api';

/** Un módulo del gimnasio tal como lo cuenta la API (`GET /organization/modules`): el contrato del núcleo. */
export type Modulo = OrganizationModule;
export type EstadoModulos = OrganizationModules;

export const cargarModulos = () => api<EstadoModulos>('/organization/modules');

export const cambiarModulo = (key: string, enabled: boolean, reason?: string) =>
  api<EstadoModulos>(`/organization/modules/${key}`, { method: 'PUT', body: JSON.stringify({ enabled, ...(reason ? { reason } : {}) }) });

export const cambiarModuloEnSede = (key: string, branchId: string, enabled: boolean, reason?: string) =>
  api<EstadoModulos>(`/organization/modules/${key}/branches/${branchId}`, { method: 'PUT', body: JSON.stringify({ enabled, ...(reason ? { reason } : {}) }) });
