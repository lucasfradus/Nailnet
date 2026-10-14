-- Cuentas vinculadas por OAuth: vencimiento del access token, para renovarlo antes de que venza.
ALTER TABLE "CredencialProveedor" ADD COLUMN "tokenVenceEn" TIMESTAMP(3);

CREATE INDEX "CredencialProveedor_tokenVenceEn_idx" ON "CredencialProveedor"("tokenVenceEn");
