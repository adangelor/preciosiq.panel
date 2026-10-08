// BP-38 bloque 2 -- criterio de aceptacion de la extraccion a PromoRuleService: la API de la
// caja responde EXACTAMENTE lo mismo antes y despues. Mismos casos que Caja.http "Caja v1.1"
// y que la prueba de §6 de Caja_promos_estado_16sep.md (precio por cantidad, maximo, 3x2,
// 2da al 50 %, pesable rechazado y con porcentaje, ausente, null, regla de cuenta vs
// sucursal, validaciones, tickets con descuento bien / mal / regla offline, catalogo, dia),
// sobre EANs de prueba propios (2990000000xxx) para no tocar los de §6.
//
//   node regresion-caja.mjs antes     -> ../regresion_caja_antes.json
//   node regresion-caja.mjs despues   -> ../regresion_caja_despues.json
//
// Las respuestas se guardan normalizadas (sin ids ni fechas) para poder hacer diff.
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ACCOUNT, api, normalize, sql } from './lib.mjs';

const etapa = process.argv[2] ?? 'antes';
const EAN = { a: '2990000000011', b: '2990000000028', c: '2990000000035', d: '2990000000042', e: '2990000000059' };
const EANS = Object.values(EAN).map((e) => `'${e}'`).join(',');
const FECHA = '2026-09-01';
const DEVICE = 'bp38-regresion';

function limpiar() {
  sql(`
DELETE i FROM dbo.CajaTicketItems i JOIN dbo.CajaTickets t ON t.Id = i.TicketId WHERE t.DeviceId = '${DEVICE}';
DELETE FROM dbo.CajaTickets WHERE DeviceId = '${DEVICE}';
EXEC dbo.Caja_Agregar_Ventas_Dia @BusinessAccountId = ${ACCOUNT}, @Fecha = '${FECHA}';
DELETE FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${EANS});
DELETE FROM dbo.BusinessStock WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${EANS});
DELETE FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId IN (${EANS});`);
}

const pasos = [];
async function paso(nombre, method, path, body) {
  const r = await api(method, path, body);
  pasos.push({ nombre, status: r.status, body: normalize(r.body) });
  return r;
}

const prod = (ean, branchId, extra) => ({
  businessAccountId: ACCOUNT, branchId, ean, listPrice: 2500, description: `BP38 prueba ${ean}`, brand: 'PRUEBA',
  presentationQuantity: 1, presentationUnit: 'UN', ...extra,
});

limpiar();

// a) precio por cantidad 2.100 min 3, despues con max 6
await paso('a1 precio_unitario 2100 min 3', 'PUT', '/api/caja/product',
  prod(EAN.a, '999-9', { promoRule: { branchId: '999-9', tipo: 'precio_unitario', minQty: 3, maxQty: null, precioPromo: 2100 } }));
await paso('a2 precio_unitario con max 6', 'PUT', '/api/caja/product',
  prod(EAN.a, '999-9', { promoRule: { branchId: '999-9', tipo: 'precio_unitario', minQty: 3, maxQty: 6, precioPromo: 2100 } }));
// b) 3x2 sobre 1.000
await paso('b 3x2', 'PUT', '/api/caja/product',
  prod(EAN.b, '999-9', { listPrice: 1000, promoRule: { branchId: '999-9', tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2 } }));
// c) 2da al 50 %
await paso('c 2da al 50', 'PUT', '/api/caja/product',
  prod(EAN.c, '999-9', { listPrice: 1000, promoRule: { branchId: '999-9', tipo: 'enesima_porcentaje', minQty: 2, cadaN: 2, porcentaje: 50 } }));
// d) pesable: 3x2 rechazado, porcentaje ok
await paso('d1 pesable 3x2 -> 400', 'PUT', '/api/caja/product',
  prod(EAN.d, '999-9', { listPrice: 3500, presentationUnit: 'KG', promoRule: { tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2 } }));
await paso('d2 pesable 10 % min 2', 'PUT', '/api/caja/product',
  prod(EAN.d, '999-9', { listPrice: 3500, presentationUnit: 'KG', promoRule: { branchId: '999-9', tipo: 'porcentaje', minQty: 2, porcentaje: 10 } }));
// validaciones
await paso('v1 tipo desconocido', 'PUT', '/api/caja/product', prod(EAN.a, '999-9', { promoRule: { tipo: 'regalo', minQty: 1 } }));
await paso('v2 max < min', 'PUT', '/api/caja/product', prod(EAN.a, '999-9', { promoRule: { tipo: 'porcentaje', minQty: 3, maxQty: 2, porcentaje: 10 } }));
await paso('v3 promoRule no objeto', 'PUT', '/api/caja/product', prod(EAN.a, '999-9', { promoRule: 5 }));
await paso('v4 fechas al reves', 'PUT', '/api/caja/product', prod(EAN.a, '999-9', { promoRule: { tipo: 'porcentaje', minQty: 1, porcentaje: 10, validFrom: '2026-09-20', validTo: '2026-09-10' } }));
await paso('v5 3x2 min 2', 'PUT', '/api/caja/product', prod(EAN.b, '999-9', { listPrice: 1000, promoRule: { tipo: 'n_x_m', minQty: 2, grupoN: 3, pagaM: 2 } }));
// ausente: no toca la regla, espeja lo que manda la app
await paso('e1 ausente con promo1 de la app', 'PUT', '/api/caja/product',
  prod(EAN.a, '999-9', { listPrice: 2600, promo1UnitPrice: 2100, promo1Text: 'Llevando 3+: $2.100 c/u (máx. 6)' }));

