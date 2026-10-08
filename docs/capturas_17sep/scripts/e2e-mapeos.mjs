// Mapeos CSV (17-sep-2026) -- prueba de punta a punta en la copia local: API :5295 + panel
// :4200, cuenta de prueba 4. Deja PNG y JSON en preciosiq.panel/docs/capturas_17sep/.
//   node e2e-mapeos.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACCOUNT, api, login, sql } from '../../capturas_16sep/scripts/lib.mjs';
import { launch, Page, sleep } from '../../capturas_16sep/scripts/cdp.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = 'http://localhost:4200';
const png = (n) => join(OUT, n);
const q = (s) => JSON.stringify(s);
const resultados = {};

const mapeoBase = (name, extra = {}) => ({
  businessAccountId: ACCOUNT, name, delimiter: ';', decimalSeparator: ',',
  eanColumn: 'ean', priceColumn: 'precio', descriptionColumn: 'descripcion', brandColumn: 'marca',
  presentationQuantityColumn: null, presentationUnitColumn: null,
  promo1UnitPriceColumn: 'precio_promo', promo1TextColumn: 'leyenda',
  promo2UnitPriceColumn: null, promo2TextColumn: null,
  costPriceColumn: null, costPriceWithTaxColumn: null, supplierColumn: null, costValidFromColumn: null,
  promoMinQtyColumn: 'llevando_desde', promoMaxQtyColumn: 'llevando_hasta', promoPercentColumn: null,
  ...extra,
});

// ---------------------------------------------------------------- limpieza de corridas previas
sql(`DELETE FROM dbo.BusinessCsvImportMapping WHERE BusinessAccountId = ${ACCOUNT} AND (Name LIKE 'Mapeo roto%' OR Name LIKE 'Mapeo duplicado%' OR Name LIKE 'Con descuento %%' OR Name LIKE 'Export del sistema viejo%');`);

// ---------------------------------------------------------------- 1) sin duplicados
const uno = await api('POST', '/api/business/csv-import/mappings', mapeoBase('Export del sistema viejo'));
const dos = await api('POST', '/api/business/csv-import/mappings', mapeoBase('Export del sistema viejo (otro nombre)'));
resultados.sinDuplicados = {
  primera: { status: uno.status, id: uno.body.id },
  segunda: { status: dos.status, id: dos.body.id, nombreDevuelto: dos.body.name },
  mismoId: uno.body.id === dos.body.id,
};

// ---------------------------------------------------------------- 2) mapeo roto (columnas que son datos)
const roto = await api('POST', '/api/business/csv-import/mappings',
  mapeoBase('Mapeo roto (sin encabezados)', { eanColumn: '7791337007253', priceColumn: '6680.45', promo1UnitPriceColumn: null, promo1TextColumn: null, promoMinQtyColumn: null, promoMaxQtyColumn: null }));

// ---------------------------------------------------------------- 3) archivos de prueba
const archivoOk = join(OUT, '..', 'capturas_16sep', 'p4_carga_20_filas.csv');
const archivoOtro = join(OUT, 'otro_formato.csv');
writeFileSync(archivoOtro, ['CODIGO;NOMBRE;PVP', '7790001234567;Fideos;1200', '7790001234568;Arroz;1500'].join('\n'));
const archivoPct = join(OUT, 'carga_descuento_porcentaje.csv');
writeFileSync(archivoPct, [
  'ean;descripcion;marca;precio;precio_promo;descuento;leyenda;llevando_desde;llevando_hasta',
  '2997000000011;BP38 pct 1 (solo %);PRUEBA;1000;;15;15 % llevando 2;2;',
  '2997000000028;BP38 pct 2 (precio y %);PRUEBA;1000;850;10;;;',
  '2997000000035;BP38 pct 3 (% invalido);PRUEBA;1000;;120;;;',
  '2997000000042;BP38 pct 4 (sin promo);PRUEBA;1000;;;;;',
].join('\n'));
sql(`DELETE FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean LIKE '2997000%';
DELETE FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId LIKE '2997000%';`);

