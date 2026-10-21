import { displayValue, GreenpowerChannel, LAP_METRICS, POWER } from './greenpowerData';
import { timeAverage } from './greenpowerGps';
import type { GpsLap } from './greenpowerGps';

/** Completed lap summaries reuse the same session boundaries and averages as Lap list. */
export function lapMetricChannels(laps: GpsLap[], channels: GreenpowerChannel[] = []): GreenpowerChannel[] {
  const completed = laps.filter(lap => lap.complete && lap.end > lap.time);
  const power = channels.find(channel => channel.id === POWER)?.points ?? [];
  const metrics = [
    { id: 'computed:lap-time', value: (lap: GpsLap) => (lap.end - lap.time) / 1000 },
    { id: 'computed:lap-average-speed', value: (lap: GpsLap) => lap.speed },
    { id: 'computed:lap-average-amps', value: (lap: GpsLap) => lap.current },
    { id: 'computed:lap-average-power', value: (lap: GpsLap) => timeAverage(power, lap.time, lap.end) }
  ];
  return metrics.map(metric => {
    const points = completed.flatMap(lap => {
      const value = metric.value(lap);
      return value !== undefined && Number.isFinite(value) ? [{ time: lap.end, value }] : [];
    });
    return { id: metric.id, ...LAP_METRICS[metric.id], points,
      value: points.length ? displayValue(points.at(-1)!.value) : '—' };
  });
}
