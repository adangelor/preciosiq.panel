import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AdvisorService } from '../../core/advisor';
import { AdvisorReportResponse } from '../../core/advisor.models';
import { planGateErrorMessage } from '../../core/plan-gate';

// Asesor de Precios, fase 1 (21-ago-2026, PreciosIQ_Asesor_Spec.md P0.3) -- el
// dialog que pide y muestra el informe. MatDialog por la misma razon que
// benchmark-detail-dialog (CDK Overlay, fuera del sidenav con transform).
//
// 31-ago-2026 -- REESTRUCTURADO. Antes el informe era una pared de prosa con los
// productos embebidos en el texto (el markdown del LLM o del modo basico), y las
// tablas eran un "ver evidencia" opcional y solo de competitividad.
//
// Ahora hay una division dura:
//   · el MARKDOWN aporta unicamente la narrativa (diagnostico + acciones),
//   · las TABLAS se arman en el template desde `digest`, que es el objeto
//     deterministico que ya viajaba en la respuesta.
//
// Por que asi y no pidiendole tablas markdown al modelo: el digest ya tiene los
// numeros calculados y tipados, asi que una tabla armada desde ahi es correcta y
// esta bien formada SIEMPRE -- incluso en modo basico, incluso si el modelo se
// manda una macana con el formato. Es la misma regla de §6 de la spec ("el LLM no
// hace cuentas") aplicada al render: el LLM tampoco dibuja la tabla.
//
// El informe llega en Markdown -- se renderiza con un conversor minimo PROPIO
// (headers/negrita/listas/blockquote), escapando el HTML primero: el texto viene de
// un LLM que leyo descripciones de productos cargadas por terceros, asi que se
// trata como NO confiable. [innerHTML] de Angular ademas pasa por su sanitizer --
// doble red.
export interface AdvisorReportDialogData {
  businessAccountId: number;
  branchId: string;
  maxDistanceMeters: number;
}

@Component({
  selector: 'app-advisor-report-dialog',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './advisor-report-dialog.html',
  styleUrl: './advisor-report-dialog.scss',
})
export class AdvisorReportDialogComponent implements OnInit {
  protected readonly dialogRef = inject(MatDialogRef<AdvisorReportDialogComponent>);
  protected readonly data = inject<AdvisorReportDialogData>(MAT_DIALOG_DATA);
  private readonly advisorService = inject(AdvisorService);

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly report = signal<AdvisorReportResponse | null>(null);
  protected readonly reportHtml = signal<string>('');
  /**
   * BP-75 (09-oct-2026) -- contra quien se compara: con 1 o 2 cadenas en el radio el digest trae su nombre
   * ("La Anonima") y la pantalla lo dice en vez de "la zona". En informes viejos o con 3+ cadenas, "la zona".
   */
  protected readonly zona = computed(() => this.report()?.digest?.metadatos?.referenciaNombrada ?? 'la zona');
  /** Para columnas angostas: "Ref. zona" / "Ref. La Anonima". */
  protected readonly refCorta = computed(() => this.report()?.digest?.metadatos?.referenciaNombrada ?? 'zona');
  protected readonly feedbackSent = signal<boolean | null>(null); // true=me sirvio false=no me sirvio

  ngOnInit(): void {
    this.load(false);
  }

  protected load(refresh: boolean): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.feedbackSent.set(null);

