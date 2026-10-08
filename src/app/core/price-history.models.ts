// Espejo de Data/DTOs/PriceHistoryDtos.cs (E7.3).
export interface PriceHistoryPoint {
  capturedAt: string;
  listPrice: number;
  prevListPrice: number | null;
  priceDelta: number | null;
  source: 'sepa' | 'self_reported' | 'crowd' | string;
  changeType: string;
}

export interface PriceHistoryResponse {
  ean: string;
  branchId: string;
  days: number;
  points: PriceHistoryPoint[];
}
