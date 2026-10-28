"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { otpRequestOutcome } from "@/lib/login-errors";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // /auth/callback canjea el `code` por la sesión y redirige a /dashboard
      // (su `next` por defecto). Sin query string para que encaje tal cual en
      // la lista de Redirect URLs de Supabase.
      // Sin alta por enlace: los usuarios los crea el operador (ver
      // docs/20_ACTIVACION_SUPABASE.md). Además, enable_signup = false en Supabase.
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false },
    });

    setLoading(false);
    const outcome = otpRequestOutcome(error);
    if (outcome.sent) {
      setSent(true);
    } else {
      setError(outcome.message);
    }
  }

  if (sent) {
    return (
      <div className="text-center space-y-4">
        <h2 className="text-xl font-semibold">Revisa tu email</h2>
        <p className="text-gray-600">
          Si <strong>{email}</strong> está dado de alta, te hemos enviado un enlace
          mágico. Haz clic en él para acceder.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="tu@hotel.com"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
        />
      </div>
      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 px-4 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium"
      >
        {loading ? "Enviando..." : "Acceder"}
      </button>
    </form>
  );
}