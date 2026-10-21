export interface GreenpowerPhoto {
  name: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}

export const GREENPOWER_LINKS = {
  home: '/home',
  telemetry: '/424-greenpower-telemetry',
  retrospective: 'https://discover.perrinn.com/424/424-greenpower',
  whatsapp: 'https://chat.whatsapp.com/CzUNIrzBBuiI6lOCnh9DRx'
} as const;

export const GREENPOWER_PHOTOS: Record<string, GreenpowerPhoto> = {
  "racing": {
    "name": "racing",
    "width": 1152,
    "height": 928,
    "alt": "Baby 424 racing on track, with its driver seated in the carbon-bodied car.",
    "caption": "Baby 424 on track during the 2026 programme."
  },
  "chassis-design": {
    "name": "chassis-design",
    "width": 1143,
    "height": 643,
    "alt": "CAD view showing the Greenpower chassis, body panels and driver packaging.",
    "caption": "The existing design: a starting point for the next round of development."
  },
  "workshop": {
    "name": "workshop",
    "width": 1536,
    "height": 2048,
    "alt": "Front view of Baby 424 on its workshop support stand.",
    "caption": "From design to a complete car: workshop preparation in 2026."
  },
  "assembly": {
    "name": "assembly",
    "width": 785,
    "height": 769,
    "alt": "Contributors working around the open cockpit of Baby 424.",
    "caption": "Hands-on preparation around the car’s cockpit."
  },
  "midlands-race": {
    "name": "midlands-race",
    "width": 884,
    "height": 302,
    "alt": "Recorded total and left/right battery voltage charts during the 2026 Midlands Heat race, with lap bands and race-time axes.",
    "caption": "Midlands Heat · 24 September 2026. Recorded battery voltage through the race window."
  },
  "paddock": {
    "name": "paddock",
    "width": 1600,
    "height": 1203,
    "alt": "Side view of the black Baby 424 racing car in the paddock.",
    "caption": "The 2026 car, ready for another track session."
  },
  "team": {
    "name": "team",
    "width": 1200,
    "height": 1600,
    "alt": "Greenpower team members standing together beside a race circuit.",
    "caption": "The people behind the car: engineering becomes a shared effort."
  },
  "structure": {
    "name": "structure",
    "width": 800,
    "height": 586,
    "alt": "CAD view of the Greenpower car’s lightweight chassis structure.",
    "caption": "Chassis design: reduce mass while preserving the structure we need."
  }
};

export const GREENPOWER_PAGE = {
  title: '424 Greenpower 2027 · An open invitation · PERRINN',
  description: 'An open letter from Nico Perrin: help develop Baby 424 for the 2027 Greenpower season, from engineering and manufacturing to testing and racing.',
  url: 'https://perrinn.com/424-greenpower-2027',
  image: 'https://perrinn.com/assets/greenpower-2027/racing-1600.webp'
} as const;

export const GREENPOWER_META = [
  { name: 'description', content: GREENPOWER_PAGE.description },
  { property: 'og:title', content: GREENPOWER_PAGE.title },
  { property: 'og:description', content: GREENPOWER_PAGE.description },
  { property: 'og:type', content: 'article' },
  { property: 'og:url', content: GREENPOWER_PAGE.url },
  { property: 'og:image', content: GREENPOWER_PAGE.image },
  { name: 'twitter:card', content: 'summary_large_image' }
];
