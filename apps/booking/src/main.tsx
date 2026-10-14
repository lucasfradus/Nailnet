import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
// Cada paso vuelve arriba por su cuenta (ver `Paso`); el navegador no debe restaurar el scroll de otra pantalla.
history.scrollRestoration = "manual";
createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
