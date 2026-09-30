/** Linha do CSV de metadados aceito pelo portal de colaboradores do Adobe Stock. */
export interface AdobeCsvRow {
  filename: string;
  title: string;
  keywords: string[];
  category: number;
  releases?: string;
}

function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Formato oficial: Filename,Title,Keywords,Category,Releases
 * (UTF-8 sem BOM, palavras-chave separadas por vírgula dentro de uma célula).
 */
export function buildAdobeCsv(rows: AdobeCsvRow[]): string {
  const lines = ['Filename,Title,Keywords,Category,Releases'];
  for (const row of rows) {
    lines.push(
      [cell(row.filename), cell(row.title), cell(row.keywords.join(', ')), String(row.category), cell(row.releases ?? '')].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
