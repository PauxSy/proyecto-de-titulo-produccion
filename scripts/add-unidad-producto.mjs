import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { neon } = require('@neondatabase/serverless')
const url = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/DATABASE_URL=(.+)/)[1].trim()
const sql = neon(url)

await sql`ALTER TABLE producto ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(10) NOT NULL DEFAULT 'un'`
await sql`ALTER TABLE producto DROP CONSTRAINT IF EXISTS producto_unidad_medida_check`
await sql`ALTER TABLE producto ADD CONSTRAINT producto_unidad_medida_check CHECK (unidad_medida IN ('gr', 'ml', 'un'))`
console.log('unidad_medida lista')
