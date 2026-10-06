// Servidor estático del portal para producción: sirve dist/ sin dependencias. Los archivos con hash
// (assets/) se cachean un año; index.html nunca, para que un deploy nuevo se vea enseguida. Cualquier
// ruta desconocida sin extensión devuelve index.html (SPA).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("./dist/", import.meta.url));
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "0.0.0.0";
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8",
};
const SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

async function archivo(ruta) {
  // normalize + prefijo: ninguna ruta sale de dist/ (../, %2e%2e, etc.).
  const destino = normalize(join(raiz, ruta));
  if (!destino.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep)) return null;
  try { return (await stat(destino)).isFile() ? destino : null; } catch { return null; }
}

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD", ...SEGURIDAD }).end(); return; }
  let ruta;
  try { ruta = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname); } catch { response.writeHead(400, SEGURIDAD).end(); return; }
  let destino = await archivo(ruta);
  // SPA: sin extensión y sin archivo → index.html. Un archivo faltante con extensión es 404 de verdad.
  if (!destino && !extname(ruta)) destino = join(raiz, "index.html");
  if (!destino) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SEGURIDAD }).end("No encontrado"); return; }
  const inmutable = ruta.startsWith("/assets/");
  response.writeHead(200, {
    "Content-Type": TIPOS[extname(destino)] ?? "application/octet-stream",
    "Cache-Control": inmutable ? "public, max-age=31536000, immutable" : "no-cache",
    ...SEGURIDAD,
  });
  response.end(request.method === "HEAD" ? undefined : await readFile(destino));
}).listen(port, host, () => console.info(`Portal en http://${host}:${port}`));
