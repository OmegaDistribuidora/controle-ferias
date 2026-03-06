export function formatDate(dateString) {
  if (!dateString) return "-";
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

export function formatPeriod(startDate, endDate) {
  return `${formatDate(startDate)} a ${formatDate(endDate)}`;
}
