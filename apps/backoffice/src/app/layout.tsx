import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Sicurella · Administración", description: "Gestión de sedes y atención" };
export const viewport: Viewport = { themeColor: "#008094" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
