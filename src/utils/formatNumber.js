export function formatCompactNumber(number) {
  if (number === undefined || number === null) return '0';
  const n = typeof number === 'string' ? parseInt(number, 10) : number;
  if (isNaN(n)) return '0';
  
  if (n < 1000) return n.toString();
  if (n >= 1000 && n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
  return (n / 1000000).toFixed(1) + 'M';
}
