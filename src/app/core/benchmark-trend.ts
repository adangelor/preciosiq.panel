import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { BenchmarkTrendResponse, CategoryProductDetailResponse } from './benchmark-trend.models';

// Cliente de /trend y /category-detail en BusinessBenchmarkEndpoints.cs (E8).
@Injectable({ providedIn: 'root' })
export class BenchmarkTrendService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/benchmark`;

  getTrend(
    businessAccountId: number,
    branchId: string,
    maxDistanceMeters: number,
    dateFrom: string,
    dateTo: string,
    bucketDays = 7,
  ): Observable<BenchmarkTrendResponse> {
    return this.http.get<BenchmarkTrendResponse>(`${this.baseUrl}/trend`, {
      params: { businessAccountId, branchId, maxDistanceMeters, dateFrom, dateTo, bucketDays },
    });
  }

  getCategoryDetail(
    businessAccountId: number,
    branchId: string,
    categoryId: string,
    maxDistanceMeters: number,
    subcategoryId?: string | null,
  ): Observable<CategoryProductDetailResponse> {
    const params: Record<string, string | number> = { businessAccountId, branchId, categoryId, maxDistanceMeters };
    if (subcategoryId) params['subcategoryId'] = subcategoryId;
    return this.http.get<CategoryProductDetailResponse>(`${this.baseUrl}/category-detail`, { params });
  }

  // v2 (21-ago-2026, "la bomba"): catalogo COMPLETO del radio en una sola llamada
  // (categoryId omitido = todas las categorias, ver BusinessBenchmarkEndpoints.cs).
  // Lo usan la vista por productos del panel y la hoja "Productos" del export.
  // Mismo gate de plan que getCategoryDetail (FullDashboard).
  getAllProductsDetail(
    businessAccountId: number,
    branchId: string,
    maxDistanceMeters: number,
  ): Observable<CategoryProductDetailResponse> {
    return this.http.get<CategoryProductDetailResponse>(`${this.baseUrl}/category-detail`, {
      params: { businessAccountId, branchId, maxDistanceMeters },
    });
  }
}
