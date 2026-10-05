/// <reference types="vite/client" />
// Solo valores públicos: todo lo que empieza con VITE_ termina en el bundle. Nunca secretos.
interface ImportMetaEnv {
  /** Origen del backoffice que sirve /api/public/v1. Predeterminado: http://localhost:3000. */
  readonly VITE_API_URL?: string;
  /** Slug público de la organización. Predeterminado: demo. */
  readonly VITE_ORGANIZACION?: string;
}
