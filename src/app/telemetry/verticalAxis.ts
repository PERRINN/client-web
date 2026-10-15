export interface VerticalAxis { min: number; max: number; step: number; ticks: { value: number; y: number }[] }
export function niceStep(value: number) {
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / power;
  return ([1, 2, 2.5, 5, 10].find(n => n >= fraction - 1e-10) || 10) * power;
}
export function axisY(value: number, axis: Pick<VerticalAxis, 'min' | 'max'>) {
  return 52 - (value - axis.min) / (axis.max - axis.min || 1) * 44;
}
export function verticalAxis(min: number, max: number, limits?: {min:number;max:number}): VerticalAxis {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) { min = 0; max = 0; }
  const clamp = (value: number) => limits ? Math.max(limits.min, Math.min(limits.max,value)) : value;
  min = clamp(min); max = clamp(max);
  if (min === max) {
    const padding = Math.abs(min) * 0.1 || 1;
    min -= padding; max += padding;
  }
  // Center genuinely signed signals; small negative excursions need not dominate positive channels.
  const centered = min < 0 && max > 0 && Math.min(-min, max) >= Math.max(-min, max) * 0.2;
  let step = niceStep(centered ? Math.max(-min, max) / 2 : (max - min) / 4);
  let first = 0, last = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (centered) { last = Math.ceil(Math.max(-min, max) / step); first = -last; }
    else {
      // Tiny sign noise near zero should not add an entire extra grid interval.
      first = min < 0 && -min < step * 0.001 ? 0 : Math.floor(min / step);
      last = max > 0 && max < step * 0.001 ? 0 : Math.ceil(max / step);
    }
    if (last - first <= 4) break;
    step = niceStep(step * 1.01);
  }
  const rounded = (n: number) => n === 0 ? 0 : Number((n * step).toPrecision(12));
  const axis: VerticalAxis = { min: clamp(Math.min(rounded(first), min)), max: clamp(Math.max(rounded(last), max)), step, ticks: [] };
  for (let n = last; n >= first; n--) { const value = rounded(n); if (value >= axis.min && value <= axis.max) axis.ticks.push({ value, y: axisY(value, axis) }); }
  return axis;
}
