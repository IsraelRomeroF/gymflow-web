import { api } from '@/lib/api';
import type { BiometricEnrollment } from '@gymflow/core/contracts';

/** Un rostro o huella registrado (`GET /members/:id/biometric-enrollments`): contrato del núcleo (6-17). */
export type Enrollment = BiometricEnrollment;

/** Firmó un texto biométrico anterior al vigente (6-03, 21-09): lo dice la ficha. */
export type FirmaPorRenovar = { signedVersion: string; currentVersion: string };

/** Plazo para que la sucursal confirme el borrado de la plantilla de un LECTOR (TEMPLATE_RETENTION_DAYS). */
export const PLAZO_BORRADO_DIAS = 30;

export type DocVigente = { id: string; version: string; title: string; bodyText: string };

/** El texto biométrico publicado, completo: el que se firma (lo resuelve el servidor). `null` si no hay. */
export async function textoBiometricoVigente(): Promise<DocVigente | null> {
  const r = await api<{ documents: Array<{ id: string; consentType: string; status: string }> }>('/consent-documents');
  const vigente = r.documents.find((d) => d.consentType === 'BIOMETRIC' && d.status === 'PUBLISHED');
  return vigente ? api<DocVigente>(`/consent-documents/${vigente.id}`) : null;
}

/** ¿Es un rostro tomado con la cámara (plantilla en el servidor)? Los registros anteriores al dato se leen por el algoritmo. */
export const esDeLaCamara = (e: Enrollment): boolean =>
  e.modality === 'FACE' && (e.templateKind ? e.templateKind === 'server' : e.algorithmVendor.startsWith('insightface'));
