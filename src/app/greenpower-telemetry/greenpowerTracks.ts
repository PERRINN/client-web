import { FinishLine, GpsFix, GpsPoint, localPoint, validLine, validPoint, validSegment } from './greenpowerGps';

export interface TrackBounds { south: number; north: number; west: number; east: number; }
export interface TrackDefinition {
  name: string; line: FinishLine | null; bounds: TrackBounds | null; cells: string[]; revision: number; updatedBy: string;
}
export interface TrackChoice extends TrackDefinition { id: string; }
export const TRACKS_PATH = 'GreenpowerTelemetry/424/tracks';
export const TRACK_PAGE_SIZE = 6;
export const MAX_TRACK_PAGES = 10;
const CELL_DEGREES = .05;
export function trackCell(p: GpsPoint) { return `${Math.floor(p.lat / CELL_DEGREES)}:${Math.floor(p.lon / CELL_DEGREES)}`; }
export function contains(bounds: TrackBounds | null, p: GpsPoint) {
  return !!bounds && p.lat >= bounds.south && p.lat <= bounds.north && p.lon >= bounds.west && p.lon <= bounds.east;
}
export function coverageCells(bounds: TrackBounds) {
  const south = Math.floor(bounds.south / CELL_DEGREES), north = Math.floor(bounds.north / CELL_DEGREES);
  const west = Math.floor(bounds.west / CELL_DEGREES), east = Math.floor(bounds.east / CELL_DEGREES);
  const size = (north - south + 1) * (east - west + 1);
  if (!Number.isSafeInteger(size) || size < 1 || size > 64) return [];
  const cells: string[] = [];
  for (let lat = south; lat <= north; lat++) for (let lon = west; lon <= east; lon++) cells.push(`${lat}:${lon}`);
  return cells;
}
export function validBounds(bounds: TrackBounds) {
  if (!bounds || !validPoint({lat: bounds.south, lon: bounds.west}) || !validPoint({lat: bounds.north, lon: bounds.east}) ||
    bounds.south >= bounds.north || bounds.west >= bounds.east) return false;
  const span = localPoint({lat: bounds.north, lon: bounds.east}, {lat: bounds.south, lon: bounds.west});
  return span.x <= 20000 && span.y <= 20000 && coverageCells(bounds).length > 0;
}
export function validTrack(value: unknown): value is TrackDefinition {
  const track = value as TrackDefinition;
  if (!track || typeof track.name !== 'string' || !track.name.trim() || track.name.length > 60 ||
    !(track.line === null || validLine(track.line)) || !Array.isArray(track.cells) ||
    !Number.isSafeInteger(track.revision) || track.revision < 1 || typeof track.updatedBy !== 'string') return false;
  if (track.bounds === null) return track.line === null && track.cells.length === 0;
  if (!validBounds(track.bounds)) return false;
  const cells = coverageCells(track.bounds);
  return cells.length === track.cells.length && cells.every((cell, i) => cell === track.cells[i]) &&
    (!track.line || contains(track.bounds, track.line.a) && contains(track.bounds, track.line.b));
}
/** Three consecutive plausible fixes establish one lookup location, anywhere around the circuit. */
export function lookupAnchor(fixes: GpsFix[]) {
  for (let i = 2; i < fixes.length; i++) if (validSegment(fixes[i - 2], fixes[i - 1]) && validSegment(fixes[i - 1], fixes[i])) return fixes[i - 1];
  return undefined;
}
/** Save the whole loaded circuit with 150 m padding; refuse geographically mixed datasets. */
export function trackCoverage(fixes: GpsFix[], line: FinishLine | null) {
  if (!lookupAnchor(fixes)) return undefined;
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const p of [...fixes, ...(line ? [line.a, line.b] : [])]) {
    south = Math.min(south, p.lat); north = Math.max(north, p.lat); west = Math.min(west, p.lon); east = Math.max(east, p.lon);
  }
  const latPadding = 150 / 111195, lonPadding = latPadding / Math.cos((south + north) / 2 * Math.PI / 180);
  const bounds = { south: south - latPadding, north: north + latPadding, west: west - lonPadding, east: east + lonPadding };
  return validBounds(bounds) ? { bounds, cells: coverageCells(bounds) } : undefined;
}
export function mergedCoverage(bounds: TrackBounds, other: TrackBounds) {
  const combined = { south: Math.min(bounds.south, other.south), north: Math.max(bounds.north, other.north),
    west: Math.min(bounds.west, other.west), east: Math.max(bounds.east, other.east) };
  return validBounds(combined) ? { bounds: combined, cells: coverageCells(combined) } : undefined;
}
export function matchesTrack(track: TrackDefinition, fixes: GpsFix[]) {
  // Do not silently accept recordings from several venues or select disabled definitions.
  const anchor = lookupAnchor(fixes);
  return !!track.bounds && !!track.line && !!anchor && contains(track.bounds, anchor) && fixes.every(fix => contains(track.bounds, fix));
}
