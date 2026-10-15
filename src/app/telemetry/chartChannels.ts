// Display order is independent of recording order; all reads retain their original channel index.
export const chartChannels: [string, string][] = [
  ['LapDistance', 'Lap distance'], ['AutopilotDistanceError', 'Distance error to trajectory'], ['Speed', 'Speed'], ['Throttle', 'Throttle'], ['Brake', 'Brake'], ['SteeringAngle', 'Steering angle'], ['UndersteerAngle', 'Understeer angle'],
  ['AccelerationLong', 'Longitudinal acceleration'], ['AccelerationLat', 'Lateral acceleration'], ['AccelerationVert', 'Vertical acceleration'],
  ['RideHeightFront', 'Front ride height'], ['RideHeightRear', 'Rear ride height'], ['AeroRoll', 'Chassis roll angle'],
  ['WheelLoadFL', 'Front left tire vertical force'], ['WheelLoadFR', 'Front right tire vertical force'],
  ['WheelLoadRL', 'Rear left tire vertical force'], ['WheelLoadRR', 'Rear right tire vertical force'],
  ['RpmDiffFront', 'Front wheel speed difference · L − R'], ['RpmDiffRear', 'Rear wheel speed difference · L − R'],
  ['MotorRpmFront', 'Front motor speed'], ['MotorRpmRear', 'Rear motor speed'],
  ['ElectricalPowerFront', 'Front electrical power'], ['ElectricalPowerRear', 'Rear electrical power'], ['ElectricalPowerTotal', 'Total electrical power'],
  ['PowerBalanceDelivered', 'Electrical power balance · front / total'], ['WheelTorqueBalance', 'Wheel torque balance · front / total'],
  ['AeroScx', 'Drag coefficient · SCx'], ['AeroSczFront', 'Front downforce coefficient · SCz'], ['AeroSczRear', 'Rear downforce coefficient · SCz'], ['AeroBalance', 'Aero balance · front / total'],
  ['PositionY', 'Altitude']
];
export function chartIndices(channels: {id: string}[]) {
  const order = new Map(chartChannels.map(([id], i) => [id, i]));
  return channels.flatMap((channel, i) => ['PositionX', 'PositionZ', 'LapTrigger', 'SectorTrigger', 'SectorIndex', 'SectorTime', 'SectorValid', 'LapTime', 'LapValid', 'LapCompleteTrigger'].includes(channel.id) ? [] : [i])
    .sort((a, b) => (order.get(channels[a].id) ?? chartChannels.length) - (order.get(channels[b].id) ?? chartChannels.length));
}
export function channelName(id: string) { return chartChannels.find(channel => channel[0] === id)?.[1] ?? id; }

const balanceRange = { min: 0, max: 100 };
const balanceChannels = new Set(['PowerBalanceDelivered', 'WheelTorqueBalance', 'AeroBalance']);
export function fixedChartRange(id: string) { return balanceChannels.has(id) ? balanceRange : undefined; }
