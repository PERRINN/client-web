import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
function load(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, name => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  });
  return exports;
}
const model = load('../src/app/prototypes/rear-wing-pilot/rearWingBrief.ts');
const { rearWingBrief: brief, strengthLoads } = model;
const { machineBrief, markdownBrief } = load('../src/app/prototypes/rear-wing-pilot/rearWingExport.service.ts', {
  '@angular/core': { Injectable: () => target => target }, './rearWingBrief': model
});

test('strength sizing applies the safety factor; deflection remains tied to working loads', () => {
  assert.deepEqual(strengthLoads(), { verticalKn: 18, dragKn: 4.5 });
  assert.equal(brief.loads.tipDeflection.loadBasis, 'Working loads: 12 kN vertical and 3 kN drag');
  assert.equal(brief.loads.tipDeflection.status, 'Provisional');
  assert.equal(brief.drs.sizingStatus, 'Provisional');
});
test('structured handoff retains constraints, preliminary dimensions and unresolved permissions', () => {
  const data = JSON.parse(machineBrief());
  assert.equal(data.targets.completeAssemblyMassKg, 16);
  assert.equal(data.targets.productionQuantity, 1);
  assert.equal(data.targets.toolingCostSeparate, true);
  assert.equal(data.drs.nominalPressureBar, 8);
  assert.equal(data.drs.maxPressureBar, 10);
  assert.deepEqual(data.drs.pistonDiameterMm, { min: 40, max: 45 });
  assert.equal(data.drs.strokeMm, 40);
  assert.equal(data.cad.publicLink, true);
  assert.deepEqual(data.cad.drsPositions, ['closed', 'open']);
  assert.equal(data.cad.accurateDrsKinematics, true);
  assert.equal(data.chassisAttachment.fastenerCount, 6);
  assert.equal(data.fasteners.grade, 'Aeronautic grade');
  assert.equal(data.fasteners.includeAllInFinalAssembly, true);
  assert.deepEqual(data.drs.valveSystem, { positions: 2, commands: ['ON', 'OFF'], positionControlRequired: false, feedbackSensorRequired: false });
  assert.equal(data.drs.customActuatorAndValveHousing, 'Permitted and expected');
  assert.equal(data.cad.fixedRevision, null);
  assert.equal(data.cad.sourceRevisionDate, null);
  assert.equal(data.cad.anonymousExportVerified, false);
  assert.deepEqual(data.cad.formatsVerified, []);
  assert.ok(data.cad.url.endsWith('/e/4ebf37e22faa2c8c19677895'));
  assert.match(data.loads.coordinates, /direction is not yet confirmed/);
  assert.match(data.cad.reuse, /formal CAD licence.*remain to be confirmed/);
  assert.match(data.cad.publication, /approval before sharing any additional unpublished/);
  assert.match(data.sections.find(s => s.id === 'open-decisions').items.find(i => i.id === 'fail-safe').detail, /Do not assume/);
});
test('Markdown and JSON carry the same full engineering scope without editing-workflow content', () => {
  const markdown = markdownBrief();
  const machine = machineBrief();
  assert.ok(markdown.includes(brief.objective));
  assert.ok(markdown.includes(brief.cad.url));
  for (const section of brief.sections) {
    assert.ok(markdown.includes(section.title));
    for (const item of section.items) {
      assert.ok(markdown.includes(item.detail));
      assert.ok(machine.includes(item.id));
    }
  }
  assert.match(markdown, /\| Vertical \| 12 kN \| 18 kN \|/);
  assert.match(markdown, /\| Drag \| 3 kN \| 4.5 kN \|/);
  assert.doesNotMatch(markdown + machine, /interview|localStorage|revision history/i);
});
