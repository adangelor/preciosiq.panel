import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArticulosService } from '../../core/articulos';
import { destinosParaMover, margenDeRubro, mensajeDeError, numeroONull } from '../../core/articulos-form';
import { Rubro } from '../../core/articulos.models';
import { GestionContextoService } from '../../core/gestion-contexto';
import { LoadingBarComponent } from '../../layout/loading-bar/loading-bar';

// BP-178 (21-oct-2026) -- Gestión → Rubros. El árbol propio de la cadena, hasta 3 niveles, con el margen objetivo de
// cada rubro (lo usa la formación de precios, BP-181). Un rubro sin margen hereda el de arriba: se muestra "30 %
// (heredado de Almacén)". Un rubro vacío se borra; con artículos o subrubros se desactiva.
@Component({
  selector: 'app-rubros',
  standalone: true,
  imports: [RouterLink, LoadingBarComponent],
  templateUrl: './rubros.html',
  styleUrl: './gestion.scss',
})
export class RubrosComponent implements OnInit {
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
  protected readonly rubros = signal<Rubro[]>([]);
  protected readonly verInactivos = signal(false);

  /** Alta: el padre (null = raíz) y los campos. */
  protected readonly nuevoPadre = signal<number | null | undefined>(undefined);
  protected readonly nuevoNombre = signal('');
  protected readonly nuevoMargen = signal('');

  /** Edición en la fila. */
  protected readonly editandoId = signal<number | null>(null);
  protected readonly editNombre = signal('');
  protected readonly editMargen = signal('');

  /** Mover. */
  protected readonly moviendoId = signal<number | null>(null);

  protected readonly visibles = computed(() => this.rubros().filter((r) => this.verInactivos() || r.activo));
  protected readonly hayInactivos = computed(() => this.rubros().some((r) => !r.activo));
  protected readonly nombrePadreNuevo = computed(() => {
    const p = this.nuevoPadre();
    return p == null ? null : this.rubros().find((r) => r.id === p)?.camino ?? null;
  });

  protected readonly margenDeRubro = margenDeRubro;

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
    this.api.rubros(id).subscribe({
      next: (r) => { this.cargando.set(false); this.rubros.set(r); },
      error: (err) => { this.cargando.set(false); this.error.set(mensajeDeError(err, 'No pudimos cargar tus rubros.')); },
    });
  }

  private fallo(err: unknown, reserva: string): void {
    this.guardando.set(false);
    this.error.set(mensajeDeError(err, reserva));
  }

  // ---- alta ----
  protected empezarAlta(padre: number | null): void {
    this.cerrarTodo();
    this.nuevoPadre.set(padre);
    this.nuevoNombre.set('');
    this.nuevoMargen.set('');
  }

  protected onNuevoNombre(e: Event): void { this.nuevoNombre.set((e.target as HTMLInputElement).value); }
  protected onNuevoMargen(e: Event): void { this.nuevoMargen.set((e.target as HTMLInputElement).value); }

  protected crear(): void {
    const id = this.cuenta();
    if (id == null) return;
    const nombre = this.nuevoNombre().trim();
    if (!nombre) { this.error.set('Poné el nombre del rubro.'); return; }
    this.guardando.set(true);
    this.error.set(null);
    this.api.crearRubro({ businessAccountId: id, nombre, parentId: this.nuevoPadre() ?? null, margenObjetivoPct: numeroONull(this.nuevoMargen()) })
      .subscribe({
        next: (r) => {
          this.guardando.set(false);
          this.nuevoPadre.set(undefined);
          this.aviso.set(`Rubro «${r.camino}» creado.`);
          this.cargar();
        },
        error: (err) => this.fallo(err, 'No pudimos crear el rubro.'),
      });
  }

  // ---- edición en la fila ----
  protected editar(r: Rubro): void {
    this.cerrarTodo();
    this.editandoId.set(r.id);
    this.editNombre.set(r.nombre);
    this.editMargen.set(r.margenObjetivoPct != null ? String(r.margenObjetivoPct).replace('.', ',') : '');
  }

  protected onEditNombre(e: Event): void { this.editNombre.set((e.target as HTMLInputElement).value); }
  protected onEditMargen(e: Event): void { this.editMargen.set((e.target as HTMLInputElement).value); }

  protected guardar(r: Rubro): void {
    const id = this.cuenta();
    if (id == null) return;
    this.guardando.set(true);
    this.error.set(null);
    this.api.editarRubro(r.id, { businessAccountId: id, nombre: this.editNombre().trim(), margenObjetivoPct: numeroONull(this.editMargen()), orden: r.orden })
      .subscribe({
        next: () => { this.guardando.set(false); this.editandoId.set(null); this.aviso.set('Rubro guardado.'); this.cargar(); },
        error: (err) => this.fallo(err, 'No pudimos guardar el rubro.'),
      });
  }

  protected activar(r: Rubro): void {
    const id = this.cuenta();
    if (id == null) return;
    this.guardando.set(true);
    this.api.editarRubro(r.id, { businessAccountId: id, nombre: r.nombre, margenObjetivoPct: r.margenObjetivoPct, orden: r.orden, activo: true })
      .subscribe({
        next: () => { this.guardando.set(false); this.aviso.set(`Rubro «${r.nombre}» activado.`); this.cargar(); },
        error: (err) => this.fallo(err, 'No pudimos activar el rubro.'),
      });
  }

  protected borrar(r: Rubro): void {
    const id = this.cuenta();
    if (id == null) return;
    const texto = r.articulos > 0
      ? `«${r.nombre}» tiene ${r.articulos} artículos: se desactiva (no se borra) y los artículos conservan el rubro. ¿Seguimos?`
      : `¿Borrar el rubro «${r.nombre}»? Si tiene subrubros desactivados, se desactiva en vez de borrarse.`;
    if (!window.confirm(texto)) return;
    this.guardando.set(true);
    this.error.set(null);
    this.api.borrarRubro(id, r.id).subscribe({
      next: (x) => {
        this.guardando.set(false);
        this.aviso.set(x.resultado === 'borrado' ? `Rubro «${r.nombre}» borrado.` : `Rubro «${r.nombre}» desactivado.`);
        this.cargar();
      },
      error: (err) => this.fallo(err, 'No pudimos borrar el rubro.'),
    });
  }

  // ---- mover ----
  protected empezarMover(r: Rubro): void {
    this.cerrarTodo();
    this.moviendoId.set(r.id);
  }

  protected destinos(r: Rubro): Rubro[] {
    return destinosParaMover(this.rubros(), r.id).filter((d) => d.id !== r.parentId);
  }

  protected mover(r: Rubro, e: Event): void {
    const id = this.cuenta();
    const v = (e.target as HTMLSelectElement).value;
    if (id == null || v === '') return;
    const destino = v === 'raiz' ? null : Number(v);
    this.guardando.set(true);
    this.error.set(null);
    this.api.moverRubro(id, r.id, destino).subscribe({
      next: (lista) => { this.guardando.set(false); this.moviendoId.set(null); this.rubros.set(lista); this.aviso.set(`Rubro «${r.nombre}» movido.`); },
      error: (err) => this.fallo(err, 'No pudimos mover el rubro.'),
    });
  }

  protected cerrarTodo(): void {
    this.aviso.set(null);
    this.error.set(null);
    this.nuevoPadre.set(undefined);
    this.editandoId.set(null);
    this.moviendoId.set(null);
  }

  protected onVerInactivos(e: Event): void {
    this.verInactivos.set((e.target as HTMLInputElement).checked);
  }
}
