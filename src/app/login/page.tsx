import { LoginForm } from "@/components/auth/LoginForm";
import { loginErrorMessage } from "@/lib/login-errors";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const errorMessage = loginErrorMessage((await searchParams).error);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-orange-600">Blindbeds Relevo</h1>
          <p className="text-gray-500 mt-2">Suite de operaciones para tu hotel</p>
        </div>
        {errorMessage && (
          <p role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {errorMessage}
          </p>
        )}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
