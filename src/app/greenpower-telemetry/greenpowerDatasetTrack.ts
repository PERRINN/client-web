export interface DatasetTrack { trackId: string | null; revision: number; updatedBy: string; }
export interface DatasetTrackWrite {
  day: string; trackId: string | null; revision: number;
  current: () => boolean; acknowledged: () => void;
}
export function datasetTrackPath(day: string) { return `GreenpowerTelemetry/424/days/${day}/config/track`; }
export function validTrackId(id: unknown): id is string | null {
  return id === null || typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('/');
}
export function validDatasetTrack(value: unknown): value is DatasetTrack {
  const selection = value as DatasetTrack;
  return !!selection && validTrackId(selection.trackId) && Number.isSafeInteger(selection.revision) && selection.revision > 0 && typeof selection.updatedBy === 'string';
}
