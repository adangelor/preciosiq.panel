// BP-179 (21-oct-2026) -- stock con historial: los DTOs de /api/business/stock (Data/DTOs/StockDtos.cs). Cantidades en
// unidades de venta.

export type TipoDeMovimiento = 'venta' | 'devolucion' | 'recuento' | 'ingreso' | 'merma' | 'transferencia_salida' | 'transferencia_entrada' | 'ajuste';
export type OrigenDeMovimiento = 'caja_ticket' | 'caja_ajuste' | 'panel' | 'planilla' | 'migracion' | 'transferencia';
export type MotivoDeMerma = 'rotura' | 'vencido' | 'robo' | 'consumo' | 'otro';
export type EstadoDeTransferencia = 'en_transito' | 'recibida' | 'cancelada';

export interface StockSucursal {
  branchId: string;
  nombre: string;
}

export interface StockCelda {
  cantidad: number;
  minimo: number | null;
  maximo: number | null;
}

export interface StockItem {
  codigo: string;
  descripcion: string;
  marca: string | null;
  rubro: string | null;
  costoNeto: number | null;
  porSucursal: Record<string, StockCelda>;
  cantidad: number;
  valorizado: number | null;
  bajoMinimo: boolean;
  negativo: boolean;
  sinFicha: boolean;
}

export interface StockTotalRubro {
  rubro: string;
  articulos: number;
  cantidad: number;
  valorizado: number;
}

export interface StockListaResponse {
  sucursales: StockSucursal[];
  total: number;
  page: number;
  pageSize: number;
  valorizado: number;
  sinCosto: number;
  bajoMinimo: number;
  negativos: number;
  porRubro: StockTotalRubro[];
  items: StockItem[];
}

export interface StockFiltros {
  branchId?: string | null;
  rubroId?: number | null;
  q?: string;
  bajoMinimo?: boolean;
  negativo?: boolean;
  page?: number;
  pageSize?: number;
}

export interface StockMovimiento {
  id: number;
  tipo: TipoDeMovimiento;
  cantidad: number;
  cantidadContada: number | null;
  saldo: number;
  ocurridoAtLocal: string;
  registradoAtUtc: string;
  origenTipo: OrigenDeMovimiento;
  mermaMotivo: MotivoDeMerma | null;
  nota: string | null;
  costoUnitario: number | null;
  transferenciaId: number | null;
  llegoDespuesDeUnRecuento: boolean;
  origenId: string | null;
  dispositivo: string | null;
  usuario: string | null;
}

export interface StockMovimientosResponse {
  branchId: string;
  codigo: string;
  descripcion: string | null;
  saldoActual: number;
  items: StockMovimiento[];
}

export interface StockRenglonError {
  fila: number;
  codigo: string | null;
  motivo: string;
}

export interface StockRenglonAplicado {
  codigo: string;
  descripcion: string;
  cantidad: number;
  saldoAntes: number;
  saldoDespues: number;
  costoUnitario: number | null;
}

export interface StockMovimientosAplicados {
  aplicados: number;
  renglones: StockRenglonAplicado[];
  noEncontrados: StockRenglonError[];
}

export interface StockIngresoRenglon {
  codigo: string;
  cantidad: number;
  unidad: 'unidad' | 'bulto';
  costoNeto: number | null;
}

export interface StockMermaRenglon {
  codigo: string;
  cantidad: number;
  motivo: MotivoDeMerma;
}

export interface StockRecuentoRenglon {
  codigo: string;
  cantidadContada: number;
}

export interface StockRecuentoPrevia {
  codigo: string;
  descripcion: string;
  saldo: number;
  contada: number;
  diferencia: number;
  costoNeto: number | null;
}

export interface StockRecuentoResponse {
  vistaPrevia: boolean;
  renglones: number;
  conDiferencia: number;
  diferenciaValorizada: number;
  items: StockRecuentoPrevia[];
  noEncontrados: StockRenglonError[];
}

export interface StockTransferenciaItem {
  codigo: string;
  descripcion: string | null;
  cantidadEnviada: number;
  cantidadRecibida: number | null;
  diferencia: number | null;
}

export interface StockTransferencia {
  id: number;
  desdeBranchId: string;
  desdeNombre: string;
  haciaBranchId: string;
  haciaNombre: string;
  estado: EstadoDeTransferencia;
  creadaAtUtc: string;
  recibidaAtUtc: string | null;
  canceladaAtUtc: string | null;
  nota: string | null;
  items: StockTransferenciaItem[];
}

export interface StockLimiteFila {
  branchId: string;
  codigo: string;
  minimo: number | null;
  maximo: number | null;
}

export interface StockMermaTotal {
  clave: string;
  cantidad: number;
  valor: number;
  sinCosto: number;
}

export interface StockMermasResponse {
  desde: string;
  hasta: string;
  cantidad: number;
  valor: number;
  porMotivo: StockMermaTotal[];
  porRubro: StockMermaTotal[];
}
