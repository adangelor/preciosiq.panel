import { of } from 'rxjs';
import { SucursalDeTienda, TiendaConfig, TiendaDeCuenta } from '../../core/tienda';
import { environment } from '../../../environments/environment';

// BP-167 (19-oct-2026) -- datos de prueba para las specs de "Mi tienda" (una tienda por cuenta). Inventados, con la forma de
// GET /api/business/tienda/cuenta de la descripcion de Buscaprecios.web#3. Nada de esto le pega a la API de verdad.

export const API = `${environment.apiBaseUrl}business/tienda`;

export function sucursal(cambios: Partial<SucursalDeTienda> & { branchId: string; nombre: string }): SucursalDeTienda {
  return {
    domicilio: 'Pringles 100',
    ciudad: 'San Luis',
    tieneUbicacion: true,
    productos: 120,
    habilitadaPorDefecto: true,
    habilitadaAMano: null,
    habilitada: true,
    principal: false,
    porDefecto: false,
    whatsApp: null,
    slugAnterior: null,
    ...cambios,
  };
}

export function tienda(cambios: Partial<TiendaConfig> = {}): TiendaConfig {
  return {
    id: 11,
    slug: 'aiello-supermercados',
    activa: true,
    publicadaAtUtc: '2026-10-01T00:00:00',
    nombreVisible: 'Aiello Supermercados',
    presentacion: null,
    whatsApp: '+5492664000002',
    alias: 'aiello.pago',
    cvu: null,
    qrPagoUrl: null,
    mostrarDomicilio: true,
    slugsAnteriores: [],
    sucursalPrincipal: '2',
    ...cambios,
  };
}

/** Aiello: Centro (a mano), Norte (principal), Sur (sacada a mano), Balvanera (sin ubicacion) y Depósito (sin productos). */
export function cuentaAiello(cambios: Partial<TiendaDeCuenta> = {}): TiendaDeCuenta {
  return {
    tienda: tienda(),
    slugSugerido: 'aiello-supermercados',
    nombreSugerido: 'Aiello Supermercados',
    sucursalPorDefecto: '2',
    sucursales: [
      sucursal({ branchId: '1', nombre: 'Centro', habilitadaAMano: true, whatsApp: '+5492664000001', slugAnterior: 'aiello-supermercados-centro' }),
      sucursal({ branchId: '2', nombre: 'Norte', domicilio: 'Lafinur 1200', principal: true, porDefecto: true }),
      sucursal({ branchId: '10', nombre: 'Sur', domicilio: 'España 900', habilitadaAMano: false, habilitada: false }),
      sucursal({ branchId: '4', nombre: 'Balvanera', domicilio: null, tieneUbicacion: false, habilitadaPorDefecto: false, habilitada: false }),
      sucursal({ branchId: '5', nombre: 'Depósito', productos: 0, habilitadaPorDefecto: false, habilitada: false }),
    ],
    ...cambios,
  };
}

/** BusinessContextService de mentira: la cuenta 101 con logo. */
export const contextoFalso = {
  load: () => of({ account: { businessAccountId: 101, logoUrl: null }, branches: [] }),
};
