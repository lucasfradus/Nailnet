import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "NailNet · Administración", description: "Gestión de sedes y atención" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
