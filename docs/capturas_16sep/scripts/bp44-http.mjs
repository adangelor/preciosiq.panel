// BP-44 (10-oct-2026) -- por HTTP contra la API LOCAL: deshacer una carga CSV desanda sus reglas de promo.
// Cuenta de prueba 4, sucursal 999-9, mapeo 8 ("BP38 20 filas": ean;descripcion;precio;marca;precio_promo;
// leyenda;llevando_desde;llevando_hasta). La cuenta es free: se le da un trial por el rato de la prueba.
//   node bp44-http.mjs
import { ACCOUNT, api, sql } from './lib.mjs';

const A = '2990000000929', B = '2990000000936';
const EANS = `'${A}','${B}'`;
const reglas = () => sql(`SELECT Ean, Tipo, MinQty, PrecioPromo, Origen, Activa FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${EANS}) ORDER BY Id`).trim();
const espejo = () => sql(`SELECT ProductId, ListPrice, Promo1UnitPrice, Promo1Text FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND BranchId = '999-9' AND ProductId IN (${EANS}) ORDER BY ProductId`).trim();
const limpiar = (batchId) => sql(`
DELETE FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${EANS});
DELETE FROM dbo.ProductPriceHistory WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId IN (${EANS});
DELETE FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId IN (${EANS});
${batchId ? `DELETE FROM dbo.CsvImportBatchPromoRules WHERE BatchId = ${batchId};
DELETE FROM dbo.CsvImportBatchEan WHERE BatchId = ${batchId};
DELETE FROM dbo.CsvImportBatch WHERE Id = ${batchId} AND BusinessAccountId = ${ACCOUNT};` : ''}`);

limpiar();
sql(`UPDATE dbo.BusinessAccount SET TrialTier = 'cadena', TrialExpiresAt = DATEADD(day, 1, SYSUTCDATETIME()) WHERE Id = ${ACCOUNT} AND TrialTier IS NULL;`);
let batchId = null;
try {
  // B ya existe con una regla cargada a mano (900 llevando 3); A no existe.
  let r = await api('PUT', '/api/caja/product', {
    businessAccountId: ACCOUNT, branchId: '999-9', ean: B, listPrice: 1000, description: 'BP44 B', brand: 'PRUEBA',
    presentationQuantity: 1, presentationUnit: 'UN',
    promoRule: { branchId: '999-9', tipo: 'precio_unitario', minQty: 3, maxQty: null, precioPromo: 900 },
  });
  console.log('0) B con regla a mano:', r.status);

  const csv = [
    'ean;descripcion;precio;marca;precio_promo;leyenda;llevando_desde;llevando_hasta',
    `${A};BP44 A;1000,00;PRUEBA;800,00;;2;`,
    `${B};BP44 B;1100,00;PRUEBA;850,00;;2;`,
  ].join('\r\n');
  const form = new FormData();
  form.append('businessAccountId', String(ACCOUNT));
  form.append('branchId', '999-9');
  form.append('mappingId', '8');
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'bp44.csv');
  r = await api('POST', '/api/business/csv-import/run', form);
  batchId = r.body?.batchId;
  console.log('1) carga:', r.status, JSON.stringify({ created: r.body?.created, updated: r.body?.updated, promoRulesSaved: r.body?.promoRulesSaved, promoRulesDeactivated: r.body?.promoRulesDeactivated }));
  console.log(reglas());
  console.log(espejo());

  r = await api('POST', `/api/business/csv-import/batches/${batchId}/undo`, { businessAccountId: ACCOUNT });
  console.log('2) deshacer:', r.status, JSON.stringify({ restoredCount: r.body?.restoredCount, deletedCount: r.body?.deletedCount, promosDesactivadas: r.body?.promosDesactivadas, promosReactivadas: r.body?.promosReactivadas }));
  console.log(reglas());
  console.log(espejo());
} finally {
  limpiar(batchId);
  sql(`UPDATE dbo.BusinessAccount SET TrialTier = NULL, TrialExpiresAt = NULL WHERE Id = ${ACCOUNT} AND TrialTier = 'cadena';`);
}
