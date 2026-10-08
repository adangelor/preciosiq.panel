// BP-38 §2.2 -- medicion de una carga CSV de 3.000 filas con promo, antes y despues de que
// el CSV cree reglas. Mismo flujo que el panel (features/csv-import): POST /mappings una vez
// y POST /run en tandas de 300 filas (environment.csvImport.chunkRows) en serie.
//
//   node csv-3000.mjs antes      -> mapeo con precio promo + leyenda (lo que existia)
//   node csv-3000.mjs despues    -> mapeo con precio promo + leyenda + llevando desde/hasta
//   node csv-3000.mjs limpiar    -> borra productos, reglas, historial y lotes de la prueba
//
// Productos de prueba: EAN 2991000000000..2991000002999 en la sucursal 999-8 de la cuenta 4.
// Cada modo corre DOS veces seguidas: la primera da de alta (o crea reglas), la segunda es la
// recarga tipica de una cadena (mismo archivo otra vez). Se miden las dos.
import { writeFileSync } from 'node:fs';
import { ACCOUNT, api, sql } from './lib.mjs';

const modo = process.argv[2] ?? 'antes';
const BRANCH = '999-8';
const N = 3000;
const CHUNK = 300;
const eanDe = (i) => String(2991000000000 + i);

if (modo === 'limpiar') {
  sql(`
DELETE FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean LIKE '2991000%';
DELETE FROM dbo.ProductPriceHistory WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId LIKE '2991000%';
DELETE FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId LIKE '2991000%';
DELETE FROM dbo.EanCatalog WHERE Ean LIKE '2991000%';
DELETE FROM dbo.CsvImportBatch WHERE BusinessAccountId = ${ACCOUNT} AND FileName LIKE 'bp38_3000%';
DELETE FROM dbo.BusinessCsvImportMapping WHERE BusinessAccountId = ${ACCOUNT} AND Name LIKE 'BP38 3000%';`);
  console.log('limpio');
  process.exit(0);
}

// Filas: todas con promo menor a lista; un tercio "llevando de 3 a 9999", un tercio minimo 2
// sin maximo, un tercio sin minimo (desde la primera unidad).
const lineas = ['ean;descripcion;marca;precio;precio_promo;leyenda;llevando_desde;llevando_hasta'];
for (let i = 0; i < N; i++) {
  const precio = 1000 + (i % 50) * 10;
  const promo = precio - 100;
  const [desde, hasta] = i % 3 === 0 ? ['3', '9999'] : i % 3 === 1 ? ['2', ''] : ['', ''];
  lineas.push(`${eanDe(i)};BP38 carga masiva ${i};PRUEBA;${precio};${promo};Oferta ${i % 7};${desde};${hasta}`);
}
const contenido = lineas.join('\n');
const archivo = `bp38_3000_${modo}.csv`;

const mapeo = await api('POST', '/api/business/csv-import/mappings', {
  businessAccountId: ACCOUNT, name: `BP38 3000 ${modo}`, delimiter: ';', decimalSeparator: ',',
  eanColumn: 'ean', descriptionColumn: 'descripcion', brandColumn: 'marca', priceColumn: 'precio',
  presentationQuantityColumn: null, presentationUnitColumn: null,
  promo1UnitPriceColumn: 'precio_promo', promo1TextColumn: 'leyenda', promo2UnitPriceColumn: null, promo2TextColumn: null,
  ...(modo === 'despues' ? { promoMinQtyColumn: 'llevando_desde', promoMaxQtyColumn: 'llevando_hasta' } : {}),
});
if (mapeo.status !== 201) throw new Error(`mapeo ${mapeo.status} ${JSON.stringify(mapeo.body)}`);

async function correr(vuelta) {
  const t0 = performance.now();
  let offset = 0;
  let batchId = null;
  let ultimo = null;
  let llamadas = 0;
  let promosIgnoradas = 0;
  let reglas = 0;
  for (;;) {
    const fd = new FormData();
    fd.append('businessAccountId', String(ACCOUNT));
    fd.append('branchId', BRANCH);
    fd.append('mappingId', String(mapeo.body.id));
    fd.append('offset', String(offset));
    fd.append('limit', String(CHUNK));
    if (batchId) fd.append('batchId', String(batchId));
    fd.append('file', new Blob([contenido], { type: 'text/csv' }), archivo);
    const r = await api('POST', '/api/business/csv-import/run', fd);
    llamadas++;
    if (r.status !== 200) throw new Error(`run ${r.status} ${JSON.stringify(r.body)}`);
    ultimo = r.body;
    batchId = r.body.batchId;
    promosIgnoradas += r.body.promosIgnoradas ?? 0;
    reglas += r.body.promoRulesSaved ?? 0;
    if (r.body.nextOffset === null) break;
    offset = r.body.nextOffset;
  }
  const ms = Math.round(performance.now() - t0);
  return { vuelta, ms, llamadas, created: ultimo.created, updated: ultimo.updated, failed: ultimo.failed, promosIgnoradas, reglasGuardadas: reglas };
}

const resultados = [await correr(1), await correr(2)];
const base = sql(`
SELECT COUNT(*) AS Productos, SUM(CASE WHEN Promo1UnitPrice IS NOT NULL THEN 1 ELSE 0 END) AS ConPromo1
FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND BranchId = '${BRANCH}' AND ProductId LIKE '2991000%';
SELECT Activa, COUNT(*) AS Reglas, MIN(MinQty) AS MinMin, MAX(MaxQty) AS MaxMax FROM dbo.BusinessPromoRules
WHERE BusinessAccountId = ${ACCOUNT} AND Ean LIKE '2991000%' GROUP BY Activa;`).trim().split(/\r?\n/);
const salida = { modo, fecha: new Date().toISOString(), filas: N, tanda: CHUNK, resultados, base };
writeFileSync(new URL(`../csv_3000_${modo}.json`, import.meta.url), JSON.stringify(salida, null, 2));
console.log(JSON.stringify(salida, null, 2));