    this.advisorService
      .generateReport(this.data.businessAccountId, this.data.branchId, this.data.maxDistanceMeters, refresh)
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          this.report.set(response);
          this.reportHtml.set(this.renderMarkdown(response.reportMarkdown));
        },
        error: (err) => {
          this.loading.set(false);
          const gateMessage = planGateErrorMessage(err);
          this.errorMessage.set(
            gateMessage ?? err?.error?.error ?? 'No pudimos generar el informe. Probá de nuevo en unos minutos.',
          );
        },
      });
  }

  protected sendFeedback(thumbsUp: boolean): void {
    const r = this.report();
    if (!r || this.feedbackSent() !== null) return;
    this.feedbackSent.set(thumbsUp);
    // Fire-and-forget: el voto no bloquea nada; si falla, no molestamos al usuario.
    this.advisorService.submitFeedback(r.reportId, thumbsUp).subscribe({ error: () => {} });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  // "Guardar como PDF" es el propio dialogo de impresion del navegador: sin
  // dependencias nuevas en el bundle, con texto seleccionable y tablas que cortan
  // solas entre paginas (jsPDF+html2canvas daria una imagen y pesaria de mas).
  // Las reglas @media print viven en styles.scss porque tienen que alcanzar al
  // <body> y al overlay del CDK, que estan FUERA del encapsulamiento de este
  // componente.
  protected print(): void {
    window.print();
  }

  // ---- Formateo (es-AR) ----

  protected money(value: number): string {
    // Sin centavos arriba de $1.000: en un informe de posicion los centavos son ruido.
    const decimals = Math.abs(value) >= 1000 ? 0 : 2;
    return '$' + value.toLocaleString('es-AR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  // Los *Pct del digest YA vienen en puntos porcentuales (AdvisorDigestService
  // multiplica por 100 y redondea a 1 decimal). Aca no se recalcula nada.
  protected pct(value: number): string {
    return value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }

  protected signed(value: number): string {
    return (value > 0 ? '+' : '') + this.pct(value);
  }

  // 31-ago-2026 -- posicion x rotacion. "Sostener" es una accion de pleno derecho: no
  // tocar un precio que esta funcionando ES una decision, y es la que mas plata cuida.
  protected accionLabel(accion: string): string {
    switch (accion) {
      case 'subir': return 'Subir precio';
      case 'sostener': return 'Sostener';
      case 'bajar': return 'Bajar precio';
      case 'revisar-surtido': return 'No es precio';
      case 'revisar-costo': return 'Revisar costo';
      default: return accion;
    }
  }

  // Que significa el numero en pesos de esa fila. Un solo importe no puede ser a la vez
  // una ganancia y una perdida, asi que la etiqueta va al lado del numero y no en el
  // encabezado de la columna.
  protected sentidoLabel(sentido: string): string {
    switch (sentido) {
      case 'ganancia': return 'a ganar';
      case 'riesgo': return 'en riesgo si bajás';
      case 'resigna': return 'que resignás';
      default: return '';
    }
  }

  protected generatedAtLocal(): string {
    const r = this.report();
    if (!r) return '';
    return new Date(r.generatedAtUtc).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  // Conversor Markdown minimo: SOLO lo que el prompt del asesor puede producir
  // (#/##/###, **negrita**, _italica_, listas -/1., > cita). Escapa TODO el HTML
  // de entrada antes de convertir.
  private renderMarkdown(md: string): string {
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const inline = (s: string) =>
      s
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|\s)_([^_]+)_(?=\s|[.,;:!?)]|$)/g, '$1<em>$2</em>');

    const lines = md.split('\n');
    const out: string[] = [];
    let inList: 'ul' | 'ol' | null = null;
    const closeList = () => {
      if (inList) {
        out.push(inList === 'ul' ? '</ul>' : '</ol>');
        inList = null;
      }
    };

    for (const raw of lines) {
      const line = escape(raw.trimEnd());
      const trimmed = line.trim();

      // 31-ago-2026: si el modelo manda una tabla markdown igual, se descarta la
      // fila en vez de escupir "|---|---|" como parrafo. Las tablas de este informe
      // salen del digest; el markdown es solo narrativa.
      if (/^\|/.test(trimmed)) { closeList(); continue; }

      if (/^###\s+/.test(trimmed)) { closeList(); out.push(`<h4>${inline(trimmed.replace(/^###\s+/, ''))}</h4>`); }
      else if (/^##\s+/.test(trimmed)) { closeList(); out.push(`<h3>${inline(trimmed.replace(/^##\s+/, ''))}</h3>`); }
      else if (/^#\s+/.test(trimmed)) { closeList(); out.push(`<h2>${inline(trimmed.replace(/^#\s+/, ''))}</h2>`); }
      else if (/^&gt;\s?/.test(trimmed)) { closeList(); out.push(`<blockquote>${inline(trimmed.replace(/^&gt;\s?/, ''))}</blockquote>`); }
      else if (/^[-*]\s+/.test(trimmed)) {
        if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
        out.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      } else if (/^\d+[.)]\s+/.test(trimmed)) {
        if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
        out.push(`<li>${inline(trimmed.replace(/^\d+[.)]\s+/, ''))}</li>`);
      } else if (trimmed.length === 0) {
        closeList();
      } else {
        closeList();
        out.push(`<p>${inline(trimmed)}</p>`);
      }
    }
    closeList();
    return out.join('\n');
  }
}
