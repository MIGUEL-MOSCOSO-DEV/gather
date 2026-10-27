export function ticketToken(value) {
  try {
    const url = new URL(value);
    return url.pathname.split('/ticket/')[1] || '';
  } catch {
    return value.trim();
  }
}
export const csvCell = (value) =>
  '"' +
  (/^[=+\-@\t\r]/.test(String(value)) ? "'" : '') +
  String(value ?? '').replaceAll('"', '""') +
  '"';
