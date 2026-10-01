export function TarjetaAcceso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <main className="acceso">
    <span className="brand">NailNet<span> / gestión</span></span>
    <section className="tarjeta"><h1>{titulo}</h1>{children}</section>
  </main>;
}
