// BP-38 §5 -- prueba de punta a punta en la copia local: panel (ng serve :4200) + caja
// (ng serve :8100) + API (:5295/:7214). Cuenta de prueba 4, sucursales 999-9 y 999-8.
// Cada paso deja PNG y JSON en preciosiq.panel/docs/capturas_16sep/.
//
//   node e2e-bp38.mjs <paso>     paso = p1 | p2 | p3 | p4 | p6 | p7 | todos
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ACCOUNT, api, login, sql } from './lib.mjs';
import { launch, Page, sleep } from './cdp.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = 'http://localhost:4200';
const CAJA = 'http://localhost:8100';
const RES = join(OUT, 'e2e_resultados.json');
const resultados = existsSync(RES) ? JSON.parse(readFileSync(RES, 'utf8')) : {};
const guardar = (paso, data) => {
  resultados[paso] = { ...(resultados[paso] ?? {}), ...data, fecha: new Date().toISOString() };
  writeFileSync(RES, JSON.stringify(resultados, null, 2));
};
const png = (n) => join(OUT, n);
const q = (s) => JSON.stringify(s);

const EAN = {
  p1: '2995000000019',   // panel -> caja: precio por cantidad 2.100 min 3
  p2: '2995000000026',   // caja -> panel: 3x2
  p3: '2995000000033',   // formulario viejo: promo1UnitPrice 900
  p6: '2995000000040',   // todas las sucursales
  migA: '2994000000013', // migrados
  migB: '2994000000020',
};

// ------------------------------------------------------------------ helpers de sesion
let chrome;
async function panelPage() {
  const token = await login();
  const p = await Page.open('about:blank');
  await p.goto(`${PANEL}/login`);
  await p.eval(`localStorage.setItem('retailiq.accessToken', ${q(token)}); true`);
  await p.goto(`${PANEL}/precios/cargar`);
  await p.waitFor(`!!document.querySelector('input[formcontrolname=ean]') && !!document.querySelector('select[formcontrolname=branchId]')`, 30000);
  return p;
}

async function cajaPage(branchId) {
  const token = await login();
  const p = await Page.open('about:blank', { width: 412, height: 915, mobile: true });
  await p.goto(`${CAJA}/login`);
  const user = { email: 'caja.prueba@buscaprecios.online' };
  const branch = { businessAccountId: ACCOUNT, razonSocial: 'Almacen Caja Prueba', branchId, branchName: branchId === '999-9' ? 'Sucursal Barrio' : 'Casa central' };
  await p.eval(`localStorage.setItem('caja-auth-token', ${q(token)}); localStorage.setItem('caja-user', ${q(JSON.stringify(user))});
    localStorage.setItem('CapacitorStorage.caja.branch', ${q(JSON.stringify(branch))}); true`);
  await p.goto(`${CAJA}/caja`);
  await p.waitFor(`!!document.querySelector('app-caja') && !!window.ng && !!ng.getComponent(document.querySelector('app-caja'))`, 60000);
  return p;
}

const CAJA_CMP = `ng.getComponent(document.querySelector('app-caja'))`;

/** Sincroniza la caja (sube pendientes + `since` del catalogo), como el boton de la app. */
async function cajaSync(p) {
  // syncNow no hace nada si ya hay un sync corriendo (el de arranque de la app): se espera
  // a que termine y se corre uno propio, que trae el `since` del catalogo.
  await p.eval(`(async () => {
    const c = ${CAJA_CMP};
    const esperar = async () => { for (let i = 0; i < 200 && c.sync.syncing(); i++) await new Promise(r => setTimeout(r, 100)); };
    c.sync.online.set(true);
    await esperar();
    await c.sync.syncNow();
    await esperar();
    await c.catalog.reload(c.branch());
    return true;
  })()`);
}

/** Vende `cant` unidades de un EAN en el ticket (vacio antes) y devuelve el renglon. */
async function cajaVender(p, ean, cant) {
  return p.eval(`(async () => {
    const c = ${CAJA_CMP};
    c.cart.clear();
    await c.handleEan(${q(ean)});
    c.cart.setQuantity(${q(ean)}, ${cant});
    const l = c.cart.lines().find(x => x.ean === ${q(ean)});
    ng.applyChanges(document.querySelector('app-caja'));
    return l ? { ean: l.ean, cantidad: l.quantity, lista: l.listPrice, descuento: l.discount, total: l.lineTotal, promoText: l.promoText, regla: l.promoRule ? (l.promoRule.texto ?? l.promoRule.tipo) : null, ticketTotal: c.cart.total() } : null;
  })()`);
}

