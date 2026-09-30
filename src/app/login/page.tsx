import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-orange-600">Blindbeds Relevo</h1>
          <p className="text-gray-500 mt-2">Suite de operaciones para tu hotel</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}