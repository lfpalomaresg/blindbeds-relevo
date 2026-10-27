/**
 * Fotos de los partes de avería (bucket privado `ticket-photos`).
 *
 * Se muestran con una URL firmada de vida corta: quien la recibe solo puede
 * verla unos minutos y Storage solo la firma si las policies de
 * storage.objects (000003) dejan leer el objeto al usuario de la sesión.
 */
export const PHOTO_BUCKET = "ticket-photos";

/** Caducidad de la URL firmada, en segundos (5 minutos). */
export const PHOTO_URL_TTL_SECONDS = 300;
