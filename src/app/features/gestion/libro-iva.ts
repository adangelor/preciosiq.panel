import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { mensajeDeError } from '../../core/articulos-form';
import {
  ComprasService, LibroIva, RenglonLibroIva, alicuotasDelLibro, cuitConGuiones, fechaCorta, filasDelLibro, provinciaDe, textoTipoComprobante,
} from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

const plata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-09": el mes anterior (el IVA se presenta el mes siguiente). */
export function mesAnterior(hoy = new Date()): string {
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// BP-180 (22-oct-2026) -- Gestión -> Libro IVA compras (PROMPT_BP180_Compras_22oct.md, bloque 7): los comprobantes
// registrados del mes con columnas por alícuota, percepciones e internos y los totales (las notas de crédito restan); el
// Excel (armado acá con la misma librería que lee las planillas) y el zip para importar en el Libro IVA Digital de ARCA.
@Component({
  selector: 'app-libro-iva',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './libro-iva.html',
  styleUrl: './gestion.scss',
})
export class LibroIvaComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ComprasService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  protected readonly cuenta = signal<number | null>(null);

  protected readonly mes = signal(mesAnterior());
  protected readonly cargando = signal(false);
  protected readonly libro = signal<LibroIva | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly descargando = signal(false);
  protected readonly alicuotas = computed(() => (this.libro() ? alicuotasDelLibro(this.libro()!) : []));

  protected readonly fecha = fechaCorta;
  protected readonly cuit = cuitConGuiones;
  protected readonly textoTipo = textoTipoComprobante;
  protected readonly provincia = provinciaDe;

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.compras) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.cargar();
      },
      error: () => { this.cargandoCuenta.set(false); this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.'); },
    });
  }

  protected cargar(): void {
    const id = this.cuenta();
    if (id == null || !this.mes()) return;
    this.cargando.set(true);
    this.error.set(null);
    this.api.libroIva(id, this.mes()).subscribe({
      next: (l) => { this.cargando.set(false); this.libro.set(l); },
      error: (err) => { this.cargando.set(false); this.libro.set(null); this.error.set(mensajeDeError(err, 'No pudimos armar el libro.')); },
    });
  }

  protected elegirMes(e: Event): void {
    this.mes.set((e.target as HTMLInputElement).value);
    this.cargar();
  }

  protected neto(r: RenglonLibroIva, a: number): number | null {
    const x = r.alicuotas.find((y) => y.alicuota === a);
    return x ? r.signo * x.neto : null;
  }

  protected iva(r: RenglonLibroIva, a: number): number | null {
    const x = r.alicuotas.find((y) => y.alicuota === a);
    return x ? r.signo * x.iva : null;
  }

  protected totalAlicuota(a: number, campo: 'neto' | 'iva'): number {
    return this.libro()?.totales.alicuotas.find((x) => x.alicuota === a)?.[campo] ?? 0;
  }

  /** El Excel, armado en el navegador. */
  async excel(): Promise<void> {
    const l = this.libro();
    if (!l) return;
    const XLSX = await import('xlsx');
    const hoja = XLSX.utils.aoa_to_sheet(filasDelLibro(l));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, `Compras ${l.mes}`);
    XLSX.writeFile(libro, `LibroIVACompras_${l.mes}.xlsx`);
  }

  /** El zip para ARCA. Si el servidor no lo arma (proveedor sin CUIT, mes vacío), su motivo. */
  archivos(): void {
    const id = this.cuenta();
    const l = this.libro();
    if (id == null || !l || this.descargando()) return;
    this.descargando.set(true);
    this.error.set(null);
    this.api.archivosLibroIva(id, l.mes).subscribe({
      next: (blob) => {
        this.descargando.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LibroIVACompras_${l.mes}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: async (err) => {
        this.descargando.set(false);
        // Con responseType blob, el motivo del servidor viene adentro de un Blob (o ya leído, según quién conteste).
        let mensaje = 'No pudimos armar los archivos.';
        if (err instanceof HttpErrorResponse && err.error != null) {
          try {
            const cuerpo = err.error instanceof Blob ? await err.error.text() : typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
            mensaje = (JSON.parse(cuerpo) as { error?: string })?.error ?? mensaje;
          } catch { /* no era JSON */ }
        }
        this.error.set(mensaje);
      },
    });
  }

  protected plata(n: number | null): string {
    if (n == null || n === 0) return n === 0 ? '—' : '';
    return n < 0 ? `−${plata.format(-n)}` : plata.format(n);
  }
}
