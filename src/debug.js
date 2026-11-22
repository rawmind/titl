export function formatDebugInfo(sections) {
  return sections
    .map(([title, rows]) => {
      const lines = rows.filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}: ${value}`);
      return [`[${title}]`, ...(lines.length ? lines : ['-'])].join('\n');
    })
    .join('\n\n');
}

export function describeTiming(timing) {
  if (!timing) return null;
  const ratio = timing.requestMs / 1000 / timing.audioSec;
  return `${(timing.requestMs / 1000).toFixed(1)} s for ${timing.audioSec.toFixed(1)} s of audio (${ratio.toFixed(2)}× real time)`;
}

const GPU_MAX_RATIO = 0.2;
const CPU_MIN_RATIO = 0.5;

export function estimateBackend(timing) {
  if (!timing) return 'unknown: start subtitles once, or update the helper for the exact answer';
  const ratio = timing.requestMs / 1000 / timing.audioSec;
  const guess = ratio <= GPU_MAX_RATIO ? 'probably GPU' : ratio >= CPU_MIN_RATIO ? 'probably CPU' : 'unclear';
  return `${guess} (estimated from speed, ${ratio.toFixed(2)}× real time; update the helper for the exact answer)`;
}

export function browserFromBrands(brands) {
  const names = ['Microsoft Edge', 'Opera', 'Brave', 'Google Chrome', 'Chromium'];
  for (const name of names) {
    const brand = brands?.find((b) => b.brand === name);
    if (brand) return `${name.replace('Google ', '').replace('Microsoft ', '')} ${brand.version}`;
  }
  return null;
}

export function browserName(userAgent) {
  const match =
    userAgent.match(/(Edg|OPR|Brave)\/([\d.]+)/) ?? userAgent.match(/(Chrome)\/([\d.]+)/) ?? userAgent.match(/(\w+)\/([\d.]+)$/);
  if (!match) return userAgent;
  const names = { Edg: 'Edge', OPR: 'Opera' };
  return `${names[match[1]] ?? match[1]} ${match[2]}`;
}
