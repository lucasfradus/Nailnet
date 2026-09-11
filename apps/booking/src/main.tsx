import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
function App() { return <main><header>NailNet</header><section><p className="label">TU MOMENTO, A TU TIEMPO</p><h1>Un espacio<br/>para cuidarte.</h1><p>Estamos preparando una nueva forma de reservar tu próximo turno. Pronto vas a poder elegir sede, servicio y profesional desde acá.</p><span className="notice">Reservas online próximamente</span></section><footer>El portal todavía no acepta reservas ni pagos.</footer></main>; }
createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
