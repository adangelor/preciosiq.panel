// BP-42 (10-oct-2026) -- por HTTP contra la API LOCAL: cambiar el EAN de un producto muda su regla de
// promo, y borrarlo la apaga. Cuenta de prueba 4, sucursal 999-9, EANs propios (2990000000xxx).
//   node bp42-http.mjs
import { ACCOUNT, api, sql } from './lib.mjs';

const VIEJO = '2990000000905', NUEVO = '2990000000912';
const limpiar = () => sql(`
DELETE FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN ('${VIEJO}','${NUEVO}');
DELETE FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId IN ('${VIEJO}','${NUEVO}');`);
const reglas = () => sql(`SELECT Ean, ISNULL(BranchId,'cuenta') AS Ambito, Tipo, Activa FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN ('${VIEJO}','${NUEVO}') ORDER BY Id`).trim();
const espejo = () => sql(`SELECT ProductId, Promo1UnitPrice, Promo1Text FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND BranchId = '999-9' AND ProductId IN ('${VIEJO}','${NUEVO}')`).trim();

limpiar();
let r = await api('PUT', '/api/caja/product', {
  businessAccountId: ACCOUNT, branchId: '999-9', ean: VIEJO, listPrice: 1000, description: 'BP42 prueba', brand: 'PRUEBA',
  presentationQuantity: 1, presentationUnit: 'UN',
  promoRule: { branchId: '999-9', tipo: 'precio_unitario', minQty: 2, maxQty: null, precioPromo: 800 },
});
console.log('1) alta con regla:', r.status);

r = await api('POST', '/api/business/prices/change-ean', { businessAccountId: ACCOUNT, branchId: '999-9', oldEan: VIEJO, newEan: NUEVO });
console.log('2) change-ean:', r.status, JSON.stringify({ ean: r.body?.ean, promo1UnitPrice: r.body?.promo1UnitPrice, promo1Text: r.body?.promo1Text }));
console.log(reglas());
console.log(espejo());

r = await api('DELETE', `/api/business/prices?businessAccountId=${ACCOUNT}&branchId=999-9&ean=${NUEVO}`);
console.log('3) delete:', r.status);
console.log(reglas());
limpiar();
