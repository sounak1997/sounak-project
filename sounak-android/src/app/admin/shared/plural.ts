/** "1 clinic", "3 clinics". Pass the plural when it isn't just +s. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
