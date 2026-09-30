/**
 * Datas comemorativas que vendem muito no Adobe Stock. O ideal é enviar esse conteúdo
 * com 1 a 3 meses de antecedência, então o sistema inclui na pesquisa as datas que
 * acontecem entre 15 e 100 dias a partir de hoje.
 */
export interface SeasonalEvent {
  name: string;
  query: string;
  date: Date;
  daysAhead: number;
}

type DateFn = (year: number) => Date;

/** n-ésimo dia da semana (0 = domingo) de um mês. */
const nthWeekday = (year: number, month: number, weekday: number, n: number): Date => {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
};

/** Domingo de Páscoa (algoritmo gregoriano anônimo). */
const easter: DateFn = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
};

const EVENTS: { name: string; query: string; date: DateFn }[] = [
  { name: 'Ano Novo', query: 'new year celebration', date: (y) => new Date(y, 0, 1) },
  { name: 'Dia dos Namorados (Valentine’s)', query: 'valentines day love', date: (y) => new Date(y, 1, 14) },
  { name: 'St. Patrick’s Day', query: 'st patricks day', date: (y) => new Date(y, 2, 17) },
  { name: 'Páscoa', query: 'easter holiday', date: easter },
  { name: 'Dia das Mães', query: 'mothers day', date: (y) => nthWeekday(y, 4, 0, 2) },
  { name: 'Dia dos Pais (EUA)', query: 'fathers day', date: (y) => nthWeekday(y, 5, 0, 3) },
  { name: 'Férias de verão', query: 'summer vacation beach', date: (y) => new Date(y, 6, 1) },
  { name: 'Volta às aulas', query: 'back to school', date: (y) => new Date(y, 7, 20) },
  { name: 'Halloween', query: 'halloween', date: (y) => new Date(y, 9, 31) },
  { name: 'Thanksgiving', query: 'thanksgiving dinner', date: (y) => nthWeekday(y, 10, 4, 4) },
  {
    name: 'Black Friday',
    query: 'black friday shopping',
    date: (y) => {
      const t = nthWeekday(y, 10, 4, 4);
      return new Date(y, t.getMonth(), t.getDate() + 1);
    },
  },
  { name: 'Natal', query: 'christmas holiday', date: (y) => new Date(y, 11, 25) },
];

export function upcomingSeasonal(now = new Date(), minDays = 15, maxDays = 100, limit = 4): SeasonalEvent[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const found: SeasonalEvent[] = [];
  for (const ev of EVENTS) {
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const date = ev.date(year);
      const daysAhead = Math.round((date.getTime() - today.getTime()) / 86_400_000);
      if (daysAhead >= minDays && daysAhead <= maxDays) {
        found.push({ name: ev.name, query: ev.query, date, daysAhead });
        break;
      }
    }
  }
  return found.sort((a, b) => a.daysAhead - b.daysAhead).slice(0, limit);
}
