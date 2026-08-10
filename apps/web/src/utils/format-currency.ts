export const formatRands = (amountCents: number) => new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
}).format(amountCents / 100);
