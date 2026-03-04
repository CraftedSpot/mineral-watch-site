export interface DocumentChild {
  id: string;
  display_name: string;
  doc_type: string;
  page_range?: string;
}

export interface DocumentDetail {
  id: string;
  display_name: string;
  filename: string;
  category: string;
  doc_type: string;
  status: string;
  content_type: string;
  rotation_applied: number;
  extracted_data: Record<string, unknown> | null;
  extraction_error: string | null;
  user_notes: string;
  children?: DocumentChild[];
  linked_properties?: Array<{
    id: string;
    location: string;
    group?: string;
    county?: string;
    section?: string;
    township?: string;
    range?: string;
  }>;
  linked_wells?: Array<{
    id: string;
    well_name: string;
    api_number: string;
    operator?: string;
    county?: string;
    well_status?: string;
  }>;
  well_id: string | null;
  well_name: string | null;
  well_status: string | null;
  well_api_number: string | null;
  credits_used: number;
  created_at: string;
}
