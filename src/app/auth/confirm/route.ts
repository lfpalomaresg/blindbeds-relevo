import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasSupabaseEnv, isEmailOtpType } from "@/lib/auth-paths";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!token_hash || !isEmailOtpType(type)) {
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }

  if (!hasSupabaseEnv()) {
    return NextResponse.redirect(new URL("/login?error=config", request.url));
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
