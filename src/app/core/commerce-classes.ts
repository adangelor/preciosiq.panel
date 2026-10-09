import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';

/** Una bandera clasificada (dbo.CommerceClass, BP-76). */
export interface CommerceClass {
  commerceId: string;
  bannerId: string;
  rubro: 'super' | 'farmacia' | 'otro';
  escala: 'nacional' | 'regional' | 'independiente';
}

/**
 * BP-76 (09-oct-2026) -- rubro y escala de cada bandera, para que el panel cuente como "competencia" lo mismo
 * que el benchmark: supermercados. Se pide una vez por sesion; si falla, mapa vacio y se cuenta todo (como antes).
 */
@Injectable({ providedIn: 'root' })
export class CommerceClassesService {
  private readonly http = inject(HttpClient);
  private cache$: Observable<Map<string, CommerceClass>> | null = null;

  static clave(commerceId: string, bannerId: string): string {
    return `${commerceId}|${bannerId}`;
  }

  clases(): Observable<Map<string, CommerceClass>> {
    this.cache$ ??= this.http.get<CommerceClass[]>(`${environment.apiBaseUrl}business/benchmark/clases`).pipe(
      map((lista) => new Map(lista.map((c) => [CommerceClassesService.clave(c.commerceId, c.bannerId), c]))),
      catchError(() => {
        this.cache$ = null;
        return of(new Map<string, CommerceClass>());
      }),
      shareReplay(1),
    );
    return this.cache$;
  }
}
