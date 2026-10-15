// Display order is independent of recording order; all reads retain their original channel index.
export const engineeringGroups: {label:string; channels:[string,string][]}[] = [
  {label:'Session & trajectory',channels:[['LapDistance','Lap distance'],['Speed','Speed'],['AutopilotDistanceError','Distance error to trajectory'],['PositionY','Altitude']]},
  {label:'Driver inputs',channels:[['Throttle','Throttle'],['Brake','Brake'],['SteeringAngle','Steering angle']]},
  {label:'Vehicle dynamics',channels:[['UndersteerAngle','Understeer angle'],['AccelerationLong','Longitudinal acceleration'],['AccelerationLat','Lateral acceleration'],['AccelerationVert','Vertical acceleration']]},
  {label:'Chassis',channels:[['RideHeightFront','Front ride height'],['RideHeightRear','Rear ride height'],['AeroRoll','Chassis roll angle']]},
  {label:'Tire loads',channels:[['WheelLoadFL','Front left tire vertical force'],['WheelLoadFR','Front right tire vertical force'],['WheelLoadRL','Rear left tire vertical force'],['WheelLoadRR','Rear right tire vertical force']]},
  {label:'Powertrain',channels:[['RpmDiffFront','Front wheel speed difference · L − R'],['RpmDiffRear','Rear wheel speed difference · L − R'],['MotorRpmFront','Front motor speed'],['MotorRpmRear','Rear motor speed'],['ElectricalPowerFront','Front electrical power'],['ElectricalPowerRear','Rear electrical power'],['ElectricalPowerTotal','Total electrical power'],['PowerBalanceDelivered','Electrical power balance · front / total'],['WheelTorqueBalance','Wheel torque balance · front / total']]},
  {label:'Aerodynamics',channels:[['AeroFrontFlap','Flap angle'],['AeroDrsPosition','DRS'],['AeroScx','Drag coefficient · SCx'],['AeroSczFront','Front downforce coefficient · SCz'],['AeroSczRear','Rear downforce coefficient · SCz'],['AeroBalance','Aero balance · front / total']]}
];
export const chartChannels: [string,string][] = engineeringGroups.flatMap(group=>group.channels);
export function chartGroups(channels:{id:string}[]) {
  const visible=chartIndices(channels), known=new Set(chartChannels.map(([id])=>id));
  const groups=engineeringGroups.map(group=>({label:group.label,indices:visible.filter(i=>group.channels.some(([id])=>id===channels[i].id))}))
    .filter(group=>group.indices.length || channels.length && group.label==='Session & trajectory');
  const other=visible.filter(i=>!known.has(channels[i].id));
  if (other.length) groups.push({label:'Other channels',indices:other});
  return groups;
}
export function chartIndices(channels: {id: string}[]) {
  const order = new Map(chartChannels.map(([id], i) => [id, i]));
  return channels.flatMap((channel, i) => ['PositionX', 'PositionZ', 'LapTrigger', 'SectorTrigger', 'SectorIndex', 'SectorTime', 'SectorValid', 'LapTime', 'LapValid', 'LapCompleteTrigger'].includes(channel.id) ? [] : [i])
    .sort((a, b) => (order.get(channels[a].id) ?? chartChannels.length) - (order.get(channels[b].id) ?? chartChannels.length));
}
export function channelName(id: string) { return chartChannels.find(channel => channel[0] === id)?.[1] ?? id; }

const balanceRange = { min: 0, max: 100 };
const percentChannels = new Set(['PowerBalanceDelivered', 'WheelTorqueBalance', 'AeroBalance', 'AeroDrsPosition']);
export function fixedChartRange(id: string) { return id === 'AutopilotDistanceError' ? { min: -50, max: 50 } : percentChannels.has(id) ? balanceRange : undefined; }
