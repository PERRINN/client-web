import { AgChartOptions, AgChartTheme } from 'ag-charts-community';
import { ProfileRecord, balanceParts, illustration, milliseconds } from './profileModel';

/** Identical precision/notation for axis labels and hovered values. */
export function profileChartValue(input: number | string): string {
  // AG Charts supplies whole-number axis ticks as strings.
  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value / 1_000_000)}M`;
  if (magnitude >= 1_000) return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value / 1_000)}K`;
  if (magnitude > 0 && magnitude < 0.0001) return value.toExponential(2);
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: magnitude < 1 ? 4 : 2 }).format(value);
}

export function profileChart(record: ProfileRecord, records: ProfileRecord[], forecast: boolean, rate: number, convert: (value: number) => number, currency = 'USD'): AgChartOptions {
  const style = getComputedStyle(document.documentElement), fontFamily = style.fontFamily;
  const colour = (token: string) => style.getPropertyValue(token).trim();
  const text = colour('--color-text-secondary');
  const theme: AgChartTheme = {
    baseTheme: 'ag-default-dark',
    overrides: { common: {
      title: { fontFamily },
      legend: { item: { label: { fontFamily, color: text, fontSize: 14 } } },
      axes: {
        number: { label: { fontFamily, color: text, fontSize: 14 }, title: { fontFamily, color: text, fontSize: 14 } },
        time: { label: { fontFamily, color: text, fontSize: 14 }, title: { fontFamily, color: text, fontSize: 14 } }
      }
    } }
  };
  const series = forecast ? [{ key: 'balance', label: 'Balance', colour: '--color-accent' }] : [
    { key: 'balance', label: 'Balance', colour: '--color-accent' },
    { key: 'purchase', label: 'Funding credits', colour: '--color-data-comparison' },
    { key: 'transaction', label: 'Transfers', colour: '--color-text' },
    { key: 'interest', label: 'Balance adjustments', colour: '--color-border' },
    { key: 'contract', label: 'Time credits', colour: '--color-text-muted' }
  ];
  const data = forecast ? illustration(record, rate).map(row => ({ ...row, balance: convert(row.balance) }))
    : [...records].reverse().map(item => Object.fromEntries([
      ['timestamp', milliseconds(item.verifiedTimestamp || item.serverTimestamp)],
      ...Object.entries(balanceParts(item)).map(([key, value]) => [key, convert(value)])
    ]));
  const unit = /^[A-Z]{3}$/.test(currency) ? currency : 'Value';
  return {
    theme, data, background: { fill: colour('--color-surface') },
    padding: { top: 16, right: 32, bottom: 8, left: 8 },
    legend: {
      enabled: !forecast, position: 'bottom', spacing: 20, maxHeight: 160,
      item: { showSeriesStroke: true, line: { length: 20, strokeWidth: 2 }, marker: { size: 0 }, paddingX: 16, paddingY: 8 }
    },
    series: series.map(({ key, label, colour: token }) => ({
      type: 'line', xKey: forecast ? 'year' : 'timestamp', yKey: key, yName: label,
      stroke: colour(token), strokeWidth: 2, lineDash: [],
      marker: { enabled: false, size: 0, fill: colour(token), stroke: colour(token) },
      tooltip: { renderer: ({ datum, xKey, yKey }) => ({
        title: label,
        content: `${forecast ? 'Year ' + datum[xKey] : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(datum[xKey])}: ${profileChartValue(datum[yKey])} ${unit}`
      }) }
    })),
    axes: [
      { type: forecast ? 'number' : 'time', position: 'bottom', gridLine: { enabled: false },
        line: { color: colour('--color-border'), width: 1 }, tick: { size: 4, color: colour('--color-border') },
        ...(forecast ? { title: { text: 'Year' } } : { label: { format: '%d %b', minSpacing: 16 } }) },
      { type: 'number', position: 'left', title: { text: unit }, line: { enabled: false }, tick: { enabled: false },
        gridLine: { enabled: true, width: 1, style: [{ stroke: colour('--color-raised'), lineDash: [] }] },
        label: { formatter: ({ value }) => profileChartValue(value) } }
    ]
  };
}
