"use client";

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Outside production, chunk names carry no content hash, so the
    // cache-first worker would keep serving stale JS/CSS. Never register it
    // there, and drop any worker left over from an earlier run.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => {});
      return;
    }

    navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
