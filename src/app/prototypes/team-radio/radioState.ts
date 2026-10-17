export interface RadioSeat { uid: string; name: string }
export interface RadioSpeaker { uid: string; seat: string }
export interface RadioConnection { session: string; online: boolean; at: number; muted: boolean; ready: boolean }
export interface RadioFloor { uid: string; seat: string; session: string; token: string; startedAt: number; expiresAt: number }
export interface RadioRoom {
  seats?: Record<string, RadioSeat>;
  speakers?: Record<string, RadioSpeaker>;
  presence?: Record<string, RadioConnection>;
  floor?: RadioFloor;
}
export const ROOM_PATH = 'teamRadio/team';
export const MAX_TRANSMISSION_MS = 30_000;
export const PRESENCE_TIMEOUT_MS = 20_000;
export function seatFor(room: RadioRoom, uid: string): string | undefined {
  return Object.keys(room.seats || {}).find(key => room.seats[key].uid === uid);
}
export function speakerFor(room: RadioRoom, uid: string): string | undefined {
  return Object.keys(room.speakers || {}).find(key => room.speakers[key].uid === uid);
}
export function connectionFor(room: RadioRoom, seat: string, now: number) {
  const connection = room.presence?.[seat];
  return connection?.online && connection.at > now - PRESENCE_TIMEOUT_MS ? [connection.session, connection] as const : undefined;
}
export function activeFloor(room: RadioRoom, now: number): RadioFloor | undefined {
  const floor = room.floor;
  if (!floor || floor.startedAt > now || floor.expiresAt <= now || floor.expiresAt - floor.startedAt > MAX_TRANSMISSION_MS) return;
  if (room.seats?.[floor.seat]?.uid !== floor.uid || speakerFor(room, floor.uid) === undefined) return;
  const connection = connectionFor(room, floor.seat, now);
  return connection?.[0] === floor.session ? floor : undefined;
}
export function acceptsTalkKey(event: KeyboardEvent, code: string) {
  const target = event.target as HTMLElement;
  return event.code === code && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey
    && !target?.closest?.('input, textarea, select, button, a, [contenteditable="true"]');
}
