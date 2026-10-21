import { HttpErrorResponse } from '@angular/common/http';
import {
  avisoDeCodigo,
  destinosParaMover,
  filasExcel,
  margenDeRubro,
  margenTexto,
  mensajeDeError,
  numeroONull,
  opcionesDeRubro,
} from './articulos-form';
import { Rubro } from './articulos.models';

// BP-178 -- lo que muestran las pantallas de Gestión.
describe('articulos-form', () => {
  const rubro = (id: number, parentId: number | null, nivel: number, nombre: string, extra: Partial<Rubro> = {}): Rubro => ({
    id, parentId, nivel, nombre, camino: nombre, margenObjetivoPct: null, margenEfectivoPct: null, margenHeredadoDe: null,
    orden: 0, activo: true, articulos: 0, ...extra,
  });
  const arbol = [
    rubro(1, null, 1, 'Almacén', { margenObjetivoPct: 30, margenEfectivoPct: 30 }),
    rubro(2, 1, 2, 'Galletitas', { margenEfectivoPct: 30, margenHeredadoDe: 'Almacén' }),
    rubro(3, 2, 3, 'Dulces', { margenEfectivoPct: 30, margenHeredadoDe: 'Almacén' }),
    rubro(4, null, 1, 'Bebidas'),
    rubro(5, null, 1, 'Viejo', { activo: false }),
  ];

  it('margen del artículo: propio, heredado o nada', () => {
    expect(margenTexto({ margenObjetivoPct: 25, margenDe: 'propio' })).toBe('25 % propio');
    expect(margenTexto({ margenObjetivoPct: 30, margenDe: 'Almacén' })).toBe('30 % (de Almacén)');
    expect(margenTexto({ margenObjetivoPct: null, margenDe: null })).toBe('—');
  });

  it('margen del rubro en el árbol: el propio, el heredado con su origen, o sin margen', () => {
    expect(margenDeRubro(arbol[0])).toBe('30 %');
    expect(margenDeRubro(arbol[2])).toBe('30 % (heredado de Almacén)');
    expect(margenDeRubro(arbol[3])).toBe('sin margen');
  });

  it('opciones de rubro: en orden, con sangría, sin los desactivados salvo el elegido', () => {
    const o = opcionesDeRubro(arbol);
    expect(o.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(o[2].etiqueta).toBe('  Dulces');
    expect(opcionesDeRubro(arbol, 5).map((x) => x.id)).toContain(5);
  });

  it('a dónde se puede mover un rubro: ni a sí mismo ni a sus hijos, y sin pasar de 3 niveles', () => {
    // Galletitas (con Dulces abajo) tiene altura 2: solo puede ir debajo de uno de nivel 1.
    expect(destinosParaMover(arbol, 2).map((r) => r.id)).toEqual([1, 4]);
    // Almacén (altura 3) no entra debajo de nada.
    expect(destinosParaMover(arbol, 1)).toEqual([]);
    // Dulces (altura 1) puede ir debajo de cualquiera de nivel 1 o 2 que no sea él mismo.
    expect(destinosParaMover(arbol, 3).map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it('el error del backend llega tal cual; el 402 dice que es el plan', () => {
    const e400 = new HttpErrorResponse({ status: 400, error: { error: 'Ese código ya es de «Galletitas Prueba».' } });
    expect(mensajeDeError(e400, 'x')).toBe('Ese código ya es de «Galletitas Prueba».');
    const e402 = new HttpErrorResponse({ status: 402, error: { error: 'Esta funcion no esta incluida en tu plan actual.' } });
    expect(mensajeDeError(e402, 'x')).toContain('/plan');
    expect(mensajeDeError(new HttpErrorResponse({ status: 500 }), 'reserva')).toBe('reserva');
  });

  it('números de los inputs: coma decimal, porcentaje y vacío', () => {
    expect(numeroONull('10,5')).toBe(10.5);
    expect(numeroONull('35 %')).toBe(35);
    expect(numeroONull('')).toBeNull();
    expect(numeroONull('abc')).toBeNull();
  });

  it('aviso de código: un EAN con el verificador mal se avisa antes de mandar; un código interno no', () => {
    expect(avisoDeCodigo('7790895000997')).toBeNull();
    expect(avisoDeCodigo('7790895000996')).toContain('dígito verificador');
    expect(avisoDeCodigo('C0001')).toBeNull();
    expect(avisoDeCodigo('12345')).toBeNull();
  });

  it('las filas del Excel llevan los encabezados en castellano', () => {
    const filas = filasExcel([{
      articulo: {
        id: 1, codigo: '7790895000997', esEan: true, codigoInterno: 'G-1', descripcion: 'Galletitas', marca: 'M',
        presentacionCantidad: 200, presentacionUnidad: 'GR', rubroId: 2, rubro: 'Almacén > Galletitas', proveedorHabitualId: null,
        proveedor: null, ivaAlicuota: 21, costoNeto: 1000, costoDesde: '2026-10-21', margenObjetivoPct: 30, margenDe: 'Almacén',
        sucursales: 2, activo: true, ivaParaRevisar: false,
      },
      impuestosInternosPct: null, unidadesPorBulto: 12, margenPropioPct: null, codigosAlternativos: null, codigosDeBulto: '17790895000994 x12',
    }]);
    expect(filas[0]['Presentación']).toBe('200 GR');
    expect(filas[0]['Códigos de bulto']).toBe('17790895000994 x12');
    expect(filas[0]['Costo sin IVA']).toBe(1000);
  });
});
