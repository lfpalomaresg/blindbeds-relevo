"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "@/lib/photos";

/**
 * Foto de un parte. Pide una URL firmada de vida corta con el cliente del
 * usuario: si las policies de storage.objects no le dejan leer el objeto
 * (otra organización, objeto borrado), Storage no la firma y se avisa.
 */
export function TicketPhoto({ path }: { path: string }) {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
      if (!active) return;
      if (error || !data?.signedUrl) setFailed(true);
      else setUrl(data.signedUrl);
    })();
    return () => { active = false; };
  }, [path, supabase]);

  if (failed) return <p className="text-xs text-gray-400 mb-3">Foto no disponible.</p>;
  if (!url) return <p className="text-xs text-gray-400 mb-3">Cargando foto...</p>;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada y efímera: next/image la cachearía */}
      <img src={url} alt="Foto del parte" loading="lazy" className="max-h-64 rounded-lg border border-gray-200 object-contain" />
    </a>
  );
}
