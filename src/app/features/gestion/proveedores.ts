import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ArticulosService } from '../../core/articulos';
import { mensajeDeError } from '../../core/articulos-form';
import { CONDICIONES_IVA, CondicionIva, ComprasService, ProveedorFicha, ProveedorFichaRequest, textoCondicion } from '../../core/compras';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

export { cuitConGuiones } from '../../core/compras';
import { cuitConGuiones } from '../../core/compras';

/** Lo que se edita en el formulario (texto, como está en los campos). */
interface Borrador {
  nombre: string;
  razonSocial: string;
  cuit: string;
  condicionIva: CondicionIva;
  domicilio: string;
  telefono: string;
  email: string;
  contacto: string;
  plazoPagoDias: string;
  nota: string;
}

const VACIO: Borrador = {
  nombre: '', razonSocial: '', cuit: '', condicionIva: 'ri', domicilio: '', telefono: '', email: '', contacto: '', plazoPagoDias: '', nota: '',
};

/** Un proveedor de la lista: con compras viene la ficha completa; sin compras (o sin el script), lo de BP-178. */
type Fila = ProveedorFicha;

// BP-178 (21-oct-2026) -- Gestión → Proveedores. Un proveedor no se borra: se desactiva (los costos y los artículos lo
// siguen nombrando).
// BP-180 (22-oct-2026) -- con Compras (Avanzado y Cadena) la ficha es completa (razón social, condición de IVA, contacto,
// plazo de pago, nota) y cada proveedor tiene su lista de artículos (/gestion/proveedores/:id). Sin el script de compras
// (503) la pantalla sigue andando con lo de BP-178 (nombre y CUIT).
@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './proveedores.html',
  styleUrl: './gestion.scss',
})
export class ProveedoresComponent implements OnInit {
  private readonly gestion = inject(GestionContextoService);
  private readonly api = inject(ArticulosService);
  private readonly compras = inject(ComprasService);

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  private readonly cuenta = signal<number | null>(null);
  /** BP-180 -- la ficha completa y la lista del proveedor (plan Compras y el script en el servidor). */
  protected readonly completa = signal(false);
  protected readonly avisoCompras = signal<string | null>(null);

  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly errorCampo = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly lista = signal<Fila[]>([]);
  protected readonly verInactivos = signal(false);

  /** null = cerrado; 0 = nuevo; >0 = editando ese. */
  protected readonly editando = signal<number | null>(null);
  protected readonly borrador = signal<Borrador>({ ...VACIO });

