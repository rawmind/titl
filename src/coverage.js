export class Coverage {
  constructor() {
    this.ranges = [];
  }

  add(start, end, tolerance = 0.5) {
    const all = [...this.ranges, [start, end]].sort((a, b) => a[0] - b[0]);
    this.ranges = [];
    for (const r of all) {
      const last = this.ranges.at(-1);
      if (last && r[0] <= last[1] + tolerance) last[1] = Math.max(last[1], r[1]);
      else this.ranges.push([...r]);
    }
  }

  endAt(t, tolerance = 1) {
    return this.ranges.find(([a, b]) => t >= a - tolerance && t <= b)?.[1] ?? null;
  }
}
