import { Pool, neonConfig } from '@neondatabase/serverless';
// Importante para entornos Edge (Cloudflare Workers) para usar fetch en lugar de WebSockets nativos si es necesario
neonConfig.fetchConnectionCache = true;

export const getDb = (connectionString: string) => {
  return new Pool({ connectionString });
};