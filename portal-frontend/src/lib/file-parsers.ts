import Papa from 'papaparse';

export interface ParseResult {
  data: Record<string, unknown>[];
  fileName: string;
  fileSize: number;
}

export function parseCSVFile(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error(`CSV parsing error: ${results.errors[0].message}`));
          return;
        }
        resolve({
          data: results.data as Record<string, unknown>[],
          fileName: file.name,
          fileSize: file.size,
        });
      },
      error: (error: Error) => {
        reject(new Error(`CSV parsing failed: ${error.message}`));
      },
    });
  });
}

export async function parseExcelFile(file: File): Promise<ParseResult> {
  const XLSX = await import('xlsx');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet) as Record<string, unknown>[];
        if (jsonData.length === 0) {
          reject(new Error('No data found in file'));
          return;
        }
        resolve({
          data: jsonData,
          fileName: file.name,
          fileSize: file.size,
        });
      } catch (err) {
        reject(new Error(`Excel parsing failed: ${(err as Error).message}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function parseFile(file: File): Promise<ParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    return parseCSVFile(file);
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return parseExcelFile(file);
  }
  return Promise.reject(new Error('Unsupported file type. Please upload a CSV or Excel (.xlsx) file.'));
}