// tickets: bien (a x8 max 6), bien (b x5), mal (c x5 con descuento 500), regla offline (d 2,5 kg sin promoRuleId)
const reglas = JSON.parse(JSON.stringify((await api('GET', `/api/caja/catalog?businessAccountId=${ACCOUNT}&branchId=999-9`)).body.items
  .filter((i) => Object.values(EAN).includes(i.ean)).map((i) => [i.ean, i.promoRule?.id ?? null])));
const ruleId = Object.fromEntries(reglas);
const item = (ean, quantity, listPrice, discount, promoRuleId, promoText) => {
  const lineTotal = Math.round(quantity * listPrice * 100) / 100 - discount;
  return { ean, description: `BP38 ${ean}`, quantity, unitPrice: Math.round((lineTotal / quantity) * 100) / 100, lineTotal, listPrice, discount, promoRuleId, promoText };
};
const ticket = (items) => ({
  ticketLocalId: randomUUID(), soldAtLocal: `${FECHA}T10:00:00`, total: items.reduce((s, i) => s + i.lineTotal, 0),
  paymentMethod: 'efectivo', amountTendered: null, wantsInvoice: false, items,
});
await paso('t tickets', 'POST', '/api/caja/tickets', {
  businessAccountId: ACCOUNT, branchId: '999-9', deviceId: DEVICE,
  tickets: [
    ticket([item(EAN.a, 8, 2600, 2400, ruleId[EAN.a], 'Llevando 3+: $2.100 c/u (máx. 6)')]),
    ticket([item(EAN.b, 5, 1000, 1000, ruleId[EAN.b], '3x2')]),
    ticket([item(EAN.c, 5, 1000, 500, ruleId[EAN.c], '2da al 50 %')]),
    ticket([item(EAN.d, 2.5, 3500, 875, null, '10 % llevando 2+')]),
  ],
});

// regla de cuenta (branchId null) desde 999-9, y la ven las dos sucursales
await paso('k1 regla de cuenta', 'PUT', '/api/caja/product',
  prod(EAN.e, '999-9', { listPrice: 1000, promoRule: { branchId: null, tipo: 'porcentaje', minQty: 1, porcentaje: 20 } }));
await paso('k2 mismo producto en 999-8', 'PUT', '/api/caja/product', prod(EAN.e, '999-8', { listPrice: 1000 }));
await paso('k3 regla de sucursal en 999-9 (gana)', 'PUT', '/api/caja/product',
  prod(EAN.e, '999-9', { listPrice: 1000, promoRule: { branchId: '999-9', tipo: 'n_x_m', minQty: 3, grupoN: 3, pagaM: 2 } }));
const cat = async (branch) => {
  const r = await api('GET', `/api/caja/catalog?businessAccountId=${ACCOUNT}&branchId=${branch}`);
  pasos.push({ nombre: `catalogo ${branch} (EANs de prueba)`, status: r.status, body: normalize(r.body.items.filter((i) => Object.values(EAN).includes(i.ean))) });
};
await cat('999-8');
await cat('999-9');
await paso('lookup e 999-8', 'GET', `/api/caja/product/${EAN.e}?businessAccountId=${ACCOUNT}&branchId=999-8`);
// null desde 999-9: desactiva la de la sucursal Y la de la cuenta
await paso('k4 null desde 999-9', 'PUT', '/api/caja/product', prod(EAN.e, '999-9', { listPrice: 1000, promoRule: null }));
await cat('999-8');
await paso('n null a', 'PUT', '/api/caja/product', prod(EAN.a, '999-9', { listPrice: 2600, promoRule: null }));
await paso('dia', 'GET', `/api/caja/day?businessAccountId=${ACCOUNT}&branchId=999-9&date=${FECHA}`);

pasos.push({
  nombre: 'base: reglas de los EANs de prueba',
  body: sql(`SELECT BranchId, Ean, Tipo, MinQty, MaxQty, PrecioPromo, Porcentaje, GrupoN, PagaM, CadaN, Activa FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${EANS}) ORDER BY Id`).trim().split(/\r?\n/),
});
pasos.push({
  nombre: 'base: espejo en Products',
  body: sql(`SELECT BranchId, ProductId, ListPrice, Promo1UnitPrice, Promo1Text FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId IN (${EANS}) ORDER BY BranchId, ProductId`).trim().split(/\r?\n/),
});
pasos.push({
  nombre: 'base: renglones de tickets',
  body: sql(`SELECT i.Ean, i.Quantity, i.ListPrice, i.Discount, i.LineTotal, CASE WHEN i.PromoRuleId IS NULL THEN 'null' ELSE 'id' END AS PromoRuleId, i.PromoText FROM dbo.CajaTicketItems i JOIN dbo.CajaTickets t ON t.Id = i.TicketId WHERE t.DeviceId = '${DEVICE}' ORDER BY i.Ean`).trim().split(/\r?\n/),
});

const out = new URL(`../regresion_caja_${etapa}.json`, import.meta.url);
writeFileSync(out, JSON.stringify(pasos, null, 2));
console.log(`${pasos.length} pasos -> ${out.pathname}`);
for (const p of pasos) console.log(`${p.status ?? '   '} ${p.nombre}`);
