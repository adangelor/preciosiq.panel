// Corrector de precios en la tabla de anomalias (17-sep-2026) -- prueba de punta a punta en la
// copia local: se cargan dos productos con precio y promo normales, se importa un CSV con los
// precios corridos x100 (el clasico separador decimal mal configurado), y se corrigen las filas
// desde la misma tabla del resumen. PNG y JSON en preciosiq.panel/docs/capturas_17sep/.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACCOUNT, api, login, sql } from '../../capturas_16sep/scripts/lib.mjs';
import { launch, Page, sleep } from '../../capturas_16sep/scripts/cdp.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = 'http://localhost:4200';
const BRANCH = '999-9';
const png = (n) => join(OUT, n);
const q = (s) => JSON.stringify(s);
const res = {};

const A = '2998000000018'; // anomalia de precio de lista + promo (regla precio por cantidad)
const B = '2998000000025'; // anomalia de precio de lista, con una promo de PORCENTAJE (no editable aca)

sql(`DELETE FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean LIKE '2998000%';
DELETE FROM dbo.ProductPriceHistory WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId LIKE '2998000%';
DELETE FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId LIKE '2998000%';
DELETE FROM dbo.BusinessCsvImportMapping WHERE BusinessAccountId = ${ACCOUNT} AND Name = 'Corrector (x100)';`);

// Estado "bueno" previo: A con promo de precio por cantidad, B con promo de porcentaje.
await api('PUT', '/api/business/prices', {
  businessAccountId: ACCOUNT, branchId: BRANCH, ean: A, listPrice: 1529, description: 'Amargo de prueba x 1,5 Lt', brand: 'PRUEBA',
  presentationQuantity: 1, presentationUnit: 'UN', promoRule: { tipo: 'precio_unitario', minQty: 1, precioPromo: 1452.55 },
});
await api('PUT', '/api/business/prices', {
  businessAccountId: ACCOUNT, branchId: BRANCH, ean: B, listPrice: 399, description: 'Jugo de prueba x unidad', brand: 'PRUEBA',
  presentationQuantity: 1, presentationUnit: 'UN', promoRule: { tipo: 'porcentaje', minQty: 2, porcentaje: 10 },
});
res.antes = sql(`SELECT p.ProductId, p.ListPrice, p.Promo1UnitPrice, p.Promo1Text, r.Tipo, r.PrecioPromo, r.Porcentaje
FROM dbo.Products p LEFT JOIN dbo.BusinessPromoRules r ON r.Ean = p.ProductId AND r.BusinessAccountId = ${ACCOUNT} AND r.Activa = 1
WHERE p.CommerceId = '999-7' AND p.BannerId = '1' AND p.ProductId LIKE '2998000%' ORDER BY p.ProductId`).trim().split(/\r?\n/);

// El archivo "roto": precios y promos x100.
const archivo = join(OUT, 'carga_precios_corridos.csv');
writeFileSync(archivo, [
  'ean;descripcion;marca;precio;precio_promo',
  `${A};Amargo de prueba x 1,5 Lt;PRUEBA;152900;145255`,
  `${B};Jugo de prueba x unidad;PRUEBA;39900;`,
].join('\n'));

