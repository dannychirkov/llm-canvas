import type { CsvFileData } from "@/types"

export function limitCsvRows(data: string, enabled?: boolean, maxRows?: number): string {
  if (!enabled || !maxRows || maxRows <= 0) return data
  const rows = data.split("\n")
  return rows.length > maxRows ? rows.slice(0, maxRows).join("\n") + `\n... (truncated to ${maxRows} rows)` : data
}

export function formatCsvContext(file: CsvFileData): string {
  return `CSV Data from file "${file.filename}":\n${file.caption ? `Description: ${file.caption}\n` : ""}Dimensions: ${file.csvRows} rows × ${file.csvColumns} columns\nData:\n${file.csvData}`
}

/** Accept both graph text containing CSV and direct API calls supplying structured CSV. */
export function appendCsvContext(prompt: string, files: CsvFileData[] = []): string {
  const additions = files.filter(file => {
    const canonical = formatCsvContext(file)
    // Older clients embedded the rows in the Media: ... - CSV Data: ... format.
    const legacy = `CSV Data:\n${file.csvData.trim()}`
    return !prompt.includes(canonical) && !(file.csvData.trim() && prompt.includes(legacy))
  }).map(formatCsvContext)
  return additions.length ? prompt + "\n\n" + additions.join("\n\n") : prompt
}
