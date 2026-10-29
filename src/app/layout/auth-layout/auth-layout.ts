import { Component, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';

// 29-oct-2026 -- marco de las pantallas sin sesion (ingresar, crear cuenta y recuperar contraseña) con el
// diseño nuevo de la landing. Copia del de distribucioniq.panel (cada panel es un proyecto aparte). El alta
// del negocio (/alta, business-signup) todavia no lo usa: es un formulario mucho mas largo y va aparte: panel de marca oscuro a la izquierda y la tarjeta
// blanca con el formulario a la derecha. Pedido de Andres: que al tocar "Crear cuenta" no se pase del
// diseño nuevo al viejo.
//
// SIN encapsulacion a proposito: el formulario de cada pantalla se proyecta con <ng-content>, y los
// estilos de un componente Angular no llegan a lo que vive en el template de OTRO componente. Por eso
// todas las reglas cuelgan de .auth (y las del formulario, de .auth__card): no se escapan al resto del
// panel. Cada pantalla usa las clases auth-* de auth-layout.scss y ya no trae estilos propios de inputs
// ni de botones.

// La letra Inter, como en la landing: por <link> y una sola vez (ver landing.ts).
const INTER_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
function cargarInter(): void {
  if (typeof document === 'undefined' || document.querySelector(`link[href="${INTER_URL}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = INTER_URL;
  document.head.appendChild(link);
}

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterLink],
  encapsulation: ViewEncapsulation.None,
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.scss',
})
export class AuthLayoutComponent {
  constructor() {
    cargarInter();
  }
}
