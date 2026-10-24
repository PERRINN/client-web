import { EchookReading } from './echookProtocol';

export interface DashboardMetric {
  id: string; label: string; value?: number; unit: string; status: string;
}

// Same battery mapping and mph conversion as Greenpower telemetry. Serial fields
// arrive individually, so right voltage requires both inputs to be fresh.
export function dashboardMetrics(readings: EchookReading[], connected: boolean, now: number): DashboardMetric[] {
  const find = (id: string) => readings.find(reading => reading.id === id && Number.isFinite(reading.value));
  const speed = find('s'), total = find('v'), left = find('w');
  const metric = (id: string, label: string, unit: string, inputs: (EchookReading | undefined)[], value?: number) => {
    const missing = inputs.some(input => !input);
    const stale = inputs.some(input => input && now - input.at > 5000);
    const status = !connected ? 'Disconnected' : missing ? 'Waiting' : stale ? 'Stale' : 'Live';
    return { id, label, unit, status, value: status === 'Live' && Number.isFinite(value) ? value : undefined };
  };
  return [
    metric('speed', 'Vehicle speed', 'mph', [speed], speed && speed.value / 0.44704),
    metric('left', 'Battery left', 'V', [left], left?.value),
    metric('right', 'Battery right', 'V', [total, left], total && left && total.value - left.value)
  ];
}
