"use client";

import { useState, useEffect, useRef } from "react";
import { decodeQR } from "@/lib/qr";

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const scanActiveRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      requestAnimationFrame(scanLoop);
    } catch (err) {
      // Solo NotAllowedError es un permiso denegado; sin cámara o sin HTTPS los permisos no ayudan.
      setPermissionDenied(err instanceof DOMException && err.name === "NotAllowedError");
      setError("No se pudo acceder a la cámara.");
    }
  }

  function stopCamera() {
    scanActiveRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function scanLoop() {
    if (!scanActiveRef.current || !videoRef.current) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = decodeQR(imageData.data, imageData.width, imageData.height);

    if (code) {
      onScan(code);
      stopCamera();
      return;
    }

    requestAnimationFrame(scanLoop);
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="p-4 flex justify-between items-center bg-black/50">
        <span className="text-white text-sm">
          {error || "Apunta al código QR del activo"}
        </span>
        <button onClick={onClose} className="text-white text-sm px-3 py-1 bg-white/20 rounded">
          Cerrar
        </button>
      </div>
      {error ? (
        <div className="flex-1 flex items-center justify-center text-white text-center p-6">
          <div>
            <p className="text-lg mb-2">📷 Cámara no disponible</p>
            <p className="text-sm text-gray-400">
              {permissionDenied
                ? "Permite el acceso desde la configuración del navegador"
                : "Comprueba que el dispositivo tiene cámara y que la página se abre por HTTPS"}
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-orange-600 rounded"
            >
              Continuar sin escanear
            </button>
          </div>
        </div>
      ) : (
        <video ref={videoRef} className="flex-1 w-full object-cover" playsInline muted />
      )}
    </div>
  );
}

