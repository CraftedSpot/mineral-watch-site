export interface ColumnDef<T> {
  key: string;
  label: string;
  width?: number | string;
  minWidth?: number;
  sortable?: boolean;
  sortKey?: string;
  searchable?: boolean;
  headerAlign?: 'left' | 'right' | 'center';
  render?: (row: T, index: number) => React.ReactNode;
  getValue?: (row: T) => string;
  compare?: (a: T, b: T) => number;
}

export interface DropdownOption {
  value: string;
  label: string;
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
  sortDropdown?: {
    options: DropdownOption[];
    value: string;
    onChange: (value: string) => void;
  };

  // Filter dropdown (optional, e.g. category)
  filterDropdown?: {
    options: DropdownOption[];
    value: string;
    onChange: (value: string) => void;
    label?: string;
  };

  // Extra sort comparators (for sort keys not tied to a visible column)
  customComparators?: Record<string, (a: T, b: T) => number>;

  // Empty/loading states
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;

  // Bulk actions
  bulkActions?: React.ReactNode;
}