/** Setea un control de formulario del panel como lo haria una persona (input + change). */
async function panelSet(p, formControlName, value) {
  await p.eval(`(() => {
    const el = document.querySelector('[formcontrolname=${formControlName}]');
    if (!el) throw new Error('no esta el control ${formControlName}');
    if (el.type === 'checkbox') { el.checked = ${q(!!value)}; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    el.focus();
    el.value = ${q(value === null ? '' : String(value))};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
  })()`);
}

async function panelElegirEan(p, branchId, ean) {
  await panelSet(p, 'branchId', branchId);
  await panelSet(p, 'ean', ean);
  await sleep(1800); // debounce 300 + busqueda + GET /products?ean=
}

async function panelGuardar(p) {
  await p.eval(`document.querySelector('.signup__form button[type=submit]').click(); true`);
  await p.waitFor(`!!document.querySelector('.toast__text') || !!document.querySelector('.form-error')`, 20000);
  return p.eval(`document.querySelector('.toast__text')?.textContent?.trim() ?? ('ERROR: ' + document.querySelector('.form-error')?.textContent?.trim())`);
}

const productos = async (ean, branchId) =>
  (await api('GET', `/api/business/prices/products?businessAccountId=${ACCOUNT}&ean=${ean}${branchId ? `&branchId=${branchId}` : ''}`)).body;

const reglas = (eans) =>
  sql(`SELECT Id, BranchId, Ean, Tipo, MinQty, MaxQty, PrecioPromo, Porcentaje, GrupoN, PagaM, Leyenda, Origen, Activa FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${eans.map((e) => `'${e}'`).join(',')}) ORDER BY Ean, Id`).trim().split(/\r?\n/);

const espejo = (eans) =>
  sql(`SELECT BranchId, ProductId, ListPrice, Promo1UnitPrice, Promo1Text, Promo2Text FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId IN (${eans.map((e) => `'${e}'`).join(',')}) ORDER BY ProductId, BranchId`).trim().split(/\r?\n/);

function limpiarEans(eans) {
  const list = eans.map((e) => `'${e}'`).join(',');
  sql(`DELETE FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${list});
DELETE FROM dbo.BusinessStock WHERE BusinessAccountId = ${ACCOUNT} AND Ean IN (${list});
DELETE FROM dbo.Products WHERE CommerceId = '999-7' AND BannerId = '1' AND ProductId IN (${list});`);
}

// ------------------------------------------------------------------ pasos
async function p1() {
  limpiarEans([EAN.p1]);
  const panel = await panelPage();
  await panelElegirEan(panel, '999-9', EAN.p1);
  await panelSet(panel, 'description', 'BP38 Gaseosa panel a caja 1,5 L');
  await panelSet(panel, 'brand', 'PRUEBA');
  await panelSet(panel, 'listPrice', 2500);
  await panelSet(panel, 'tipo', 'precio_unitario');
  await sleep(300);
  await panelSet(panel, 'precio', 2100);
  await panelSet(panel, 'min', 3);
  const preview = await panel.eval(`document.querySelector('.promo__preview')?.textContent?.trim() ?? null`);
  await panel.shot(png('p1_01_panel_form_precio_por_cantidad.png'));
  const toast = await panelGuardar(panel);
  await panel.shot(png('p1_02_panel_guardado.png'), { fullPage: false });
  panel.close();

  const caja = await cajaPage('999-9');
  await cajaSync(caja);
  const x2 = await cajaVender(caja, EAN.p1, 2);
  await caja.shot(png('p1_03_caja_x2_lista.png'), { fullPage: false });
  const x3 = await cajaVender(caja, EAN.p1, 3);
  await caja.shot(png('p1_04_caja_x3_promo.png'), { fullPage: false });
  caja.close();

  const red = await productos(EAN.p1, '999-9');
  writeFileSync(png('p1_05_red_products.json'), JSON.stringify(red, null, 2));
  guardar('p1', { preview, toast, caja_x2: x2, caja_x3: x3, red: red.items?.[0], reglas: reglas([EAN.p1]), espejo: espejo([EAN.p1]) });
}

