/**
 * Infraestructura en Railway (IaC). Una sola definición para todo el proyecto: un recurso que no figura
 * acá se BORRA al aplicar. Antes de aplicar a un proyecto armado a mano, correr `railway config pull`
 * en otra copia y comparar con `railway config plan`. Ver docs/22-despliegue-railway.md.
 *
 * Ambientes: el que se llama `staging` lleva datos demo; cualquier otro nombre (incluido `production`,
 * el que Railway crea por defecto) se trata como producción real: solo migraciones, nunca el seed.
 */
import { defineRailway, github, group, postgres, preserve, project, service } from "railway/iac";

const REPO = "lucasfradus/Nailnet";
// Cambios en estos archivos afectan a todas las apps (dependencias, paquetes compartidos, versión de Node).
const COMUNES = ["/package.json", "/package-lock.json", "/.nvmrc", "/.npmrc"];

export default defineRailway((ctx) => {
  const staging = ctx.isEnvironment("staging");
  const fuente = github(REPO, { branch: "main" });
  const db = postgres("Postgres");

  // Las URLs cruzadas usan la sintaxis de referencias de Railway: backoffice y portal se apuntan entre sí
  // y el DSL no admite referencias circulares entre objetos. Las apps aceptan el dominio sin esquema.
  const dominio = (servicio: string) => `\${{${servicio}.RAILWAY_PUBLIC_DOMAIN}}`;

  const backoffice = service("backoffice", {
    source: fuente,
    build: {
      buildCommand: "npm run db:generate && npm run build -w @nailnet/backoffice",
      watchPatterns: [...COMUNES, "/apps/backoffice/**", "/packages/**", "/brand/**"],
    },
    start: "npm run start -w @nailnet/backoffice",
    // Una sola app migra (y en staging carga la demo, idempotente) antes de cada deploy; si falla, no se publica.
    preDeploy: staging ? "npm run db:migrate && npm run db:seed" : "npm run db:migrate",
    healthcheck: "/api/health",
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      NAILNET_AMBIENTE: staging ? "staging" : "produccion",
      // Llavero de cifrado de credenciales por sede (doc 11). Se genera una vez y se carga en Railway;
      // nunca en el repo. preserve() mantiene el valor que ya está cargado.
      NAILNET_CLAVES_CIFRADO: preserve(),
      NAILNET_CLAVE_ACTIVA: preserve(),
      PORTAL_ORIGIN: dominio("booking"),
      // Railway pone la IP real del cliente en X-Real-IP; X-Forwarded-For la puede inventar el cliente.
      TRUST_PROXY: "true",
      CLIENTE_IP_HEADER: "x-real-ip",
      ...(staging ? { ALLOW_DEMO_SEED: "true" } : {}),
    },
  });

  const booking = service("booking", {
    source: fuente,
    build: {
      buildCommand: "npm run build -w @nailnet/booking",
      watchPatterns: [...COMUNES, "/apps/booking/**", "/packages/contracts/**", "/brand/**"],
    },
    start: "npm run start -w @nailnet/booking",
    healthcheck: "/",
    env: {
      // Variables públicas: Vite las incrusta en el bundle durante el build. Nunca secretos.
      VITE_API_URL: dominio("backoffice"),
      VITE_ORGANIZACION: staging ? "demo" : preserve(),
    },
  });

  const worker = service("worker", {
    source: fuente,
    build: {
      buildCommand: "npm run db:generate && npm run build -w @nailnet/worker",
      watchPatterns: [...COMUNES, "/apps/worker/**", "/packages/**"],
    },
    start: "npm run start -w @nailnet/worker",
    // /health es liveness; /ready (estado de la cola) queda para alertas, no para cortar deploys.
    healthcheck: "/health",
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      // Railway llega al healthcheck por la red del contenedor; localmente el default sigue siendo 127.0.0.1.
      HOST: "0.0.0.0",
    },
  });

  return project("Nailnet", {
    resources: [...group("Apps", [backoffice, booking, worker]), db],
  });
});
