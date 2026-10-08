import { Routes } from '@angular/router';
import { adminGuard } from './core/admin-guard';
import { authGuard } from './core/auth-guard';
import { guestGuard } from './core/guest-guard';

export const routes: Routes = [
  {
    // Raiz del SPA = landing publica de PreciosIQ (antes vivia como vista Razor en
    // Buscaprecios.web). pathMatch: 'full' explicito (16-ago-2026): necesario ahora que
    // existe otra ruta con path: '' mas abajo (el shell de panel-header, ver E1.6) --
    // sin esto la landing podria pisar el matching de las rutas del shell.
    // guestGuard (16-ago-2026, E1.8): si ya hay sesion valida, no tiene sentido mostrar
    // la landing de nuevo -- va directo a /dashboard.
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/landing/landing').then((m) => m.LandingComponent),
    title: 'PreciosIQ — Inteligencia de precios para tu negocio',
    canActivate: [guestGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.LoginComponent),
    title: 'PreciosIQ — Ingresar',
    canActivate: [guestGuard],
  },
  {
    path: 'registrarme',
    loadComponent: () => import('./features/register/register').then((m) => m.RegisterComponent),
    title: 'PreciosIQ — Crear cuenta',
    canActivate: [guestGuard],
  },
  {
    path: 'recuperar-contrasena',
    loadComponent: () =>
      import('./features/forgot-password/forgot-password').then((m) => m.ForgotPasswordComponent),
    title: 'PreciosIQ — Recuperar contraseña',
    canActivate: [guestGuard],
  },
  {
    // Alta de comercio: antes vivia en la raiz ('') cuando la raiz todavia no tenia
    // landing publica. Requiere sesion (StartOtp/VerifyOtp/Google ya te crea el
    // ApplicationUser; esto crea el BusinessAccount sobre ese usuario).
    path: 'alta',
    loadComponent: () =>
      import('./features/business-signup/business-signup').then((m) => m.BusinessSignupComponent),
    title: 'PreciosIQ — Alta de comercio',
    canActivate: [authGuard],
  },
  {
    // BP-71 (08-oct-2026) -- el cartel A5 para la vidriera, FUERA del shell (sin menu) para que se
    // imprima limpio. Va antes de la ruta del shell: path '' con children agarraria todo lo demas.
    path: 'mi-tienda/cartel/:branchId',
    loadComponent: () => import('./features/mi-tienda/cartel').then((m) => m.CartelTiendaComponent),
    title: 'PreciosIQ — Cartel de la tienda',
    canActivate: [authGuard],
  },
  {
    // E1.6 (16-ago-2026) -- shell con logo/nombre del comercio + nav, envolviendo TODAS
    // las pantallas que ya asumen una cuenta creada (a diferencia de 'alta', que arriba
    // queda afuera del shell a proposito). Patron identico al app-shell de
    // distribucioniq.panel: path: '' + children, sin componente propio en la ruta padre
    // aparte del shell mismo.
    path: '',
    loadComponent: () => import('./layout/panel-header/panel-header').then((m) => m.PanelHeaderComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'sucursales/nueva',
        loadComponent: () =>
          import('./features/branch-signup/branch-signup').then((m) => m.BranchSignupComponent),
        title: 'PreciosIQ — Agregar sucursal',
      },
      {
        path: 'precios/cargar',
        loadComponent: () =>
          import('./features/price-upsert/price-upsert').then((m) => m.PriceUpsertComponent),
        title: 'PreciosIQ — Cargar precio',
      },
      {
        path: 'benchmark',
        loadComponent: () =>
          import('./features/instant-benchmark/instant-benchmark').then((m) => m.InstantBenchmarkComponent),
        title: 'PreciosIQ — Benchmark instantáneo',
      },
      {
        path: 'sucursales',
        loadComponent: () =>
          import('./features/branches-list/branches-list').then((m) => m.BranchesListComponent),
        title: 'PreciosIQ — Mis sucursales',
      },
      {
        // BP-71 (08-oct-2026) -- la tienda online de cada sucursal en misuper.app.
        path: 'mi-tienda',
        loadComponent: () => import('./features/mi-tienda/mi-tienda').then((m) => m.MiTiendaComponent),
        title: 'PreciosIQ — Mi tienda online',
      },
      {
        path: 'precios/carga-masiva',
        loadComponent: () => import('./features/csv-import/csv-import').then((m) => m.CsvImportComponent),
        title: 'PreciosIQ — Carga masiva CSV',
      },
      {
        // E5.5 (16-ago-2026) -- historial de importaciones + deshacer.
        path: 'precios/importaciones',
        loadComponent: () =>
          import('./features/csv-import-history/csv-import-history').then((m) => m.CsvImportHistoryComponent),
        title: 'PreciosIQ — Historial de importaciones',
      },
      {
        // 17-sep-2026 -- administrar los mapeos de columnas de la carga masiva.
        path: 'precios/mapeos',
        loadComponent: () => import('./features/csv-mappings/csv-mappings').then((m) => m.CsvMappingsComponent),
        title: 'PreciosIQ — Mapeos de columnas',
      },
      {
        // E13 (25-ago-2026) -- unidades vendidas por CSV, para el nivel Ganancia del Asesor.
        path: 'ventas/cargar',
        loadComponent: () => import('./features/sales-import/sales-import').then((m) => m.SalesImportComponent),
        title: 'PreciosIQ — Cargar ventas',
      },
      {
        path: 'precios/historial',
        loadComponent: () =>
          import('./features/price-history/price-history').then((m) => m.PriceHistoryComponent),
        title: 'PreciosIQ — Historial de precio',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/benchmark-dashboard/benchmark-dashboard').then((m) => m.BenchmarkDashboardComponent),
        title: 'PreciosIQ — Dashboard de benchmarking',
      },
      {
        path: 'plan',
        loadComponent: () => import('./features/upgrade-plan/upgrade-plan').then((m) => m.UpgradePlanComponent),
        title: 'PreciosIQ — Tu plan',
      },
      {
        // E-Cuenta (17-ago-2026) -- "Perfil" del menu de cuenta (avatar en el toolbar,
        // ver layout/account-menu). Nombre/apellido + foto; cambiar contraseña vive
        // aparte en la ruta de abajo.
        path: 'perfil',
        loadComponent: () => import('./features/profile/profile').then((m) => m.ProfileComponent),
        title: 'PreciosIQ — Tu perfil',
      },
      {
        path: 'perfil/cambiar-contrasena',
        loadComponent: () =>
          import('./features/change-password/change-password').then((m) => m.ChangePasswordComponent),
        title: 'PreciosIQ — Cambiar contraseña',
      },
      {
        // E-Cuenta (17-ago-2026) -- "Usuarios" del menu lateral: invitar/quitar gente
        // de la cuenta. Mismo backend generico que distribucioniq.panel
        // (AccountUsersEndpoints.cs) -- ver core/account-users.ts.
        path: 'usuarios',
        loadComponent: () => import('./features/account-users/account-users').then((m) => m.AccountUsersComponent),
        title: 'PreciosIQ — Usuarios de la cuenta',
      },
      {
        // E-Cuenta (17-ago-2026) -- "Datos del negocio" del menu lateral: corregir lo
        // cargado en el onboarding (razon social, CUIT, logo, domicilio). NO incluye
        // lat/long -- eso ya vive en /sucursales (E2.3).
        path: 'negocio',
        loadComponent: () =>
          import('./features/business-profile/business-profile').then((m) => m.BusinessProfileComponent),
        title: 'PreciosIQ — Datos del negocio',
      },
      {
        // Aceptar una invitacion -- ruta hija del shell a proposito: quien acepta ya
        // tiene que estar logueado (authGuard del padre se encarga), aunque la cuenta
        // invitada puede ser nueva (recien creada al loguearse con ese mail).
        path: 'invitacion/:token',
        loadComponent: () =>
          import('./features/accept-invitation/accept-invitation').then((m) => m.AcceptInvitationComponent),
        title: 'PreciosIQ — Aceptar invitación',
      },
      {
        // E10.5 (18-ago-2026) -- pantalla de admin (trials de plan) para Andres. El
        // link solo aparece en el menu si isAdmin() (ver panel-header), y adminGuard
        // manda a /dashboard a cualquiera sin el rol "Admins" -- la seguridad real la
        // hace el backend (policy "AdminsOnly" en AdminBusinessAccountEndpoints.cs).
        path: 'admin/cuentas',
        loadComponent: () => import('./features/admin-trials/admin-trials').then((m) => m.AdminTrialsComponent),
        title: 'PreciosIQ — Admin: trials de plan',
        canActivate: [adminGuard],
      },
    ],
  },
];
