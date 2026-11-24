import type { OrganizationModule, OrganizationModules } from '@gymflow/core/contracts';
import { api } from '@/lib/api';

/** Un módulo del gimnasio tal como lo cuenta la API (`GET /organization/modules`): el contrato del núcleo. */
export type Modulo = OrganizationModule;
export type EstadoModulos = OrganizationModules;

export const cargarModulos = () => api<EstadoModulos>('/organization/modules');

/**
 * `avisado`: al apagar un módulo que borra datos pasado un plazo (Biometría: los
 * rostros; 3.12), el número que el aviso de la pantalla enseñó y la persona confirmó.
 */
const cuerpo = (enabled: boolean, reason?: string, avisado?: number) =>
  JSON.stringify({ enabled, ...(reason ? { reason } : {}), ...(avisado !== undefined ? { erasureAcknowledged: avisado } : {}) });

export const cambiarModulo = (key: string, enabled: boolean, reason?: string, avisado?: number) =>
  api<EstadoModulos>(`/organization/modules/${key}`, { method: 'PUT', body: cuerpo(enabled, reason, avisado) });

export const cambiarModuloEnSede = (key: string, branchId: string, enabled: boolean, reason?: string, avisado?: number) =>
  api<EstadoModulos>(`/organization/modules/${key}/branches/${branchId}`, { method: 'PUT', body: cuerpo(enabled, reason, avisado) });
