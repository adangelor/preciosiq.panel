import { Injectable, effect, signal } from '@angular/core';

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'retailiq.theme';

// Claro por defecto, no oscuro: este panel lo usan comerciantes durante el día y ya
// venían de una interfaz clara. El oscuro está disponible con el toggle del header,
// y la elección se recuerda por navegador.
//
// Todo el cambio pasa por el atributo data-theme del <html> y los tokens de
// shared-theme/_theme.scss. Ningún componente conoce un color literal, así que sumar
// un tercer tema sería agregar un bloque de tokens y una opción acá.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemeName>(readStoredTheme());

  constructor() {
    effect(() => {
      const value = this.theme();
      document.documentElement.setAttribute('data-theme', value);
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // Modo incógnito o storage bloqueado: el tema simplemente no se recuerda.
      }
    });
  }

  toggle(): void {
    this.theme.update((current) => (current === 'light' ? 'dark' : 'light'));
  }
}

function readStoredTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignorado -- cae al default
  }
  return 'light';
}
