import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las respuestas.
 * - Nadie puede enmarcar la app (clickjacking sobre borrar, cerrar o resolver).
 * - La CSP solo fija `frame-ancestors`: Next inyecta scripts inline sin nonce,
 *   así que restringir scripts exigiría nonce en el proxy (fuera de alcance).
 * - La cámara solo la usa el escáner QR del propio origen.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
