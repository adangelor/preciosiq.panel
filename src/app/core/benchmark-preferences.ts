import { Injectable } from '@angular/core';

// 25-ago-2026 -- pregunta de Andres: "¿dónde guardamos la preferencia del ñato?". El
// radio del benchmark es una propiedad de la SUCURSAL (Balvanera necesita 300 m, un
// barrio de Resistencia 5 km), no del usuario ni del navegador. El lugar correcto a
// largo plazo es la base, por sucursal (una columna en la fila de sucursal del comercio
// o una tabla de preferencias) y compartido por todos los usuarios de la cuenta.
//
// Mientras eso no exista (migracion + endpoint + deploy), esto guarda en localStorage,
// por sucursal, y esta escrito como servicio con una interfaz chica a proposito: el dia
// que se persista en la base, se reemplaza la implementacion de get/save y ninguna
// pantalla se entera. Regla de oro que SI hay que conservar: solo se guarda un radio
// que ya corrio un benchmark con exito -- un radio que dio timeout nunca se guarda,
// asi la proxima entrada no vuelve a tropezar con la misma piedra.
const KEY_PREFIX = 'retailiq.benchmarkRadius.';

@Injectable({ providedIn: 'root' })
export class BenchmarkPreferencesService {
  getRadius(branchId: string): number | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + branchId);
      const value = raw === null ? NaN : Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  saveRadius(branchId: string, radius: number): void {
    try {
      localStorage.setItem(KEY_PREFIX + branchId, String(radius));
    } catch {
      // Navegador sin storage (modo privado estricto, cuota): se pierde la preferencia,
      // no la funcionalidad.
    }
  }
}