async function p2() {
  limpiarEans([EAN.p2]);
  const caja = await cajaPage('999-9');
  await caja.goto(`${CAJA}/producto?ean=${EAN.p2}`);
  await caja.waitFor(`!!window.ng && !!document.querySelector('app-producto') && !!ng.getComponent(document.querySelector('app-producto'))`, 30000);
  await caja.eval(`(() => { const c = ng.getComponent(document.querySelector('app-producto'));
    c.description = 'BP38 Pan casero caja a panel'; c.brand = 'PRUEBA'; c.listPrice = 1000; c.presentationUnit = 'UN';
    c.promoTipo = 'n_x_m'; c.onPromoTipoChange(); ng.applyChanges(document.querySelector('app-producto')); return true; })()`);
  await caja.shot(png('p2_01_caja_producto_3x2.png'));
  await caja.eval(`ng.getComponent(document.querySelector('app-producto')).save()`);
  await sleep(1500);
  caja.close();
  const reglaCaja = reglas([EAN.p2]);

  const panel = await panelPage();
  await panelElegirEan(panel, '999-9', EAN.p2);
  const traida = await panel.eval(`({ tipo: document.querySelector('select[formcontrolname=tipo]').value,
    grupoN: document.querySelector('[formcontrolname=grupoN]')?.value, pagaM: document.querySelector('[formcontrolname=pagaM]')?.value,
    min: document.querySelector('[formcontrolname=min]')?.value, vigente: document.querySelector('.promo__loaded')?.textContent?.replace(/\\s+/g,' ').trim(),
    listPrice: document.querySelector('[formcontrolname=listPrice]').value })`);
  await panel.shot(png('p2_02_panel_trae_3x2.png'));
  // Solo un cambio de precio: la seccion Promo no se toca -> promoRule ausente.
  await panelSet(panel, 'listPrice', 1100);
  const toast = await panelGuardar(panel);
  await panel.shot(png('p2_03_panel_solo_precio_guardado.png'), { fullPage: false });
  panel.close();

  guardar('p2', { reglaCreadaEnCaja: reglaCaja, panelTrae: traida, toast, reglasDespuesDeGuardarPrecio: reglas([EAN.p2]), espejo: espejo([EAN.p2]), red: (await productos(EAN.p2, '999-9')).items?.[0] });
}

async function p3() {
  limpiarEans([EAN.p3]);
  const base = { businessAccountId: ACCOUNT, branchId: '999-9', ean: EAN.p3, listPrice: 1000, description: 'BP38 Yerba formulario viejo', brand: 'PRUEBA', presentationQuantity: 1, presentationUnit: 'UN' };
  // Lo que manda un formulario viejo del panel: sin promoRule, con promo1UnitPrice.
  const conPromo = await api('PUT', '/api/business/prices', { ...base, promo1UnitPrice: 900, promo1Text: null, promo2UnitPrice: null, promo2Text: null });
  const reglasA = reglas([EAN.p3]);
  const vacio = await api('PUT', '/api/business/prices', { ...base, listPrice: 1050, promo1UnitPrice: null, promo1Text: null, promo2UnitPrice: null, promo2Text: null });
  const reglasB = reglas([EAN.p3]);
  writeFileSync(png('p3_01_put_viejo_con_promo.json'), JSON.stringify(conPromo, null, 2));
  writeFileSync(png('p3_02_put_viejo_promo_vacia.json'), JSON.stringify(vacio, null, 2));

  const caja = await cajaPage('999-9');
  await cajaSync(caja);
  const x1 = await cajaVender(caja, EAN.p3, 1);
  await caja.shot(png('p3_03_caja_cobra_regla_convertida.png'), { fullPage: false });
  caja.close();
  guardar('p3', { putConPromo: { status: conPromo.status, promo1UnitPrice: conPromo.body.promo1UnitPrice, promoRuleTexto: conPromo.body.promoRuleTexto }, reglasTrasPromo900: reglasA,
    putVacio: { status: vacio.status, promo1UnitPrice: vacio.body.promo1UnitPrice, promoRuleTexto: vacio.body.promoRuleTexto }, reglasTrasVacio: reglasB, caja_x1: x1, espejo: espejo([EAN.p3]) });
}

