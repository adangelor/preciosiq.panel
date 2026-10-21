import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AjusteDeCostosRequest,
  AjusteDeCostosResponse,
  AplicarPreciosResponse,
  CartelesOrigen,
  CartelesResponse,
  ConfiguracionDePrecios,
  DestinoDePrecios,
  SugeridosFiltros,
  SugeridosResponse,
} from './formacion.models';

// BP-181 (21-oct-2026) -- cliente de /api/business/pricing (BusinessPricingEndpoints.cs). Plan FormacionPrecios
// (Avanzado y Cadena), salvo /carteles, que va en todos los planes.
@Injectable({ providedIn: 'root' })
export class FormacionService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/pricing`;

  configuracion(businessAccountId: number): Observable<ConfiguracionDePrecios> {
    return this.http.get<ConfiguracionDePrecios>(`${this.baseUrl}/settings`, { params: { businessAccountId } });
  }

  guardarConfiguracion(businessAccountId: number, c: Omit<ConfiguracionDePrecios, 'guardada'>): Observable<ConfiguracionDePrecios> {
    return this.http.put<ConfiguracionDePrecios>(`${this.baseUrl}/settings`, { businessAccountId, ...c });
  }

  sugeridos(businessAccountId: number, destino: DestinoDePrecios, f: SugeridosFiltros = {}): Observable<SugeridosResponse> {
    const params: Record<string, string | number | boolean> = { businessAccountId, ...paramsDeDestino(destino) };
    if (f.rubroId != null) params['rubroId'] = f.rubroId;
    if (f.proveedorId != null) params['proveedorId'] = f.proveedorId;
    if (f.q?.trim()) params['q'] = f.q.trim();
    if (f.soloCambios) params['soloCambios'] = true;
    if (f.aviso) params['aviso'] = f.aviso;
    if (f.page) params['page'] = f.page;
    if (f.pageSize) params['pageSize'] = f.pageSize;
    return this.http.get<SugeridosResponse>(`${this.baseUrl}/sugeridos`, { params });
  }

  aplicar(businessAccountId: number, destino: DestinoDePrecios, filas: { ean: string; precio: number }[]): Observable<AplicarPreciosResponse> {
    return this.http.post<AplicarPreciosResponse>(`${this.baseUrl}/aplicar`, {
      businessAccountId,
      branchId: destino.tipo === 'sucursal' ? destino.branchId : null,
      priceZoneId: destino.tipo === 'zona' ? destino.priceZoneId : null,
      todasLasSucursales: destino.tipo === 'todas',
      filas,
    });
  }

  ajustarCostos(req: AjusteDeCostosRequest, vistaPrevia: boolean): Observable<AjusteDeCostosResponse> {
    return this.http.post<AjusteDeCostosResponse>(`${this.baseUrl}/costos/ajuste`, req, { params: { vistaPrevia } });
  }

  carteles(businessAccountId: number, o: CartelesOrigen): Observable<CartelesResponse> {
    const params: Record<string, string | number> = { businessAccountId };
    if (o.batchId != null) params['batchId'] = o.batchId;
    if (o.groupId != null) params['groupId'] = o.groupId;
    if (o.eans?.length) params['eans'] = o.eans.join(',');
    if (o.branchId) params['branchId'] = o.branchId;
    return this.http.get<CartelesResponse>(`${this.baseUrl}/carteles`, { params });
  }
}

export function paramsDeDestino(d: DestinoDePrecios): Record<string, string | number | boolean> {
  switch (d.tipo) {
    case 'sucursal': return { branchId: d.branchId };
    case 'zona': return { priceZoneId: d.priceZoneId };
    default: return { todasLasSucursales: true };
  }
}
