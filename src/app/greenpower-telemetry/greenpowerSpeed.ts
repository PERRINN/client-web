import { DayMetadata, wheelCircumference } from './greenpowerDay';
import { channelDetails, displayValue, GreenpowerChannel, isVehicleSpeed, MOTOR_DERIVED_SPEED, pointIndex, VEHICLE_SPEED } from './greenpowerData';

/** Compare motor RPM with recorded speed without changing raw channels or lap averages. */
export function withMotorDerivedSpeed(channels: GreenpowerChannel[], event?: DayMetadata, latestTime?: number): GreenpowerChannel[] {
  const motor = channels.find(channel => channel.id === '["RPM"]:rpm');
  if (!motor) return channels;
  const gear = channels.find(channel => channel.id.startsWith('["Gear"]:'));
  const circumference = event && wheelCircumference(event);
  const speed = (rpm: number, time: number) => {
    const ratioPoints = gear?.points ?? [];
    const ratio = time >= (ratioPoints[0]?.time ?? Infinity) && time <= (ratioPoints.at(-1)?.time ?? -Infinity)
      ? ratioPoints[pointIndex(ratioPoints, time, true) - 1]?.value : undefined;
    if (!circumference || !Number.isFinite(circumference) || circumference <= 0 || !ratio || !Number.isFinite(ratio) || ratio <= 0) return undefined;
    const value = rpm / ratio * circumference / 60 / .44704;
    return Number.isFinite(value) ? value : undefined;
  };
  // The saved-gear contract supplies points only when metadata covers the whole recording
  // without ambiguity. Withhold the comparison rather than connecting through unknown gearing.
  const candidates = motor && gear?.points.length ? motor.points.map(point => ({ time: point.time, value: speed(point.value, point.time) })) : [];
  const points = candidates.every(point => point.value !== undefined) ? candidates as { time: number; value: number }[] : [];
  const latest = motor && motor.value !== '—' && latestTime !== undefined ? speed(Number(motor.value), latestTime) : undefined;
  const derived: GreenpowerChannel = { id: MOTOR_DERIVED_SPEED, ...channelDetails(MOTOR_DERIVED_SPEED),
    points, value: latest === undefined ? '—' : displayValue(latest) };
  const result = [...channels.filter(channel => channel.id !== MOTOR_DERIVED_SPEED), derived];
  // Keep the existing Vehicle speed chart identity available on RPM-only recordings.
  if (points.length && !result.some(channel => isVehicleSpeed(channel.id))) {
    result.push({ id: VEHICLE_SPEED, ...channelDetails(VEHICLE_SPEED), points: [], value: '—' });
  }
  return result;
}
