/**
 * Minimización del texto libre (RGPD). El relevo no debe guardar nombres de
 * huéspedes ni datos de salud: el aviso acompaña a cada campo de texto libre.
 * Literal único: si cambia, cambia en todos los campos a la vez.
 */
export const FREE_TEXT_NOTICE = "Sin nombres de huéspedes ni datos de salud: usa el nº de habitación.";

/** Días que se conserva un relevo antes de que lo borre purge_expired_handovers (000008). */
export const HANDOVER_RETENTION_DAYS = 90;
