export function rowsToObjects(result: { columns: string[]; values: unknown[][] }[]): Record<string, unknown>[] {
  if (!result || result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map(row => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}
