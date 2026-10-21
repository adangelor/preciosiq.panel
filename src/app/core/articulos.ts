import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ArmarArticulosResponse,
  ArticuloCodigo,
  ArticuloCosto,
  ArticuloCostoRequest,
  ArticuloExportItem,
  ArticuloFicha,
  ArticuloFiltros,
  ArticuloGuardado,
  ArticuloGuardarRequest,
  ArticuloListaResponse,
  Proveedor,
  ProveedorGuardarRequest,
  Rubro,
  RubroGuardarRequest,
  TipoDeCodigo,
} from './articulos.models';

// BP-178 (21-oct-2026) -- cliente de /api/business/articles (BusinessArticlesEndpoints.cs): la ficha de artículo de la
// cuenta, sus códigos, el costo, los rubros y los proveedores. Plan GestionArticulos (Avanzado y Cadena), salvo /iva.
@Injectable({ providedIn: 'root' })
export class ArticulosService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/articles`;

  listar(businessAccountId: number, f: ArticuloFiltros = {}): Observable<ArticuloListaResponse> {
    const params: Record<string, string | number | boolean> = { businessAccountId };
    if (f.q?.trim()) params['q'] = f.q.trim();
    if (f.rubroId != null) params['rubroId'] = f.rubroId;
    if (f.proveedorId != null) params['proveedorId'] = f.proveedorId;
    if (f.sinRubro) params['sinRubro'] = true;
    if (f.sinCosto) params['sinCosto'] = true;
    if (f.ivaParaRevisar) params['ivaParaRevisar'] = true;
    if (f.incluirInactivos) params['incluirInactivos'] = true;
    if (f.page) params['page'] = f.page;
    if (f.pageSize) params['pageSize'] = f.pageSize;
    return this.http.get<ArticuloListaResponse>(this.baseUrl, { params });
  }

  ficha(businessAccountId: number, id: number): Observable<ArticuloFicha> {
    return this.http.get<ArticuloFicha>(`${this.baseUrl}/${id}`, { params: { businessAccountId } });
  }

  crear(req: ArticuloGuardarRequest): Observable<ArticuloGuardado> {
    return this.http.post<ArticuloGuardado>(this.baseUrl, req);
  }

  editar(id: number, req: ArticuloGuardarRequest): Observable<ArticuloGuardado> {
    return this.http.put<ArticuloGuardado>(`${this.baseUrl}/${id}`, req);
  }

  desactivar(businessAccountId: number, id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`, { params: { businessAccountId } });
  }

  agregarCodigo(businessAccountId: number, id: number, codigo: string, tipo: TipoDeCodigo, factor: number | null): Observable<ArticuloCodigo> {
    return this.http.post<ArticuloCodigo>(`${this.baseUrl}/${id}/codes`, { businessAccountId, codigo, tipo, factor });
  }

  quitarCodigo(businessAccountId: number, id: number, codigoId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}/codes/${codigoId}`, { params: { businessAccountId } });
  }

  cargarCosto(id: number, req: ArticuloCostoRequest): Observable<{ id: number; historial: ArticuloCosto[] }> {
    return this.http.post<{ id: number; historial: ArticuloCosto[] }>(`${this.baseUrl}/${id}/costos`, req);
  }

  armar(businessAccountId: number): Observable<ArmarArticulosResponse> {
    return this.http.post<ArmarArticulosResponse>(`${this.baseUrl}/armar`, null, { params: { businessAccountId } });
  }

  exportar(businessAccountId: number): Observable<ArticuloExportItem[]> {
    return this.http.get<ArticuloExportItem[]>(`${this.baseUrl}/export`, { params: { businessAccountId } });
  }

  // ---- rubros ----
  rubros(businessAccountId: number): Observable<Rubro[]> {
    return this.http.get<Rubro[]>(`${this.baseUrl}/rubros`, { params: { businessAccountId } });
  }

  crearRubro(req: RubroGuardarRequest): Observable<Rubro> {
    return this.http.post<Rubro>(`${this.baseUrl}/rubros`, req);
  }

  editarRubro(id: number, req: RubroGuardarRequest): Observable<Rubro> {
    return this.http.put<Rubro>(`${this.baseUrl}/rubros/${id}`, req);
  }

  moverRubro(businessAccountId: number, id: number, parentId: number | null): Observable<Rubro[]> {
    return this.http.put<Rubro[]>(`${this.baseUrl}/rubros/${id}/mover`, { businessAccountId, parentId });
  }

  borrarRubro(businessAccountId: number, id: number): Observable<{ resultado: 'borrado' | 'desactivado' }> {
    return this.http.delete<{ resultado: 'borrado' | 'desactivado' }>(`${this.baseUrl}/rubros/${id}`, { params: { businessAccountId } });
  }

  // ---- proveedores ----
  proveedores(businessAccountId: number): Observable<Proveedor[]> {
    return this.http.get<Proveedor[]>(`${this.baseUrl}/proveedores`, { params: { businessAccountId } });
  }

  crearProveedor(req: ProveedorGuardarRequest): Observable<Proveedor> {
    return this.http.post<Proveedor>(`${this.baseUrl}/proveedores`, req);
  }

  editarProveedor(id: number, req: ProveedorGuardarRequest): Observable<Proveedor> {
    return this.http.put<Proveedor>(`${this.baseUrl}/proveedores/${id}`, req);
  }

  desactivarProveedor(businessAccountId: number, id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/proveedores/${id}`, { params: { businessAccountId } });
  }
}
