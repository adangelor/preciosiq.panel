import { Pipe, PipeTransform } from '@angular/core';

// E18.6 (26-ago-2026) -- COMO SE MUESTRA UNA MARCA, en un solo lugar.
//
// Hasta hoy la expresion `descripcion (marca)` estaba escrita cuatro veces en el panel
// (benchmark-dashboard, benchmark-detail-dialog y dos lugares de price-upsert), con dos
// criterios distintos: dos filtraban vacio con `p.brand ? ...` y los otros dos imprimian
// `({{ brand }})` sin mirar nada, asi que mostraban `()` con la marca vacia. Cambiar el
// criterio obligaba a tocar cuatro archivos y olvidarse de alguno.
//
// QUE HACE: devuelve la marca lista para mostrar, o null cuando no aporta nada. El
// llamador decide como pintarla; este pipe no arma parentesis ni HTML.
//
// QUE NO HACE, A PROPOSITO:
//   - NO normaliza ni corrige marcas. `(COFLE)` es "Cofler" truncada a 5 caracteres por
//     Supermercados DIA en su propio archivo SEPA (3,4 millones de filas; el segundo peor
//     tiene 17 veces menos). NO es un bug del front ni de la ingesta: es el dato de
//     origen. Que llegara al catalogo del comerciante fue un bug aparte, ya corregido en
//     el backend (ResolveNetworkBrandsAsync), y lo ya guardado lo limpia
//     Database/Fix_MerchantBrands_FromNetwork.sql. Si dentro de seis meses ves COFLE en
//     una pantalla, el arreglo esta en la base, no aca.
//   - NO fuerza mayusculas ni Title Case. Capitalizar rompe BGH, HP, LG, 3M, adidas y
//     L'Oreal, que se escriben como se escriben. La marca se muestra tal cual viene: si
//     esta mal escrita, se arregla donde se guardo.
//   - NO tiene un mapa de alias. Eso vive en dbo.BrandAliases (E18.1) y tiene que quedar
//     en un solo lado.
//
// Los centinelas se comparan sobre una clave normalizada (minusculas, sin espacios ni
// puntos ni guiones) para que "S/D", "s / d" y "S.D." caigan todos en la misma bolsa.
// 27-ago-2026 -- la lista se completó contra la del diagnóstico de marcas y la del script
// Database/Fix_MerchantBrands_FromNetwork.sql. Las tres tienen que decir lo mismo: si el
// front esconde un centinela que la base no limpia (o al revés), el comerciante ve una
// pantalla y el catálogo dice otra cosa.
const BRAND_SENTINELS = new Set([
  's/d',
  'sd',
  'sinmarca',
  'generico',
  'genérico',
  'generica',
  'genérica',
  'genericbrand',
  'noaplicamarca',
  'sansmarque',
  'indefinida',
  'n/a',
  'na',
  'n',
]);

@Pipe({ name: 'brandLabel', standalone: true })
export class BrandLabelPipe implements PipeTransform {
  transform(brand: string | null | undefined): string | null {
    if (!brand) return null;

    const trimmed = brand.trim();
    if (trimmed.length === 0) return null;

    // Una marca que despues de sacarle puntos, espacios y guiones no deja nada ('.', '-',
    // '...') tampoco aporta: no hace falta listarla como centinela.
    const key = trimmed.toLowerCase().replace(/[\s._-]/g, '');
    if (key.length === 0) return null;

    return BRAND_SENTINELS.has(key) ? null : trimmed;
  }
}
