// Utilitários de data no fuso da loja. O banco guarda tudo em UTC (ISO 8601).

/** Diferença em minutos entre o fuso `timeZone` e UTC no instante `date` (ex.: -180 para São Paulo). */
export function tzOffsetMinutes(date, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName').value; // "GMT-03:00" ou "GMT"
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

/** "YYYY-MM-DD" do dia local em que `date` cai. */
export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Hora local (0–23) do instante `date`. */
export function localHour(date, timeZone) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date));
}

/** Instante UTC correspondente à meia-noite local do dia "YYYY-MM-DD". */
export function startOfLocalDay(ymd, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const offset = tzOffsetMinutes(new Date(utcMidnight), timeZone);
  return new Date(utcMidnight - offset * 60_000);
}

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const isYmd = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
