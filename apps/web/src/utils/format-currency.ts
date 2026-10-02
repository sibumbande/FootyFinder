export const formatRands = (amountCents: number) =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
export const formatCurrency = (amountCents: number, currency = 'ZAR') =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(amountCents / 100);
/** DEC-021: ticket prices in the brief's style, "R80" or "R1,120" (whole rands, comma thousands). */
export const formatWholeRands = (amountCents: number) =>
  `R${Math.round(amountCents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