// ---------------------------------------------------------------- 4) UI
const chrome = await launch();
try {
  const token = await login();
  const p = await Page.open('about:blank');
  await p.goto(`${PANEL}/login`);
  await p.eval(`localStorage.setItem('retailiq.accessToken', ${q(token)}); true`);
  await p.goto(`${PANEL}/precios/mapeos`);
  await p.waitFor(`!!document.querySelector('.mappings__table tbody tr')`, 30000);
  await p.shot(png('m1_lista_de_mapeos.png'));
  resultados.tabla = await p.eval(`[...document.querySelectorAll('.mappings__table tbody tr')].map(tr => [...tr.querySelectorAll('td')].slice(0,4).map(td => td.innerText.replace(/\\s+/g,' ').trim()).join(' | ')).filter(Boolean)`);

  // Probar el mapeo "BP38 20 filas" (el que coincide) contra su archivo.
  const filaDe = async (nombre) => p.eval(`(() => {
    const filas = [...document.querySelectorAll('.mappings__table tbody tr')];
    const i = filas.findIndex(tr => tr.innerText.includes(${q(nombre)}));
    return i;
  })()`);
  async function abrirYProbar(nombre, archivo, capturas) {
    const i = await filaDe(nombre);
    if (i < 0) throw new Error(`no esta la fila ${nombre}`);
    await p.eval(`[...document.querySelectorAll('.mappings__table tbody tr')][${i}].querySelector('.mappings__secondary').click(); true`);
    await p.waitFor(`!!document.querySelector('.mappings__detail-row input[type=file]')`, 15000);
    const { root } = await p.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.mappings__detail-row input[type=file]' });
    await p.send('DOM.setFileInputFiles', { nodeId, files: [archivo.replace(/\//g, '\\')] });
    await p.eval(`document.querySelector('.mappings__detail-row input[type=file]').dispatchEvent(new Event('change', { bubbles: true })); true`);
    await p.eval(`[...document.querySelectorAll('.mappings__test button')].pop().click(); true`);
    await p.waitFor(`!!document.querySelector('.mappings__detail-row table')`, 20000);
    await p.shot(png(capturas));
    const texto = await p.eval(`document.querySelector('.mappings__detail-row').innerText`);
    // cerrar el detalle
    await p.eval(`[...document.querySelectorAll('.mappings__table tbody tr')][${i}].querySelector('.mappings__secondary').click(); true`);
    await sleep(300);
    return texto;
  }

  resultados.pruebaCoincide = await abrirYProbar('BP38 20 filas', archivoOk, 'm2_probar_mapeo_que_coincide.png');
  resultados.pruebaNoCoincide = await abrirYProbar('BP38 20 filas', archivoOtro, 'm3_probar_mapeo_que_no_coincide.png');
  resultados.pruebaMapeoRoto = await abrirYProbar('Mapeo roto', archivoOk, 'm4_probar_mapeo_roto.png');

  // Renombrar
  const iRoto = await filaDe('Mapeo roto');
  await p.eval(`(() => { const tr = [...document.querySelectorAll('.mappings__table tbody tr')][${iRoto}];
    [...tr.querySelectorAll('button')].find(b => b.textContent.includes('Renombrar')).click(); return true; })()`);
  await sleep(300);
  await p.eval(`(() => { const el = document.querySelector('.mappings__name-input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, 'Mapeo roto (revisar)'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await p.eval(`[...document.querySelectorAll('.mappings__table tbody tr')][${iRoto}].querySelector('button').click(); true`);
  await sleep(1200);
  resultados.renombrado = sql(`SELECT Id, Name, UpdatedAt FROM dbo.BusinessCsvImportMapping WHERE Id = ${roto.body.id}`).trim().split(/\r?\n/);

  // Archivar
  const iRoto2 = await filaDe('Mapeo roto (revisar)');
  await p.eval(`(() => { const tr = [...document.querySelectorAll('.mappings__table tbody tr')][${iRoto2}];
    [...tr.querySelectorAll('button')].find(b => b.textContent.includes('Archivar')).click(); return true; })()`);
  await sleep(1500);
  await p.shot(png('m5_despues_de_archivar.png'));
  resultados.archivado = {
    base: sql(`SELECT Id, Name, CASE WHEN ArchivedAt IS NULL THEN 'activo' ELSE 'archivado' END AS Estado FROM dbo.BusinessCsvImportMapping WHERE Id = ${roto.body.id}`).trim().split(/\r?\n/),
    listaActivos: (await api('GET', `/api/business/csv-import/mappings?businessAccountId=${ACCOUNT}`)).body.map((m) => m.name),
    listaConArchivados: (await api('GET', `/api/business/csv-import/mappings?businessAccountId=${ACCOUNT}&incluirArchivados=true`)).body.map((m) => `${m.name}${m.archivedAt ? ' (archivado)' : ''}`),
  };

  // La carga masiva ya no lo ofrece y muestra solo el ultimo usado.
  await p.goto(`${PANEL}/precios/carga-masiva`);
  await p.waitFor(`!!document.querySelector('input[type=file]')`, 20000);
  await p.eval(`(() => { const el = document.querySelector('[formcontrolname=branchId]'); if (el) { el.value = '999-9'; el.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  const { root: r2 } = await p.send('DOM.getDocument', { depth: -1 });
  const { nodeId: fileNode } = await p.send('DOM.querySelector', { nodeId: r2.nodeId, selector: 'input[type=file]' });
  await p.send('DOM.setFileInputFiles', { nodeId: fileNode, files: [archivoPct.replace(/\//g, '\\')] });
  await p.eval(`document.querySelector('input[type=file]').dispatchEvent(new Event('change', { bubbles: true })); true`);
  await p.eval(`document.querySelector('form button[type=submit]').click(); true`);
  await p.waitFor(`!!document.querySelector('.map-step')`, 20000);
  await p.shot(png('m6_carga_masiva_solo_ultimo_mapeo.png'));
  resultados.chipsEnCargaMasiva = await p.eval(`[...document.querySelectorAll('.saved-mappings .chip')].map(c => c.innerText.replace(/\\s+/g,' ').trim())`);

  // Mapeo nuevo con la columna de descuento %.
  await p.eval(`document.querySelector('.chip--new').click(); true`);
  await sleep(400);
  const set = async (name, value) => p.eval(`(() => { const el = document.querySelector('[formcontrolname=${name}]');
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await set('name', 'Con descuento %');
  await set('delimiter', ';');
  await set('decimalSeparator', ',');
  await set('eanColumn', 'ean');
  await set('priceColumn', 'precio');
  await set('descriptionColumn', 'descripcion');
  await set('brandColumn', 'marca');
  await set('promo1UnitPriceColumn', 'precio_promo');
  await set('promo1TextColumn', 'leyenda');
  await set('promoMinQtyColumn', 'llevando_desde');
  await set('promoPercentColumn', 'descuento');
  await p.shot(png('m7_mapeo_con_descuento_porcentaje.png'));
  await p.eval(`[...document.querySelectorAll('.map-step form button[type=submit]')].pop().click(); true`);
  await p.waitFor(`!!document.querySelector('.result-step')`, 60000);
  await p.shot(png('m8_resumen_con_descuento_porcentaje.png'));
  resultados.resumenDescuento = await p.eval(`document.querySelector('.result-step').innerText`);
  resultados.reglasDescuento = sql(`SELECT Ean, Tipo, MinQty, MaxQty, PrecioPromo, Porcentaje, Leyenda, Origen, Activa FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean LIKE '2997000%' ORDER BY Ean`).trim().split(/\r?\n/);
  resultados.espejoDescuento = sql(`SELECT ProductId, ListPrice, Promo1UnitPrice, Promo1Text FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId LIKE '2997000%' ORDER BY ProductId`).trim().split(/\r?\n/);
  p.close();
} finally {
  chrome.kill();
}

writeFileSync(join(OUT, 'e2e_mapeos.json'), JSON.stringify(resultados, null, 2));
console.log(JSON.stringify(resultados, null, 2));
