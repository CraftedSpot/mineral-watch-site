import { apiFetch } from './client';
import type { PropertyProductionResponse, WellProductionResponse, PricesResponse } from '../types/revenue';

export function fetchPropertyProduction(propertyId: string): Promise<PropertyProductionResponse> {
  return apiFetch(`/api/tools/property-production?property_id=${encodeURIComponent(propertyId)}`);
}

export function fetchWellProduction(wellId: string): Promise<WellProductionResponse> {
  return apiFetch(`/api/tools/well-production?well_id=${encodeURIComponent(wellId)}`);
}

export async function fetchPrices(): Promise<PricesResponse> {
  const res = await fetch('/api/prices');
  if (!res.ok) throw new Error(`Prices fetch failed: ${res.status}`);
  return res.json();
}
