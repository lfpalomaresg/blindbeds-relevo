import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blindbeds Relevo",
  description: "Relevo de turno y partes de avería para hoteles",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#F0AB00",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-gray-50 antialiased">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/dashboard" className="font-bold text-orange-600 text-lg">
              Blindbeds Relevo
            </a>
            <nav className="flex gap-4 text-sm">
              <a href="/dashboard" className="text-gray-600 hover:text-orange-600">Inicio</a>
              <Link href="/handover" className="text-gray-600 hover:text-orange-600">Relevos</Link>
              <a href="/tickets/new" className="text-gray-600 hover:text-orange-600">Avería</a>
            </nav>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}