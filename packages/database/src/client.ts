import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client.ts";
export function createDatabase(url: string = process.env.DATABASE_URL ?? "") {
  if (!url) throw new Error("DATABASE_URL es obligatoria");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
export type Database = ReturnType<typeof createDatabase>;
