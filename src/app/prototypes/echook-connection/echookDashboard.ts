import { EchookReading } from './echookProtocol';

export interface DashboardMetric {
  id: string; label: string; value?: number; unit: string; status: string; digits: string; visibleLabel: boolean;
}

// Same battery mapping and mph conversion as Greenpower telemetry. Serial fields
// arrive individually, so right voltage requires both inputs to be fresh.
export function dashboardMetrics(readings: EchookReading[], connected: boolean, now: number): DashboardMetric[] {
  const find = (id: string) => readings.find(reading => reading.id === id && Number.isFinite(reading.value));
  const speed = find('s'), total = find('v'), left = find('w');
  const throttle = find('t'), motor = find('m'), current = find('i');
  const ambient = find('a'), motorTemperature = find('b');
  const metric = (id: string, label: string, unit: string, inputs: (EchookReading | undefined)[], value?: number) => {
    const missing = inputs.some(input => !input);
    const stale = inputs.some(input => input && now - input.at > 5000);
    const status = !connected ? 'Disconnected' : missing ? 'Waiting' : stale ? 'Stale' : 'Live';
    const digits = id === 'motor' || id === 'throttle' ? '1.0-0' : ['speed', 'current', 'ambient', 'motor-temp'].includes(id) ? '1.1-1' : '1.2-2';
    return { id, label, unit, status, digits, visibleLabel: ['left', 'right', 'throttle', 'ambient', 'motor-temp'].includes(id), value: status === 'Live' && Number.isFinite(value) ? value : undefined };
  };
  return [
    metric('speed', 'Vehicle speed', 'mph', [speed], speed && speed.value / 0.44704),
    metric('left', 'Left', 'V', [left], left?.value),
    metric('right', 'Right', 'V', [total, left], total && left && total.value - left.value),
    metric('throttle', 'Throttle', '%', [throttle], throttle?.value),
    metric('motor', 'Motor speed', 'rpm', [motor], motor?.value),
    metric('current', 'Current', 'A', [current], current?.value),
    metric('ambient', 'Ambient', '°C', [ambient], ambient?.value),
    metric('motor-temp', 'Motor', '°C', [motorTemperature], motorTemperature?.value)
  ];
}
