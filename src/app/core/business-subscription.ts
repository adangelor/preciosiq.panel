import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BillingCycle,
  CreateCheckoutResponse,
  PlanCatalogItem,
  SubscriptionStatusResponse,
} from './business-subscription.models';

// Cliente de BusinessSubscriptionEndpoints.cs (E10).
@Injectable({ providedIn: 'root' })
export class BusinessSubscriptionService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}business/subscriptions`;

  getPlans(): Observable<PlanCatalogItem[]> {
    return this.http.get<PlanCatalogItem[]>(`${this.baseUrl}/plans`);
  }

  getStatus(businessAccountId: number): Observable<SubscriptionStatusResponse> {
    return this.http.get<SubscriptionStatusResponse>(`${this.baseUrl}/status`, {
      params: { businessAccountId },
    });
  }

  createCheckout(
    businessAccountId: number,
    tier: string,
    billingCycle: BillingCycle,
  ): Observable<CreateCheckoutResponse> {
    return this.http.post<CreateCheckoutResponse>(`${this.baseUrl}/checkout`, {
      businessAccountId,
      tier,
      billingCycle,
    });
  }

  downgradeToFree(businessAccountId: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/downgrade-to-free`, null, {
      params: { businessAccountId },
    });
  }
}
