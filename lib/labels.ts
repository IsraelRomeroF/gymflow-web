/**
 * Vocabulario de la interfaz. Los códigos de la API se traducen una sola vez,
 * para que "SUSPENDED" no aparezca nunca delante de recepción. Desde la fase
 * 1.1 las palabras viven en el núcleo (`@gymflow/core/vocabulario`): las
 * mismas para el panel, el portal y los archivos que arma la API (2-13,
 * 27-07). Aquí se conservan los nombres de siempre para no tocar cada pantalla.
 */
export {
  ESTADO_DE_SOCIO as MEMBER_STATUS,
  ESTADO_DE_MEMBRESIA as MEMBERSHIP_STATUS,
  TIPO_DE_CONSENTIMIENTO_PERSONAL as CONSENT_TYPE,
  CANAL_DE_CONSENTIMIENTO as CONSENT_CHANNEL,
  MODALIDAD_BIOMETRICA as MODALITY,
  MOTIVO_DE_RECHAZO as DENIAL_REASON,
  // El nombre del puesto sale del catálogo de puestos del núcleo (EST-10), no de una lista aparte (1-18).
  nombreDePuesto as rolDe,
} from '@gymflow/core/vocabulario';
