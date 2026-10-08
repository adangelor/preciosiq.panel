// BP-38 (16-sep-2026) -- helpers comunes de los guiones de prueba contra la API LOCAL
// (dotnet run, http://localhost:5295). Nunca contra Hostinger. Node 22 (fetch nativo).
import { execFileSync } from 'node:child_process';

export const HOST = process.env.BP_HOST ?? 'http://localhost:5295';
export const ACCOUNT = 4;

let token = null;

export async function login() {
  if (token) return token;
  const r = await fetch(`${HOST}/api/identity/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'caja.prueba@buscaprecios.online', password: 'Caja2026x' }),
  });
  if (!r.ok) throw new Error(`login ${r.status} ${await r.text()}`);
  token = (await r.json()).accessToken;
  return token;
}

export async function api(method, path, body, { raw = false } = {}) {
  const t = await login();
  const headers = { Authorization: `Bearer ${t}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(`${HOST}${path}`, { method, headers, body: payload });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return raw ? { status: r.status, json } : { status: r.status, body: json };
}

/** sqlcmd contra la copia local. Devuelve las filas como texto (separador |). */
export function sql(query) {
  // QUOTED_IDENTIFIER ON: BusinessPromoRules tiene indice filtrado (sin esto el DELETE falla).
  // -b: que un error de SQL corte el guion en vez de seguir en silencio.
  return execFileSync('sqlcmd', ['-S', 'DESKTOP-O5KU4S3', '-E', '-C', '-b', '-d', 'Buscaprecios.Online', '-W', '-s', '|', '-Q', `SET QUOTED_IDENTIFIER ON; SET NOCOUNT ON; ${query}`], {
    encoding: 'latin1',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Saca de una respuesta lo que cambia entre corridas (ids, fechas) para poder comparar antes/despues. */
export function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (['id', 'ticketId', 'promoRuleId', 'updatedAtUtc', 'serverTimeUtc', 'ticketLocalId', 'previousListPrice', 'wasNewProduct'].includes(k)) {
        out[k] = val === null ? null : '<x>';
        continue;
      }
      out[k] = normalize(val);
    }
    return out;
  }
  return v;
}
