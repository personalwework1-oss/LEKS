const pad = (n: number) => String(n).padStart(2, "0");

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."];
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** Time in the chat list: today "23:41", yesterday "Вчера", this week "Пн", older "18 окт.". */
export function listTime(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (at >= startOfToday) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (at >= startOfToday - day) return "Вчера";
  if (at >= startOfToday - 6 * day) return WEEKDAYS[date.getDay()]!;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function clockTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Day separators in a conversation: "Сегодня", "Вчера", "18 октября". */
export function dayLabel(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (at >= startOfToday) return "Сегодня";
  if (at >= startOfToday - day) return "Вчера";
  const full = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const sameYear = date.getFullYear() === today.getFullYear();
  return `${date.getDate()} ${full[date.getMonth()]}${sameYear ? "" : ` ${date.getFullYear()}`}`;
}

export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
