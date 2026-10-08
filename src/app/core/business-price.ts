import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BusinessPriceResponse,
  ChangeProductEanRequest,
  PagedBusinessAccountProductsResponse,
  ProductSearchResult,
  UpsertBusinessPriceRequest,
} from './business-price.models';

// Cliente de BusinessPriceEndpoints.cs (E4).
@Injectable({ providedIn: 'root' })
export class BusinessPriceService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/prices`;

  upsert(request: UpsertBusinessPriceRequest): Observable<BusinessPriceResponse> {
    return this.http.put<BusinessPriceResponse>(this.baseUrl, request);
  }

  searchProduct(query: string): Observable<ProductSearchResult[]> {
    return this.http.get<ProductSearchResult[]>(`${this.baseUrl}/search-product`, {
      params: { query },
    });
  }

  // E10.6 -- lista paginada de EAN ya cargados por la cuenta (una fila por
  // sucursal+EAN, igual que como se cuenta el cupo del plan), para mostrar cuando el
  // 402 de cupo lleno aparece en price-upsert.
  listProducts(
    businessAccountId: number,
    page = 1,
    pageSize = 20,
  ): Observable<PagedBusinessAccountProductsResponse> {
    return this.http.get<PagedBusinessAccountProductsResponse>(`${this.baseUrl}/products`, {
      params: { businessAccountId, page, pageSize },
    });
  }

  // BP-38 -- el producto propio de UNA sucursal (precio + regla de promo activa), para que el
  // formulario de carga traiga la promo ya cargada al elegir un EAN. null si no está cargado.
  getOwnProduct(businessAccountId: number, branchId: string, ean: string): Observable<PagedBusinessAccountProductsResponse> {
    return this.http.get<PagedBusinessAccountProductsResponse>(`${this.baseUrl}/products`, {
      params: { businessAccountId, branchId, ean, page: 1, pageSize: 1 },
    });
  }

  // E10.6 -- borra un EAN cargado (libera un cupo del plan).
  deleteProduct(businessAccountId: number, branchId: string, ean: string): Observable<void> {
    return this.http.delete<void>(this.baseUrl, { params: { businessAccountId, branchId, ean } });
  }

  // E10.6 -- corrige el EAN de un producto ya cargado sin gastar un cupo nuevo.
  changeEan(request: ChangeProductEanRequest): Observable<BusinessPriceResponse> {
    return this.http.post<BusinessPriceResponse>(`${this.baseUrl}/change-ean`, request);
  }
}
