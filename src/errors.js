export const MAX_ERRORS = 10;
export const MAX_ERROR_CHARS = 300;
const MAX_SOURCE_CHARS = 40;

function clip(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function pushError(list, { source, message, at }) {
  const entry = { at, source: clip(source, MAX_SOURCE_CHARS) || 'unknown', message: clip(message, MAX_ERROR_CHARS) || 'unknown error', count: 1 };
  const previous = Array.isArray(list) ? list.slice(-MAX_ERRORS) : [];
  const last = previous.at(-1);
  if (last && last.source === entry.source && last.message === entry.message) {
    return [...previous.slice(0, -1), { ...last, at: entry.at, count: (last.count ?? 1) + 1 }];
  }
  return [...previous, entry].slice(-MAX_ERRORS);
}

function clock(at) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function describeErrors(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(-MAX_ERRORS)
    .reverse()
    .map((e) => [`${clock(e.at)} ${e.source}`, e.count > 1 ? `${e.message} (×${e.count})` : e.message]);
}
