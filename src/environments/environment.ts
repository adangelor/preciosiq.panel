// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
export const environment = {
  production: false,
  apiBaseUrl: 'https://localhost:7214/api/',
  // E1.6 (16-ago-2026) -- raiz del backend SIN "api/", para armar la URL absoluta de
  // assets servidos por wwwroot (ej. el logo del comercio en /images/BusinessLogos/...).
  // apiBaseUrl no sirve para esto porque tiene el sufijo /api/ pegado (mismo patron que
  // distribucioniq.panel).
  assetsBaseUrl: 'https://localhost:7214/',
  // BP-71 (08-oct-2026) -- el sitio de las tiendas (adangelor/misuper.app). En dev, su "ng serve".
  misuperUrl: 'http://localhost:4203',
  // TODO: mismo Web Client ID que usa la app movil (config "Google:WebClientId" del
  // backend) -- sin esto el boton de Google no valida contra la audiencia correcta.
  googleWebClientId: '',
  // E5.7 (25-ago-2026) -- carga masiva por lotes (features/csv-import). chunkRows =
  // filas por llamada a POST /run (el backend la capea con CsvImport:MaxChunkRows de
  // appsettings.json); retryCount/retryDelayMs = reintentos ante cortes de red/proxy
  // (status 0, 502/503/504) por tanda.
  csvImport: {
    chunkRows: 300,
    retryCount: 1,
    retryDelayMs: 2000,
  },
  // 25-ago-2026 -- sugerencia de radio del benchmark (layout/radius-advisor). Se cuentan
  // las sucursales de la competencia hasta nearbyScanMeters (una sola consulta) y a
  // partir de eso se opina sobre el radio tipeado: con menos de minChains cadenas no hay
  // benchmark; con mas de tooManyBranches sucursales conviene achicar; comfortableBranches
  // es lo que se busca al sugerir. radiusLadder son los radios candidatos, en metros.
  benchmark: {
    nearbyScanMeters: 20000,
    nearbyMaxResults: 500,
    minChains: 3,
    comfortableBranches: 30,
    tooManyBranches: 120,
    radiusLadder: [300, 500, 800, 1000, 1500, 2000, 3000, 5000, 8000, 10000, 15000, 20000],
  },
};
