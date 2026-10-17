import { Injectable } from '@angular/core';
import { rearWingBrief as brief, strengthLoads } from './rearWingBrief';

export function machineBrief(): string {
  return JSON.stringify({ schemaVersion: 1, ...brief, derivedStrengthLoads: strengthLoads() }, null, 2);
}
export function markdownBrief(): string {
  const { loads, drs, cad, targets } = brief;
  const strength = strengthLoads();
  return `# ${brief.title}\n\nPrepared for ${brief.recipient}\nIssued: ${brief.issued}\n\n${brief.objective}\n\n${brief.releaseNote}\n\n`
    + `## CAD baseline\n\n[${cad.document} — ${cad.assembly}](${cad.url})\n\n${cad.access}\n\n${cad.export}\n\n`
    + `## Design targets\n\n- Complete assembly mass: ${targets.completeAssemblyMassKg} kg; lower preferred.\n- Production quantity: ${targets.productionQuantity} complete assembly; tooling cost separate.\n- Provisional wing-tip deflection: ${loads.tipDeflection.minMm}–${loads.tipDeflection.maxMm} mm at working loads.\n\n`
    + `## Loads and stiffness\n\n${loads.condition}\n\n| Load | Working | Strength sizing (×${loads.strengthSafetyFactor}) |\n| --- | --- | --- |\n| Vertical | ${loads.working.verticalKn} kN | ${strength.verticalKn} kN |\n| Drag | ${loads.working.dragKn} kN | ${strength.dragKn} kN |\n\n${loads.application}\n\n${loads.coordinates}\n\n${loads.priority}\n\n`
    + `## Pneumatic DRS sizing\n\n${drs.selection}\n\n- Nominal pressure: ${drs.nominalPressureBar} bar (provisional).\n- Pressure up to ${drs.maxPressureBar} bar permitted if needed.\n- Piston diameter per actuator: ${drs.pistonDiameterMm.min}–${drs.pistonDiameterMm.max} mm (provisional).\n- Stroke: approximately ${drs.strokeMm} mm (provisional).\n\n`
    + brief.sections.map(section => `## ${section.title}\n\n` + section.items.map(item => `- **${item.label}${item.status ? ` [${item.status}]` : ''}:** ${item.detail}`).join('\n')).join('\n\n')
    + `\n\n## Reuse and public demonstration\n\n${cad.reuse}\n\n${cad.publication}\n`;
}
@Injectable()
export class RearWingExportService {
  download(kind: 'markdown' | 'json'): void {
    const json = kind === 'json';
    const url = URL.createObjectURL(new Blob([json ? machineBrief() : markdownBrief()], { type: json ? 'application/json' : 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `424-rear-wing-brief.${json ? 'json' : 'md'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
