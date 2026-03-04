export interface ColumnDef<T> {
  key: string;
  label: string;
  width?: number | string;
  minWidth?: number;
  sortable?: boolean;
  sortKey?: string;
  searchable?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
  getValue?: (row: T) => string;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  rowHeight?: number;
  virtualThreshold?: number;
  onRowClick?: (row: T) => void;
  getRowId: (row: T) => string;

  // Selection
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;

  // Search
  searchable?: boolean;
  searchPlaceholder?: string;

  // Sort
  defaultSort?: { key: string; direction: 'asc' | 'desc' };

  // Empty/loading states
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;

  // Bulk actions
  bulkActions?: React.ReactNode;
}