// CSV de 20 filas por la UI del panel.
const CSV_EANS = Array.from({ length: 20 }, (_, i) => String(2996000000000 + i + 1));
async function p4() {
  limpiarEans(CSV_EANS);
  sql(`DELETE FROM dbo.BusinessCsvImportMapping WHERE BusinessAccountId = ${ACCOUNT} AND Name LIKE 'BP38 20 filas%';`);
  // La fila 5 tiene que tener regla ANTES (la carga con promo vacia la tiene que desactivar).
  await api('PUT', '/api/caja/product', { businessAccountId: ACCOUNT, branchId: '999-9', ean: CSV_EANS[4], listPrice: 1000, description: 'BP38 CSV 5', brand: 'PRUEBA', presentationQuantity: 1, presentationUnit: 'UN',
    promoRule: { branchId: '999-9', tipo: 'porcentaje', minQty: 2, porcentaje: 10 } });

  const filas = [
    ['ean', 'descripcion', 'marca', 'precio', 'precio_promo', 'leyenda', 'llevando_desde', 'llevando_hasta'],
    [CSV_EANS[0], 'BP38 CSV 1 llevando de 3 a 9999', 'PRUEBA', '2500', '2100', '', '3', '9999'],
    [CSV_EANS[1], 'BP38 CSV 2 sin minimo', 'PRUEBA', '1000', '850', '', '', ''],
    [CSV_EANS[2], 'BP38 CSV 3 promo mayor a lista', 'PRUEBA', '1000', '1200', '', '2', ''],
    [CSV_EANS[3], 'BP38 CSV 4 minimo ilegible', 'PRUEBA', '1000', '800', '', 'tres', ''],
    [CSV_EANS[4], 'BP38 CSV 5 promo vacia (tenia regla)', 'PRUEBA', '1000', '', '', '', ''],
    [CSV_EANS[5], 'BP38 CSV 6 leyenda 2x1400', 'PRUEBA', '1000', '700', '2x1400', '2', ''],
  ];
  for (let i = 6; i < 20; i++) {
    const conPromo = i % 2 === 0;
    filas.push([CSV_EANS[i], `BP38 CSV ${i + 1}`, 'PRUEBA', String(1000 + i * 10), conPromo ? String(900 + i * 10) : '', conPromo ? `Oferta ${i + 1}` : '', conPromo ? '2' : '', conPromo ? '12' : '']);
  }
  const csvPath = join(OUT, 'p4_carga_20_filas.csv');
  writeFileSync(csvPath, filas.map((f) => f.join(';')).join('\n'));

  const panel = await panelPage();
  await panel.goto(`${PANEL}/precios/carga-masiva`);
  await panel.waitFor(`!!document.querySelector('input[type=file]')`, 30000);

  async function subir(nombreMapeo, captura) {
    await panelSet(panel, 'branchId', '999-9');
    const { root } = await panel.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await panel.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
    await panel.send('DOM.setFileInputFiles', { nodeId, files: [csvPath.replace(/\//g, '\\')] });
    await panel.eval(`document.querySelector('input[type=file]').dispatchEvent(new Event('change', { bubbles: true })); true`);
    await panel.eval(`document.querySelector('form button[type=submit]').click(); true`);
    await panel.waitFor(`!!document.querySelector('.map-step')`, 20000);
    if (nombreMapeo) {
      const nuevo = await panel.eval(`!!document.querySelector('.chip--new')`);
      if (nuevo) await panel.eval(`document.querySelector('.chip--new').click(); true`);
      await sleep(300);
      await panelSet(panel, 'name', nombreMapeo);
      await panelSet(panel, 'delimiter', ';');
      await panelSet(panel, 'decimalSeparator', ',');
      await panelSet(panel, 'eanColumn', 'ean');
      await panelSet(panel, 'priceColumn', 'precio');
      await panelSet(panel, 'descriptionColumn', 'descripcion');
      await panelSet(panel, 'brandColumn', 'marca');
      await panelSet(panel, 'promo1UnitPriceColumn', 'precio_promo');
      await panelSet(panel, 'promo1TextColumn', 'leyenda');
      await panelSet(panel, 'promoMinQtyColumn', 'llevando_desde');
      await panelSet(panel, 'promoMaxQtyColumn', 'llevando_hasta');
      await panel.shot(png(captura[0]));
      await panel.eval(`[...document.querySelectorAll('.map-step form button[type=submit]')].pop().click(); true`);
    } else {
      await panel.shot(png(captura[0]), { fullPage: false });
      await panel.eval(`[...document.querySelectorAll('.map-step button')].find(b => b.textContent.includes('Cargar con este mapeo')).click(); true`);
    }
    await panel.waitFor(`!!document.querySelector('.result-step')`, 60000);
    await panel.shot(png(captura[1]));
    return panel.eval(`document.querySelector('.result-step').innerText`);
  }

  const idsAntes = sql(`SELECT COUNT(*) FROM dbo.BusinessPromoRules WHERE BusinessAccountId = ${ACCOUNT} AND Ean LIKE '2996%'`).trim();
  const resumen1 = await subir('BP38 20 filas', ['p4_01_panel_mapeo_min_max.png', 'p4_02_panel_resumen_carga.png']);
  const reglas1 = reglas(CSV_EANS);
  const espejo1 = espejo(CSV_EANS);
  await panel.eval(`[...document.querySelectorAll('.result-step button')].find(b => b.textContent.includes('Cargar otro archivo')).click(); true`);
  await sleep(500);
  const resumen2 = await subir(null, ['p4_03_panel_repetir_con_mapeo.png', 'p4_04_panel_resumen_repetida.png']);
  const reglas2 = reglas(CSV_EANS);
  panel.close();
  guardar('p4', { reglasPrevias: idsAntes, resumen1, reglas1, espejo1, resumen2, reglas2, iguales: JSON.stringify(reglas1) === JSON.stringify(reglas2) });
}

async function p6() {
  limpiarEans([EAN.p6]);
  // El producto existe en las dos sucursales (alta sin promo en 999-8 por la API del panel).
  await api('PUT', '/api/business/prices', { businessAccountId: ACCOUNT, branchId: '999-8', ean: EAN.p6, listPrice: 1000, description: 'BP38 Galletitas todas las sucursales', brand: 'PRUEBA', presentationQuantity: 1, presentationUnit: 'UN' });

  const panel = await panelPage();
  await panelElegirEan(panel, '999-9', EAN.p6);
  await panelSet(panel, 'description', 'BP38 Galletitas todas las sucursales');
  await panelSet(panel, 'brand', 'PRUEBA');
  await panelSet(panel, 'listPrice', 1000);
  await panelSet(panel, 'tipo', 'porcentaje');
  await sleep(300);
  await panelSet(panel, 'porcentaje', 20);
  await panelSet(panel, 'min', 1);
  await panelSet(panel, 'todasLasSucursales', true);
  await panel.shot(png('p6_01_panel_regla_de_cuenta.png'));
  const toast = await panelGuardar(panel);
  panel.close();
  const reglasCuenta = reglas([EAN.p6]);
  const espejoCuenta = espejo([EAN.p6]);

  const caja8 = await cajaPage('999-8');
  await cajaSync(caja8);
  const v8 = await cajaVender(caja8, EAN.p6, 1);
  await caja8.shot(png('p6_02_caja_999-8_regla_de_cuenta.png'), { fullPage: false });
  caja8.close();
  const caja9 = await cajaPage('999-9');
  await cajaSync(caja9);
  const v9 = await cajaVender(caja9, EAN.p6, 1);
  await caja9.shot(png('p6_03_caja_999-9_regla_de_cuenta.png'), { fullPage: false });

  // Regla de SUCURSAL en 999-9 (desde el panel): gana ahi; 999-8 sigue con la de cuenta.
  const suc = await api('PUT', '/api/business/prices', { businessAccountId: ACCOUNT, branchId: '999-9', ean: EAN.p6, listPrice: 1000,
    promoRule: { tipo: 'precio_unitario', minQty: 1, precioPromo: 700 }, promoRuleTodasLasSucursales: false });
  await cajaSync(caja9);
  const v9b = await cajaVender(caja9, EAN.p6, 1);
  await caja9.shot(png('p6_04_caja_999-9_gana_la_de_sucursal.png'), { fullPage: false });
  caja9.close();
  const caja8b = await cajaPage('999-8');
  await cajaSync(caja8b);
  const v8b = await cajaVender(caja8b, EAN.p6, 1);
  caja8b.close();
  guardar('p6', { toast, reglasCuenta, espejoCuenta, caja_999_8: v8, caja_999_9: v9, putSucursal: { status: suc.status, promoRuleTexto: suc.body.promoRuleTexto },
    caja_999_9_con_regla_de_sucursal: v9b, caja_999_8_sigue_cuenta: v8b, reglasFinal: reglas([EAN.p6]), espejoFinal: espejo([EAN.p6]) });
}

async function p7() {
  // Migracion: las reglas de Promos_Panel_migrar_existentes.sql entran en el `since` de la caja.
  const since = '2026-09-16T21:30:00Z';
  const cat = await api('GET', `/api/caja/catalog?businessAccountId=${ACCOUNT}&branchId=999-9&since=${since}`);
  const migrados = cat.body.items.filter((i) => [EAN.migA, EAN.migB].includes(i.ean)).map((i) => ({ ean: i.ean, listPrice: i.listPrice, promo1UnitPrice: i.promo1UnitPrice, promo1Text: i.promo1Text, updatedAtUtc: i.updatedAtUtc, promoRule: i.promoRule }));
  writeFileSync(png('p7_01_catalog_since.json'), JSON.stringify({ since, items: migrados }, null, 2));
  const caja = await cajaPage('999-9');
  await cajaSync(caja);
  const a = await cajaVender(caja, EAN.migA, 1);
  await caja.shot(png('p7_02_caja_cobra_migrado_A.png'), { fullPage: false });
  const b = await cajaVender(caja, EAN.migB, 2);
  await caja.shot(png('p7_03_caja_cobra_migrado_B.png'), { fullPage: false });
  caja.close();
  guardar('p7', { sinceItems: migrados.length, migrados, caja_A: a, caja_B: b });
}

// §3.3 -- la lista "Mis productos" del panel: texto de la regla, marca "todas las sucursales"
// y, para un dato viejo (Promo1 sin regla), "sin regla: la caja no la cobra" en gris.
async function lista() {
  const viejo = '2994000000037';
  limpiarEans([viejo]);
  sql(`INSERT INTO dbo.Products (CommerceId,BannerId,BranchId,ProductId,IsEan,Description,PresentationQuantity,PresentationUnit,Brand,ListPrice,ReferencePrice,ReferenceQuantity,ReferenceUnit,Promo1UnitPrice,Promo1Text)
       VALUES ('999-7','1','999-9','${viejo}',1,'BP38 Dato viejo sin regla',1,'UN','PRUEBA',1000,1000,1,'UN',900,'Promo vieja');`);
  // En que pagina de 20 cae el primer "BP38" de 999-9 (orden: sucursal, descripcion).
  const todos = (await api('GET', `/api/business/prices/products?businessAccountId=${ACCOUNT}&page=1&pageSize=100`)).body.items;
  const idx = todos.findIndex((i) => i.branchId === '999-9' && i.description.startsWith('BP38 D'));
  const pagina = Math.floor(idx / 20) + 1;
  const panel = await panelPage();
  await panel.eval(`(() => { const c = ng.getComponent(document.querySelector('app-price-upsert')); c.loadProductsPage(${pagina}); return true; })()`);
  await panel.waitFor(`!!document.querySelector('.plan-limit__table')`, 20000);
  await panel.eval(`document.querySelector('.plan-limit').scrollIntoView(); true`);
  await panel.shot(png('p5_lista_mis_productos.png'));
  const filas = await panel.eval(`[...document.querySelectorAll('.plan-limit__table tbody tr')].map(tr => [...tr.querySelectorAll('td')].slice(1, 6).map(td => td.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')).filter(t => t.includes('BP38') || t.includes('2994'))`);
  panel.close();
  limpiarEans([viejo]);
  guardar('lista', { pagina, filas });
}

const pasos = { p1, p2, p3, p4, p6, p7, lista };
const arg = process.argv[2] ?? 'todos';
chrome = await launch();
try {
  for (const [nombre, fn] of Object.entries(pasos)) {
    if (arg !== 'todos' && arg !== nombre) continue;
    console.log(`== ${nombre}`);
    await fn();
    console.log(JSON.stringify(resultados[nombre], null, 2));
  }
} finally {
  chrome.kill();
}
