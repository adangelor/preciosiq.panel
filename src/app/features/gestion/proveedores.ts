import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ArticulosService } from '../../core/articulos';
import { mensajeDeError } from '../../core/articulos-form';
import { Proveedor } from '../../core/articulos.models';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

/** "30-50001091-2" a partir de los 11 números. */
export function cuitConGuiones(cuit: string | null): string {
  if (!cuit || cuit.length !== 11) return cuit ?? '—';
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

// BP-178 (21-oct-2026) -- Gestión → Proveedores. Lo mínimo (nombre y CUIT): las compras (BP-180) lo completan. Un
// proveedor no se borra: se desactiva (los costos y los artículos lo siguen nombrando).
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

  protected readonly cargandoCuenta = signal(true);
  protected readonly sinCuenta = signal(false);
  protected readonly sinPlan = signal(false);
  protected readonly errorCuenta = signal<string | null>(null);
  private readonly cuenta = signal<number | null>(null);

  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly lista = signal<Proveedor[]>([]);
  protected readonly verInactivos = signal(false);

  /** null = cerrado; 0 = nuevo; >0 = editando ese. */
  protected readonly editando = signal<number | null>(null);
  protected readonly nombre = signal('');
  protected readonly cuit = signal('');

  protected readonly visibles = computed(() => this.lista().filter((p) => this.verInactivos() || p.activo));
  protected readonly hayInactivos = computed(() => this.lista().some((p) => !p.activo));
  protected readonly cuitConGuiones = cuitConGuiones;

  ngOnInit(): void {
    this.gestion.load().subscribe({
      next: (g) => {
        this.cargandoCuenta.set(false);
        if (!g) { this.sinCuenta.set(true); return; }
        if (!g.gestionArticulos) { this.sinPlan.set(true); return; }
        this.cuenta.set(g.businessAccountId);
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
    this.api.proveedores(id).subscribe({
      next: (p) => { this.cargando.set(false); this.lista.set(p); },
      error: (err) => { this.cargando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cargar tus proveedores.')); },
    });
  }

  protected nuevo(): void {
    this.aviso.set(null);
    this.error.set(null);
    this.nombre.set('');
    this.cuit.set('');
    this.editando.set(0);
  }

  protected editar(p: Proveedor): void {
    this.aviso.set(null);
    this.error.set(null);
    this.nombre.set(p.nombre);
    this.cuit.set(p.cuit ?? '');
    this.editando.set(p.id);
  }

  protected onNombre(e: Event): void { this.nombre.set((e.target as HTMLInputElement).value); }
  protected onCuit(e: Event): void { this.cuit.set((e.target as HTMLInputElement).value); }
  protected onVerInactivos(e: Event): void { this.verInactivos.set((e.target as HTMLInputElement).checked); }

  protected guardar(): void {
    const id = this.cuenta();
    const ed = this.editando();
    if (id == null || ed == null) return;
    const nombre = this.nombre().trim();
    if (!nombre) { this.error.set('Poné el nombre del proveedor.'); return; }
    const req = { businessAccountId: id, nombre, cuit: this.cuit().trim() || null };
    this.guardando.set(true);
    this.error.set(null);
    (ed === 0 ? this.api.crearProveedor(req) : this.api.editarProveedor(ed, req)).subscribe({
      next: (p) => {
        this.guardando.set(false);
        this.editando.set(null);
        this.aviso.set(ed === 0 ? `Proveedor «${p.nombre}» creado.` : `Proveedor «${p.nombre}» guardado.`);
        this.cargar();
      },
      error: (err) => { this.guardando.set(false); this.error.set(mensajeDeError(err, 'No pudimos guardar el proveedor.')); },
    });
  }

  protected alternarActivo(p: Proveedor): void {
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
