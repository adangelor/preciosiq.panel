// Espejo de Data/DTOs/AdvisorDtos.cs -- Asesor de Precios, fase 1 (21-ago-2026,
// PreciosIQ_Asesor_Spec.md). El digest viaja junto al informe para que el panel
// pueda mostrar la evidencia expandible sin otra llamada.

export interface AdvisorMetadata {
  branchId: string;
  branchName: string;
  maxDistanceMeters: number;
  generatedAtUtc: string;
  planTier: string;
  tieneCostosCargados: boolean;
  tieneVentasCargadas: boolean;
  diasDeVentasCargados: number;
  /** BP-74: precios de la competencia que no entraron a la referencia por no confirmados (0 en informes viejos). */
  preciosCompetenciaDescartados?: number;
  /** BP-75: la competencia del radio (cadenas por nombre; independientes solo como cantidad). */
  competidores?: AdvisorCompetidor[] | null;
  cadenasHastaRadioMaximo?: string[] | null;
  radioMaximoMeters?: number;
  /** "La Anonima" / "Vea y Market" con 1 o 2 cadenas; null = "la zona". */
  referenciaNombrada?: string | null;
  ampliarSumaCompetencia?: boolean;
  /** BP-78: cuantos productos testigo confirmo la cuenta (0 o ausente en informes viejos). */
  testigosConfirmados?: number;
  testigosHuella?: string | null;
}

export interface AdvisorCompetidor {
  tipo: 'cadena' | 'independientes';
  nombre: string | null;
  sucursales: number;
  kmMasCercana: number | null;
}

export interface AdvisorResumen {
  categoriasConDatos: number;
  categoriasTotales: number;
  deltaPromedioPonderadoPct: number | null;
  categoriasMasCaras: number;
  categoriasMasBaratas: number;
  productosPropiosConPrecio: number;
  productosMatcheadosConZona: number;
}

export interface AdvisorProducto {
  ean: string;
  descripcion: string | null;
  categoria: string;
  subcategoria: string | null;
  precioPropio: number;
  precioRefZona: number;
  deltaPct: number;
  referenciasSepa: string[];
}

export interface AdvisorCategoriaFueraDeLinea {
  categoria: string;
  subcategoria: string | null;
  deltaPct: number;
  productosMatcheados: number;
}

export interface AdvisorCompetitividad {
  masCarosQueZona: AdvisorProducto[];
  espacioParaSubir: AdvisorProducto[];
  categoriasFueraDeLinea: AdvisorCategoriaFueraDeLinea[];
}

export interface AdvisorTeaser {
  nivel: string;
  motivo: 'plan' | 'datos';
  mensaje: string;
  productosAfectados: number | null;
}

// 31-ago-2026 -- rentabilidad/ganancia dejan de ser `unknown`. El informe pasa a
// mostrar TABLAS armadas desde el digest (no desde el markdown del LLM), asi que el
// front necesita estos tipos de verdad. Espejo exacto de AdvisorDtos.cs.

export interface AdvisorProductoBajoCosto {
  ean: string;
  descripcion: string | null;
  categoria: string;
  precioPropio: number;
  costo: number;
  proveedor: string | null;
}

export interface AdvisorProductoRenegociar {
  ean: string;
  descripcion: string | null;
  categoria: string;
  costo: number;
  precioVentaZona: number;
  proveedor: string | null;
}

export interface AdvisorProductoMargen {
  ean: string;
  descripcion: string | null;
  categoria: string;
  precioPropio: number;
  costo: number;
  margenPct: number;
  deltaVsZonaPct: number;
}

export interface AdvisorRentabilidad {
  ventaBajoCosto: AdvisorProductoBajoCosto[];
  renegociarCompra: AdvisorProductoRenegociar[];
  margenExpuesto: AdvisorProductoMargen[];
  margenPromedioPct: number | null;
}

// 31-ago-2026 -- posicion x rotacion. El numero en pesos es SIEMPRE positivo; lo que
// significa lo dice sentidoImpacto. Ver el comentario largo en AdvisorDtos.cs.
export interface AdvisorOportunidadEnPesos {
  ean: string;
  descripcion: string | null;
  categoria: string;
  accion: string;                // "subir" | "sostener" | "bajar" | "revisar-surtido"
  impactoMensualPesos: number;
  sentidoImpacto: string;        // "ganancia" | "riesgo" | "resigna" | "ninguno"
  unidadesMensuales: number;
  deltaPct: number;
  percentilRotacion: number;     // 0-100 dentro del propio catalogo con ventas
  margenPct: number | null;
  motivo: string;
}

export interface AdvisorGanancia {
  oportunidades: AdvisorOportunidadEnPesos[];
  totalEnJuegoMensual: number;         // solo lo que se GANA
  totalMargenEnRiesgoMensual: number;  // lo que se pierde si se bajan los que rotan caros
}

