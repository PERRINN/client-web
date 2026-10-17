export interface BriefItem {
  id: string;
  label: string;
  detail: string;
  status?: 'Provisional' | 'TBD';
}
export interface BriefSection {
  id: string;
  title: string;
  items: BriefItem[];
}
export const rearWingBrief = {
  title: '424 rear-wing engineering brief',
  recipient: 'Lewis Valentine · NativeCAD / FeatureBoard',
  issued: '2026-10-17',
  objective: 'Develop the existing conceptual rear-wing CAD into a lightweight assembly ready for manufacture, covering the main plane, two support pillars, flap, end plates, pneumatic DRS mechanism and all fasteners. Deliver detailed CAD, a BOM, mass and indicative cost estimates, supported by first-pass structural assessment.',
  releaseNote: 'The target is a manufacturing-ready design. Final release depends on resolution of open requirements and engineering validation.',
  cad: {
    url: 'https://cad.onshape.com/documents/c8905acd70323eec613f31b0/w/c09f0d62bd4be415f42f5f59/e/4ebf37e22faa2c8c19677895',
    document: 'PERRINN 424 architecture',
    assembly: 'rear wing',
    workspace: 'Main',
    publicLink: true,
    drsPositions: ['closed', 'open'],
    accurateDrsKinematics: true,
    fixedRevision: null,
    sourceRevisionDate: null,
    anonymousViewingVerifiedOn: '2026-10-17',
    observedConfiguration: 'DRS closed',
    anonymousExportVerified: false,
    formatsVerified: [] as string[],
    access: 'The Onshape link is public; anonymous viewing was verified on 17 October 2026. The CAD includes both open and closed DRS positions, and the complete DRS kinematic model is accurate. Preserve that kinematic definition. The Main workspace can change: agree a fixed version and source date before starting.',
    export: 'Anonymous export and available formats remain unverified; no export control was found during the access check. If export requires login, request a public downloadable CAD package. Confirm STEP or Parasolid support before choosing an export format.',
    reuse: 'Nico intends PERRINN CAD to be openly reusable project CAD and permits Lewis to reuse this pilot work for a public NativeCAD/FeatureBoard demonstration. The formal CAD licence, attribution, derivative and commercial/demo terms remain to be confirmed. Public visibility alone does not establish a licence.',
    publication: 'The requirements in this brief are approved for public use. Obtain Nico’s approval before sharing any additional unpublished inputs.'
  },
  targets: { completeAssemblyMassKg: 16, productionQuantity: 1, toolingCostSeparate: true },
  chassisAttachment: { fastenerCount: 6, locationBasis: 'CAD-defined location intent', pillarMatingFacesDefined: true },
  fasteners: { grade: 'Aeronautic grade', includeAllInFinalAssembly: true },
  loads: {
    condition: 'DRS closed at maximum design speed; speed value TBD.',
    application: '12 kN vertical and 3 kN drag are the combined main-plane and flap loads, evenly distributed over their surfaces. Confirm the split between parts, application areas and vector signs against CAD.',
    working: { verticalKn: 12, dragKn: 3 },
    strengthSafetyFactor: 1.5,
    coordinates: 'Follow Onshape assembly axes; verify the load signs and actuator rotation about Y. Vertical load direction is not yet confirmed.',
    tipDeflection: { minMm: 10, maxMm: 20, status: 'Provisional', loadBasis: 'Working loads: 12 kN vertical and 3 kN drag' },
    priority: 'Prioritise low mass; below 16 kg is preferred. Show the mass-versus-stiffness trade-off and the effects on strength, manufacture and serviceability.'
  },
  drs: {
    selection: 'Lewis selects the actuators and operating pressure. The following dimensions are preliminary sizing references and must be verified against the mechanism and loads.',
    nominalPressureBar: 8,
    maxPressureBar: 10,
    pistonDiameterMm: { min: 40, max: 45 },
    strokeMm: 40,
    sizingStatus: 'Provisional',
    valveSystem: { positions: 2, commands: ['ON', 'OFF'], positionControlRequired: false, feedbackSensorRequired: false },
    customActuatorAndValveHousing: 'Permitted and expected'
  },
  sections: [
    { id: 'geometry', title: 'Geometry & load path', items: [
      { id: 'surfaces', label: 'Preserve the aerodynamic surfaces', detail: 'Retain the external aerodynamic geometry and vehicle mounting points while developing the internal construction and part splits.' },
      { id: 'pivot', label: 'Preserve flap motion', detail: 'The complete CAD DRS kinematic model is accurate and includes open and closed positions. Preserve the mechanism kinematics, pivot axis and both end positions. Cylindrical geometry near the end plates identifies the flap pivot axis.' },
      { id: 'symmetry', label: 'Identical left and right', detail: 'Keep the assembly symmetric, with identical left/right pillar assemblies and DRS mechanisms.' },
      { id: 'load-path', label: 'Two-pillar load path', detail: 'All rear-wing loads transfer to the vehicle through the two support pillars.' },
      { id: 'chassis-interface', label: 'Preserve the chassis interface', detail: 'The pillars already include their mating faces to the chassis and the location intent for six chassis fasteners in total. Preserve those interfaces and fastener locations; develop the attachment details and include all six fasteners in the final assembly.' }
    ] },
    { id: 'construction', title: 'Composites, inserts & hardware', items: [
      { id: 'composites', label: 'Autoclave-cured carbon-fibre prepreg', detail: 'Use composite construction for the main plane, both pillars, flap and end plates, with aluminium inserts.' },
      { id: 'laminates', label: 'Refine the existing CAD thicknesses', detail: 'Treat the laminate thicknesses already represented in CAD as starting estimates. Refine thicknesses and propose ply schedules, cores and bonded joints through first-pass FEA or engineering calculations.' },
      { id: 'hardware', label: 'Propose materials and joint details for review', detail: 'Use aeronautic-grade fasteners throughout and include all fasteners in the final assembly. Recommend aluminium alloys, fastener specifications, locking methods and galvanic isolation for Nico’s review. Prioritise low weight and serviceability; define insert load transfer, attachment, thread engagement and torque as the design develops.' }
    ] },
    { id: 'mechanism', title: 'DRS integration', items: [
      { id: 'rotation', label: 'Allow actuator rotation about Y', detail: 'Mount each actuator so it can rotate about the Onshape Y axis to follow rocker movement. Verify clearance throughout the preserved flap travel.' },
      { id: 'routing', label: 'Route pneumatic lines inside the pillars', detail: 'Develop internal routing, fittings and accessible connections together with the composite structure and inserts.' },
      { id: 'controls', label: 'Two-position ON/OFF valve system', detail: 'Include a two-position valve system for the pneumatic actuators with ON/OFF commands. Position control and feedback sensors are not required.' },
      { id: 'housing', label: 'Custom actuator and valve housing', detail: 'Custom housing for the pneumatic actuator and valve is permitted and expected. Develop the housing and its integration with the mechanism.' }
    ] },
    { id: 'deliverables', title: 'Required deliverables', items: [
      { id: 'assembly', label: 'Detailed assembly and parts', detail: 'Develop the complete rear-wing assembly, including every fastener, the six chassis fasteners, actuators, valve system and custom housings, with part splits and interfaces. Include manufacturing information for laminate construction, inserts, joints, tolerances, surface finish and assembly sequence.' },
      { id: 'structural', label: 'First-pass structural assessment', detail: 'Provide structural FEA or estimated structural results for strength and stiffness. State material properties, load application, boundary conditions and limitations; assess the two-pillar load path, laminate thicknesses, inserts and bonds.' },
      { id: 'mass', label: 'BOM and mass breakdown', detail: 'List composite parts, inserts, actuators, valves, custom housings, pneumatic lines/fittings and all aeronautic-grade fasteners, with quantities, material specifications and estimated masses. Report complete assembly mass against the 16 kg target and explain lightweighting options.' },
      { id: 'cost', label: 'Indicative cost and manufacturing assessment', detail: 'Estimate the cost of one complete assembly, with tooling itemised separately. Identify manufacturing approach, suppliers where available, assumptions, cost currency and lead times.' },
      { id: 'review', label: 'Engineering handoff', detail: 'Provide the updated CAD baseline, key decisions, mass/stiffness/cost trade-offs, unresolved requirements and recommended validation before manufacture.' }
    ] },
    { id: 'open-decisions', title: 'Open decisions to resolve with Nico', items: [
      { id: 'cad-baseline', label: 'CAD baseline and reuse terms', detail: 'Agree a fixed revision and source date, confirm export access/formats and the formal licence terms.', status: 'TBD' },
      { id: 'load-cases', label: 'Complete load envelope', detail: 'Confirm maximum design speed, vertical direction and signed vectors, per-part load distribution, DRS-open, asymmetric and inertial cases, fatigue life and duty cycles.', status: 'TBD' },
      { id: 'fail-safe', label: 'DRS fail-safe and operating requirements', detail: 'Agree behaviour on pressure or power loss, actuation time, pneumatic supply and mechanical stops. The two-position ON/OFF control is defined; no position control or feedback sensor is required. Do not assume a fail-safe position.', status: 'TBD' },
      { id: 'stiffness', label: 'Stiffness acceptance', detail: 'Refine the provisional 10–20 mm wing-tip deflection range at working loads and establish any flap twist/clearance limits needed for reliable DRS operation.', status: 'Provisional' },
      { id: 'manufacturing-details', label: 'Manufacturing and procurement details', detail: 'Agree prepreg system, detailed layups, cores, bonding, insert/fastener specifications, tolerances and finish, together with suppliers, budget and delivery date.', status: 'TBD' },
      { id: 'validation', label: 'Validation and release', detail: 'Agree review gates, physical verification/testing, environmental requirements and authority for final release to manufacture.', status: 'TBD' }
    ] }
  ] as BriefSection[]
};

export function strengthLoads() {
  return {
    verticalKn: rearWingBrief.loads.working.verticalKn * rearWingBrief.loads.strengthSafetyFactor,
    dragKn: rearWingBrief.loads.working.dragKn * rearWingBrief.loads.strengthSafetyFactor
  };
}