const chrome = await launch();
try {
  const token = await login();
  const p = await Page.open('about:blank');
  await p.goto(`${PANEL}/login`);
  await p.eval(`localStorage.setItem('retailiq.accessToken', ${q(token)}); true`);
  await p.goto(`${PANEL}/precios/carga-masiva`);
  await p.waitFor(`!!document.querySelector('input[type=file]')`, 30000);

  const set = async (name, value) => p.eval(`(() => { const el = document.querySelector('[formcontrolname=${name}]');
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  await set('branchId', BRANCH);
  const { root } = await p.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await p.send('DOM.setFileInputFiles', { nodeId, files: [archivo.replace(/\//g, '\\')] });
  await p.eval(`document.querySelector('input[type=file]').dispatchEvent(new Event('change', { bubbles: true })); true`);
  await p.eval(`document.querySelector('form button[type=submit]').click(); true`);
  await p.waitFor(`!!document.querySelector('.map-step')`, 20000);
  await p.eval(`document.querySelector('.chip--new').click(); true`);
  await sleep(400);
  await set('name', 'Corrector (x100)');
  await set('delimiter', ';');
  await set('decimalSeparator', ',');
  await set('eanColumn', 'ean');
  await set('priceColumn', 'precio');
  await set('descriptionColumn', 'descripcion');
  await set('brandColumn', 'marca');
  await set('promo1UnitPriceColumn', 'precio_promo');
  await p.eval(`[...document.querySelectorAll('.map-step form button[type=submit]')].pop().click(); true`);
  await p.waitFor(`!!document.querySelector('.anomaly-warning')`, 60000);
  await p.shot(png('c1_resumen_con_precios_para_revisar.png'));
  res.anomalias = await p.eval(`[...document.querySelectorAll('.anomaly-warning tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\\s+/g,' ').trim()).join(' | '))`);

  // Corregir la fila del PRECIO DE LISTA de A con "Volver al anterior".
  async function editarFila(indice, captura, { usarAnterior = true, promo = null } = {}) {
    await p.eval(`[...document.querySelectorAll('.anomaly-warning tbody tr')][${indice}].querySelector('.anomaly-fix__btn').click(); true`);
    await p.waitFor(`!!document.querySelector('.anomaly-fix input')`, 15000);
    if (usarAnterior) {
      await p.eval(`(() => { const b = [...document.querySelectorAll('.anomaly-fix button')].find(x => x.textContent.includes('Volver al anterior')); if (b) b.click(); return !!b; })()`);
      await sleep(200);
    }
    if (promo !== null) {
      await p.eval(`(() => { const inputs = document.querySelectorAll('.anomaly-fix input');
        const el = inputs[inputs.length - 1];
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${q(String(promo))});
        el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await sleep(200);
    }
    const estado = await p.eval(`(() => { const f = document.querySelector('.anomaly-fix__row');
      return { campos: [...f.querySelectorAll('input')].map(i => i.value), nota: f.innerText.replace(/\\s+/g,' ').trim() }; })()`);
    await p.shot(png(captura));
    await p.eval(`(() => { const b = [...document.querySelectorAll('.anomaly-fix button')].find(x => x.textContent.trim().startsWith('Guardar')); b.click(); return true; })()`);
    await p.waitFor(`!!document.querySelector('.anomaly-fix__ok') || !!document.querySelector('.anomaly-fix__row .form-error')`, 20000);
    await sleep(500);
    return estado;
  }

  res.edicionLista = await editarFila(0, 'c2_editar_precio_de_lista.png');
  res.tablaTrasPrimera = await p.eval(`[...document.querySelectorAll('.anomaly-warning tbody tr')].map(tr => tr.innerText.replace(/\\s+/g,' ').trim()).filter(t => t.includes('corregido'))`);
  await p.shot(png('c3_fila_corregida.png'));

  // La fila de la promo de A (regla "precio por cantidad"): se puede corregir aca.
  const filaPromo = await p.eval(`[...document.querySelectorAll('.anomaly-warning tbody tr')].findIndex(tr => tr.innerText.includes('Promo 1'))`);
  if (filaPromo >= 0) res.edicionPromo = await editarFila(filaPromo, 'c4_editar_promo.png');

  // La fila de B (promo de porcentaje): el precio de lista se corrige, la promo no se toca.
  const filaB = await p.eval(`[...document.querySelectorAll('.anomaly-warning tbody tr')].findIndex(tr => tr.innerText.includes('Jugo de prueba') && !tr.innerText.includes('corregido'))`);
  if (filaB >= 0) res.edicionB = await editarFila(filaB, 'c5_editar_con_promo_porcentaje.png');
  await p.shot(png('c6_todas_corregidas.png'));
  res.tablaFinal = await p.eval(`[...document.querySelectorAll('.anomaly-warning tbody tr')].map(tr => tr.innerText.replace(/\\s+/g,' ').trim())`);
  p.close();
} finally {
  chrome.kill();
}

res.despues = sql(`SELECT p.ProductId, p.ListPrice, p.Promo1UnitPrice, p.Promo1Text, r.Tipo, r.PrecioPromo, r.Porcentaje, r.Origen
FROM dbo.Products p LEFT JOIN dbo.BusinessPromoRules r ON r.Ean = p.ProductId AND r.BusinessAccountId = ${ACCOUNT} AND r.Activa = 1
WHERE p.CommerceId = '999-7' AND p.BannerId = '1' AND p.ProductId LIKE '2998000%' ORDER BY p.ProductId`).trim().split(/\r?\n/);
res.historial = sql(`SELECT ProductId, ChangeType, ListPrice, PrevListPrice, Source FROM dbo.ProductPriceHistory
WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId LIKE '2998000%' ORDER BY Id`).trim().split(/\r?\n/);

writeFileSync(join(OUT, 'e2e_corrector.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
