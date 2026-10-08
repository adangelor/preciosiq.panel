import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// E13 (25-ago-2026) -- cliente de BusinessSalesImportEndpoints.cs: unidades vendidas
// por EAN y periodo, para el nivel Ganancia del Asesor de Precios.
export interface SalesPreviewResponse {
  headers: string[];
  sampleRows: string[][];
  detectedDelimiter: string;
}

export interface SalesImportRowError {
  rowNumber: number;
  reason: string;
}

export interface SalesImportResult {
  totalRows: number;
  loaded: number;
  replaced: number;
  failed: number;
  errors: SalesImportRowError[];
  periodFrom: string;
  periodTo: string;
}

export type SalesPeriodMode = 'fixed' | 'columns';

export interface SalesImportRunRequest {
  businessAccountId: number;
  branchId: string | null;
  file: File;
  eanColumn: string;
  unitsColumn: string;
  revenueColumn: string | null;
  decimalSeparator: ',' | '.';
  periodMode: SalesPeriodMode;
  // periodMode = 'fixed'
  periodFrom?: string; // yyyy-MM-dd
  periodTo?: string;
  // periodMode = 'columns'
  periodFromColumn?: string | null;
  periodToColumn?: string | null;
}

@Injectable({ providedIn: 'root' })
export class SalesImportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/sales-import`;

  preview(businessAccountId: number, file: File): Observable<SalesPreviewResponse> {
    const form = new FormData();
    form.append('businessAccountId', String(businessAccountId));
    form.append('file', file);
    return this.http.post<SalesPreviewResponse>(`${this.baseUrl}/preview`, form);
  }

  run(req: SalesImportRunRequest): Observable<SalesImportResult> {
    const form = new FormData();
    form.append('businessAccountId', String(req.businessAccountId));
    if (req.branchId) form.append('branchId', req.branchId);
    form.append('file', req.file);
    form.append('eanColumn', req.eanColumn);
    form.append('unitsColumn', req.unitsColumn);
    if (req.revenueColumn) form.append('revenueColumn', req.revenueColumn);
    form.append('decimalSeparator', req.decimalSeparator);
    form.append('periodMode', req.periodMode);
    if (req.periodMode === 'fixed') {
      form.append('periodFrom', req.periodFrom ?? '');
      form.append('periodTo', req.periodTo ?? '');
    } else {
      form.append('periodFromColumn', req.periodFromColumn ?? '');
      if (req.periodToColumn) form.append('periodToColumn', req.periodToColumn);
    }
    return this.http.post<SalesImportResult>(`${this.baseUrl}/run`, form);
  }
}
