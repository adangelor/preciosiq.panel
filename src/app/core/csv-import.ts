import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CatalogoCompletoResult,
  CsvImportBatch,
  CsvImportChunkOptions,
  CsvImportResult,
  CsvMapping,
  CsvMappingTestResult,
  CsvPreviewResponse,
  SaveCsvMappingRequest,
  UndoCsvImportBatchResult,
} from './csv-import.models';

// Cliente de BusinessCsvImportEndpoints.cs (E5).
@Injectable({ providedIn: 'root' })
export class CsvImportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/csv-import`;

  preview(businessAccountId: number, file: File): Observable<CsvPreviewResponse> {
    const form = new FormData();
    form.append('businessAccountId', String(businessAccountId));
    form.append('file', file);
    return this.http.post<CsvPreviewResponse>(`${this.baseUrl}/preview`, form);
  }

  saveMapping(request: SaveCsvMappingRequest): Observable<CsvMapping> {
    return this.http.post<CsvMapping>(`${this.baseUrl}/mappings`, request);
  }

  // 17-sep-2026 -- administrar mapeos (pantalla "Mapeos"). Los archivados solo se piden
  // cuando el usuario los quiere ver: en la carga masiva nunca aparecen.
  listMappings(businessAccountId: number, incluirArchivados = false): Observable<CsvMapping[]> {
    return this.http.get<CsvMapping[]>(`${this.baseUrl}/mappings`, {
      params: { businessAccountId: String(businessAccountId), incluirArchivados: String(incluirArchivados) },
    });
  }

  updateMapping(mappingId: number, request: SaveCsvMappingRequest): Observable<CsvMapping> {
    return this.http.put<CsvMapping>(`${this.baseUrl}/mappings/${mappingId}`, request);
  }

  archiveMapping(mappingId: number, businessAccountId: number): Observable<CsvMapping> {
    return this.http.post<CsvMapping>(`${this.baseUrl}/mappings/${mappingId}/archive`, { businessAccountId });
  }

  restoreMapping(mappingId: number, businessAccountId: number): Observable<CsvMapping> {
    return this.http.post<CsvMapping>(`${this.baseUrl}/mappings/${mappingId}/restore`, { businessAccountId });
  }

  // Probar un mapeo con un archivo: no carga nada.
  testMapping(mappingId: number, businessAccountId: number, file: File): Observable<CsvMappingTestResult> {
    const form = new FormData();
    form.append('businessAccountId', String(businessAccountId));
    form.append('file', file);
    return this.http.post<CsvMappingTestResult>(`${this.baseUrl}/mappings/${mappingId}/test`, form);
  }

  // E5.7 (25-ago-2026) -- con `chunk` procesa solo `limit` filas desde `offset`; el
  // archivo viaja entero cada vez (el backend es sin estado a proposito, lo re-parsea).
  // Sin `chunk` procesa todo en una llamada, como antes -- y se cuelga con archivos
  // grandes, que es justo lo que esto arregla.
  run(
    businessAccountId: number,
    branchId: string,
    mappingId: number,
    file: File,
    chunk?: CsvImportChunkOptions,
  ): Observable<CsvImportResult> {
    const form = new FormData();
    form.append('businessAccountId', String(businessAccountId));
    form.append('branchId', branchId);
    form.append('mappingId', String(mappingId));
    form.append('file', file);
    if (chunk) {
      form.append('offset', String(chunk.offset));
      form.append('limit', String(chunk.limit));
      if (chunk.batchId !== null) form.append('batchId', String(chunk.batchId));
    }
    return this.http.post<CsvImportResult>(`${this.baseUrl}/run`, form);
  }

  // E5.5 -- historial de importaciones + deshacer.
  listBatches(businessAccountId: number): Observable<CsvImportBatch[]> {
    return this.http.get<CsvImportBatch[]>(`${this.baseUrl}/batches`, {
      params: { businessAccountId: String(businessAccountId) },
    });
  }

  undoBatch(batchId: number, businessAccountId: number): Observable<UndoCsvImportBatchResult> {
    return this.http.post<UndoCsvImportBatchResult>(`${this.baseUrl}/batches/${batchId}/undo`, {
      businessAccountId,
    });
  }

  // 10-oct-2026 -- catalogo completo: con aplicar = false solo cuenta lo que se daria de baja
  // (lo publicado que no vino en el archivo); con true lo pasa a "sin stock".
  catalogoCompleto(batchId: number, businessAccountId: number, aplicar: boolean): Observable<CatalogoCompletoResult> {
    return this.http.post<CatalogoCompletoResult>(`${this.baseUrl}/batches/${batchId}/catalogo-completo`, {
      businessAccountId,
      aplicar,
    });
  }
}
