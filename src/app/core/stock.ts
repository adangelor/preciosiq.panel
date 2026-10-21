import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  EstadoDeTransferencia,
  StockFiltros,
  StockIngresoRenglon,
  StockLimiteFila,
  StockListaResponse,
  StockMermaRenglon,
  StockMermasResponse,
  StockMovimientosAplicados,
  StockMovimientosResponse,
  StockRecuentoRenglon,
  StockRecuentoResponse,
  StockTransferencia,
} from './stock.models';

// BP-179 (21-oct-2026) -- cliente de /api/business/stock (BusinessStockEndpoints.cs). Plan GestionStock (Avanzado y Cadena).
@Injectable({ providedIn: 'root' })
export class StockService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/stock`;

  listar(businessAccountId: number, f: StockFiltros = {}): Observable<StockListaResponse> {
    const params: Record<string, string | number | boolean> = { businessAccountId };
    if (f.branchId) params['branchId'] = f.branchId;
    if (f.rubroId != null) params['rubroId'] = f.rubroId;
    if (f.q?.trim()) params['q'] = f.q.trim();
    if (f.bajoMinimo) params['bajoMinimo'] = true;
    if (f.negativo) params['negativo'] = true;
    if (f.page) params['page'] = f.page;
    if (f.pageSize) params['pageSize'] = f.pageSize;
    return this.http.get<StockListaResponse>(this.baseUrl, { params });
  }

  movimientos(businessAccountId: number, branchId: string, ean: string): Observable<StockMovimientosResponse> {
    return this.http.get<StockMovimientosResponse>(`${this.baseUrl}/movimientos`, { params: { businessAccountId, branchId, ean } });
  }

  ingreso(businessAccountId: number, branchId: string, renglones: StockIngresoRenglon[], nota: string | null): Observable<StockMovimientosAplicados> {
    return this.http.post<StockMovimientosAplicados>(`${this.baseUrl}/ingreso`, { businessAccountId, branchId, renglones, nota });
  }

  merma(businessAccountId: number, branchId: string, renglones: StockMermaRenglon[], nota: string | null): Observable<StockMovimientosAplicados> {
    return this.http.post<StockMovimientosAplicados>(`${this.baseUrl}/merma`, { businessAccountId, branchId, renglones, nota });
  }

  recuento(
    businessAccountId: number, branchId: string, renglones: StockRecuentoRenglon[], vistaPrevia: boolean,
    ocurridoAtLocal: string | null, origen: 'panel' | 'planilla', nota: string | null,
  ): Observable<StockRecuentoResponse> {
    return this.http.post<StockRecuentoResponse>(`${this.baseUrl}/recuento`, { businessAccountId, branchId, renglones, ocurridoAtLocal, origen, nota },
      { params: { vistaPrevia } });
  }

  transferencias(businessAccountId: number, estado: EstadoDeTransferencia | null = null): Observable<StockTransferencia[]> {
    const params: Record<string, string | number> = { businessAccountId };
    if (estado) params['estado'] = estado;
    return this.http.get<StockTransferencia[]>(`${this.baseUrl}/transferencias`, { params });
  }

  crearTransferencia(
    businessAccountId: number, desdeBranchId: string, haciaBranchId: string, renglones: { codigo: string; cantidad: number }[], nota: string | null,
  ): Observable<StockTransferencia> {
    return this.http.post<StockTransferencia>(`${this.baseUrl}/transferencias`, { businessAccountId, desdeBranchId, haciaBranchId, renglones, nota });
  }

  recibirTransferencia(businessAccountId: number, id: number, renglones: { codigo: string; cantidadRecibida: number }[] | null): Observable<StockTransferencia> {
    return this.http.post<StockTransferencia>(`${this.baseUrl}/transferencias/${id}/recibir`, { businessAccountId, renglones });
  }

  cancelarTransferencia(businessAccountId: number, id: number): Observable<StockTransferencia> {
    return this.http.post<StockTransferencia>(`${this.baseUrl}/transferencias/${id}/cancelar`, { businessAccountId });
  }

  guardarLimites(businessAccountId: number, filas: StockLimiteFila[]): Observable<{ guardados: number }> {
    return this.http.put<{ guardados: number }>(`${this.baseUrl}/limites`, { businessAccountId, filas });
  }

  mermas(businessAccountId: number, desde: string | null, hasta: string | null, branchId: string | null): Observable<StockMermasResponse> {
    const params: Record<string, string | number> = { businessAccountId };
    if (desde) params['desde'] = desde;
    if (hasta) params['hasta'] = hasta;
    if (branchId) params['branchId'] = branchId;
    return this.http.get<StockMermasResponse>(`${this.baseUrl}/mermas`, { params });
  }
}