  protected readonly visibles = computed(() => this.lista().filter((p) => this.verInactivos() || p.activo));
  protected readonly hayInactivos = computed(() => this.lista().some((p) => !p.activo));
  protected readonly cuitConGuiones = cuitConGuiones;
  protected readonly condiciones = CONDICIONES_IVA;
  protected readonly textoCondicion = textoCondicion;

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.gestionArticulos) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
        this.completa.set(g.compras);
        this.cargar();
      },
      error: () => {
        this.cargandoCuenta.set(false);
        this.errorCuenta.set('No pudimos cargar tu cuenta. Probá recargar la página.');
      },
    });
  }

  private cargar(): void {
    const id = this.cuenta();
    if (id == null) return;
    this.cargando.set(true);
    if (this.completa()) {
      this.compras.proveedores(id).subscribe({
        next: (p) => { this.cargando.set(false); this.lista.set(p); },
        error: (err) => {
          // Sin el script de compras en el servidor: lo de BP-178, y se avisa.
          if (err instanceof HttpErrorResponse && err.status === 503) {
            this.completa.set(false);
            this.avisoCompras.set('La ficha completa y la lista de cada proveedor todavía no están habilitadas en el servidor.');
            this.cargar();
            return;
          }
          this.cargando.set(false);
          this.error.set(mensajeDeError(err, 'No pudimos cargar tus proveedores.'));
        },
      });
      return;
    }
    this.api.proveedores(id).subscribe({
      next: (p) => {
        this.cargando.set(false);
        this.lista.set(p.map((x) => ({
          id: x.id, nombre: x.nombre, razonSocial: null, cuit: x.cuit, condicionIva: 'ri' as CondicionIva, domicilio: null, telefono: null,
          email: null, contacto: null, plazoPagoDias: null, nota: null, activo: x.activo, articulosEnLista: 0, articulosHabituales: x.articulos,
        })));
      },
      error: (err) => { this.cargando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cargar tus proveedores.')); },
    });
  }

  protected nuevo(): void {
    this.aviso.set(null);
    this.error.set(null);
    this.errorCampo.set(null);
    this.borrador.set({ ...VACIO });
    this.editando.set(0);
  }

  protected editar(p: Fila): void {
    this.aviso.set(null);
    this.error.set(null);
    this.errorCampo.set(null);
    this.borrador.set({
      nombre: p.nombre, razonSocial: p.razonSocial ?? '', cuit: p.cuit ?? '', condicionIva: p.condicionIva, domicilio: p.domicilio ?? '',
      telefono: p.telefono ?? '', email: p.email ?? '', contacto: p.contacto ?? '',
      plazoPagoDias: p.plazoPagoDias == null ? '' : String(p.plazoPagoDias), nota: p.nota ?? '',
    });
    this.editando.set(p.id);
  }

  protected campo(nombre: keyof Borrador, e: Event): void {
    const valor = (e.target as HTMLInputElement | HTMLSelectElement).value;
    this.borrador.update((b) => ({ ...b, [nombre]: valor }));
    if (this.errorCampo() === nombre) this.errorCampo.set(null);
  }

  protected onVerInactivos(e: Event): void { this.verInactivos.set((e.target as HTMLInputElement).checked); }

  protected guardar(): void {
    const id = this.cuenta();
    const ed = this.editando();
    if (id == null || ed == null) return;
    const b = this.borrador();
    const nombre = b.nombre.trim();
    if (!nombre) { this.error.set('Poné el nombre del proveedor.'); this.errorCampo.set('nombre'); return; }
    const plazoTxt = b.plazoPagoDias.trim();
    const plazo = plazoTxt === '' ? null : Number(plazoTxt);
    if (plazo != null && (!Number.isInteger(plazo) || plazo < 0 || plazo > 365)) {
      this.error.set('El plazo de pago va de 0 a 365 días.');
      this.errorCampo.set('plazoPagoDias');
      return;
    }
    const texto = (t: string) => t.trim() || null;
    this.guardando.set(true);
    this.error.set(null);
    this.errorCampo.set(null);
    const op: Observable<{ nombre: string }> = this.completa()
      ? (() => {
          const req: ProveedorFichaRequest = {
            businessAccountId: id, nombre, razonSocial: texto(b.razonSocial), cuit: texto(b.cuit), condicionIva: b.condicionIva,
            domicilio: texto(b.domicilio), telefono: texto(b.telefono), email: texto(b.email), contacto: texto(b.contacto),
            plazoPagoDias: plazo, nota: texto(b.nota),
          };
          return ed === 0 ? this.compras.crearProveedor(req) : this.compras.editarProveedor(ed, req);
        })()
      : (() => {
          const req = { businessAccountId: id, nombre, cuit: texto(b.cuit) };
          return ed === 0 ? this.api.crearProveedor(req) : this.api.editarProveedor(ed, req);
        })();
    op.subscribe({
      next: (p) => {
        this.guardando.set(false);
        this.editando.set(null);
        this.aviso.set(ed === 0 ? `Proveedor «${p.nombre}» creado.` : `Proveedor «${p.nombre}» guardado.`);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.error.set(mensajeDeError(err, 'No pudimos guardar el proveedor.'));
        this.errorCampo.set(err instanceof HttpErrorResponse && typeof err.error?.campo === 'string' ? err.error.campo : null);
      },
    });
  }

  protected alternarActivo(p: Fila): void {
    const id = this.cuenta();
    if (id == null) return;
    this.guardando.set(true);
    const op: Observable<unknown> = p.activo
      ? this.api.desactivarProveedor(id, p.id)
      : this.api.editarProveedor(p.id, { businessAccountId: id, nombre: p.nombre, cuit: p.cuit, activo: true });
    op.subscribe({
      next: () => { this.guardando.set(false); this.aviso.set(p.activo ? `«${p.nombre}» desactivado.` : `«${p.nombre}» activado.`); this.cargar(); },
      error: (err) => { this.guardando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cambiar el proveedor.')); },
    });
  }
}