// 31-ago-2026 -- espejo de AdvisorComparacionSospechosa (AdvisorDtos.cs). Cruces del
// mismo EAN donde un lado parece tener el pack y el otro la unidad: no son productos
// caros, son datos que no se pueden comparar. El backend los detecta de forma
// deterministica y los EXCLUYE de las tablas de posicion.
export interface AdvisorComparacionSospechosa {
  ean: string;
  descripcion: string | null;
  categoria: string;
  precioPropio: number;
  precioRefZona: number;
  ratio: number;                    // siempre >= 1 (mayor / menor)
  lado: string;                     // "propio" | "zona"
  multiploCercano: number | null;
  descripcionConfirma: boolean;
  motivo: string;
}

export interface AdvisorDigest {
  metadatos: AdvisorMetadata;
  resumen: AdvisorResumen;
  competitividad: AdvisorCompetitividad | null;
  rentabilidad: AdvisorRentabilidad | null;
  ganancia: AdvisorGanancia | null;
  teasers: AdvisorTeaser[];
  // Puede venir null si el informe es de cache y se genero antes del 31-ago-2026.
  comparacionesSospechosas: AdvisorComparacionSospechosa[] | null;
  /** BP-78: null (o ausente) si la cuenta no confirmo ningun testigo. */
  testigos?: AdvisorTestigos | null;
}

// ---- BP-78 (13-oct-2026): productos testigo. Espejo de AdvisorTestigos / AdvisorTestigo (AdvisorDtos.cs). ----

export type EstadoTestigo =
  | 'a-pelear'            // a mas de metaPct de la referencia
  | 'en-meta'             // entre la referencia y la meta
  | 'mas-barato'          // por debajo de la referencia
  | 'sin-precio-propio'   // no tiene precio cargado en esta sucursal
  | 'sin-referencia'      // ninguna cadena del radio lo publica
  | 'comparacion-dudosa'; // la diferencia parece de unidad de venta (pack contra unidad)

export interface AdvisorTestigo {
  ean: string;
  descripcion: string | null;
  categoria: string | null;
  estado: EstadoTestigo;
  precioPropio: number | null;
  /** La cadena nacional mas barata del radio para ese producto (o la mas barata a secas si no hay nacional). */
  cadenaReferencia: string | null;
  referenciaEsNacional: boolean;
  /** Precio de LISTA de esa cadena. La brecha se calcula contra este. */
  precioReferencia: number | null;
  /** La promo mas baja que publica una cadena del radio para el producto; puede ser otra que la de referencia. */
  promoMasBaja: number | null;
  promoCadena: string | null;
  promoTexto: string | null;
  brechaPct: number | null;
  /** Hasta donde bajar para entrar en la meta: referencia + metaPct. */
  precioMeta: number | null;
}

export interface AdvisorTestigos {
  confirmados: number;
  comparables: number;
  aPelearCantidad: number;
  enMetaCantidad: number;
  masBaratosCantidad: number;
  sinCompararCantidad: number;
  sinNacionalCantidad: number;
  conPromoCantidad: number;
  metaPct: number;
  umbralBajarRestoPct: number;
  /** Los de mayor brecha (lista corta). El detalle completo esta en la pantalla Productos testigo. */
  aPelear: AdvisorTestigo[];
}

// ---- Pantalla Productos testigo (/api/business/advisor/key-products) ----

export interface KeyProductItem {
  ean: string;
  descripcion: string | null;
  marca: string | null;
  origen: 'sugerido' | 'manual';
  /** Solo si se pidio una sucursal: la posicion es por sucursal y radio. */
  posicion: AdvisorTestigo | null;
}

export interface KeyProductsResponse {
  /** false = el servidor todavia no tiene la tabla de testigos. */
  tablaLista: boolean;
  confirmados: number;
  maximo: number;
  metaPct: number;
  umbralBajarRestoPct: number;
  resumen: AdvisorTestigos | null;
  items: KeyProductItem[];
}

export interface KeyProductSuggestion {
  ean: string;
  descripcion: string | null;
  marca: string | null;
  cadenas: number;
  unidadesMensuales: number | null;
  yaEsTestigo: boolean;
}

export interface KeyProductSuggestionsResponse {
  /** true = ordenada por lo mas vendido; false = sin ventas cargadas, por cantidad de cadenas. */
  conVentas: boolean;
  minCadenas: number;
  items: KeyProductSuggestion[];
}

export interface KeyProductSearchItem {
  ean: string;
  descripcion: string | null;
  marca: string | null;
  yaEsTestigo: boolean;
}

export interface KeyProductsChangeResponse {
  agregados: number;
  noSonPropios: number;
  fueraDeTope: number;
  confirmados: number;
}

export interface AdvisorReportResponse {
  reportId: number;
  reportMarkdown: string;
  mode: 'llm' | 'basico';
  generatedAtUtc: string;
  fromCache: boolean;
  digest: AdvisorDigest;
}
