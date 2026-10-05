import { Marca } from "@/components/marca";

export function TarjetaAcceso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <main className="acceso">
    <Marca />
    <section className="tarjeta"><h1>{titulo}</h1>{children}</section>
  </main>;
}
