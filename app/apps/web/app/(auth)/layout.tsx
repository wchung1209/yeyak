export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center font-serif text-3xl tracking-tight">Yeyak</h1>
        {children}
      </div>
    </main>
  );
}
