export default function DevelopmentHome() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12 text-slate-900">
      <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-emerald-800">Ambiente de desenvolvimento</p>
      <h1 className="text-4xl font-semibold tracking-tight">Cuidado em Casa</h1>
      <p className="mt-5 text-lg leading-relaxed text-slate-600">
        A base local está pronta. As telas e os fluxos do produto serão implementados a partir do PRD e dos wireframes.
      </p>
      <a className="mt-8 w-fit rounded-lg bg-emerald-800 px-5 py-3 font-medium text-white underline-offset-4 hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800" href="/api/health">
        Verificar servidor
      </a>
    </main>
  );
}
