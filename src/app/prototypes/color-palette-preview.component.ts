import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

type Palette = {
  id: string;
  name: string;
  direction: string;
  description: string;
  colors: { label: string; value: string }[];
  theme: Record<string, string>;
};

@Component({
  selector: 'prototype-color-palette-preview',
  templateUrl: './color-palette-preview.component.html',
  styleUrls: ['./color-palette-preview.component.css'],
  standalone: false
})
export class ColorPalettePreviewComponent {
  readonly palettes: Palette[] = [
    {
      id: 'CLEAR-SLATE',
      name: 'Clear slate',
      direction: 'Cool slate · blue action',
      description: 'A familiar neutral foundation with brighter text, stronger panel separation, and a confident blue action colour.',
      colors: [
        { label: 'Page', value: '#111827' }, { label: 'Surface', value: '#1F2937' },
        { label: 'Raised', value: '#293548' }, { label: 'Text', value: '#F8FAFC' },
        { label: 'Secondary', value: '#CBD5E1' }, { label: 'Accent', value: '#78A9FF' }
      ],
      theme: { '--page': '#111827', '--surface': '#1F2937', '--raised': '#293548', '--border': '#46566A', '--text': '#F8FAFC', '--secondary': '#CBD5E1', '--muted': '#A8B4C5', '--accent': '#78A9FF', '--accent-ink': '#101A2B', '--selected': '#233A57' }
    },
    {
      id: 'WARM-GRAPHITE',
      name: 'Warm graphite',
      direction: 'Warm charcoal · amber action',
      description: 'A softer charcoal base and warm ivory typography give the member space a more welcoming feel while keeping controls distinct.',
      colors: [
        { label: 'Page', value: '#191716' }, { label: 'Surface', value: '#262321' },
        { label: 'Raised', value: '#332E2A' }, { label: 'Text', value: '#FFFAF2' },
        { label: 'Secondary', value: '#E2D8CC' }, { label: 'Accent', value: '#F3AD72' }
      ],
      theme: { '--page': '#191716', '--surface': '#262321', '--raised': '#332E2A', '--border': '#514941', '--text': '#FFFAF2', '--secondary': '#E2D8CC', '--muted': '#C5B9AC', '--accent': '#F3AD72', '--accent-ink': '#25180D', '--selected': '#403126' }
    },
    {
      id: 'DEEP-TIDE',
      name: 'Deep tide',
      direction: 'Blue-green · mint action',
      description: 'A deep blue-green neutral adds a distinct identity, balanced by clean white text and a restrained mint accent.',
      colors: [
        { label: 'Page', value: '#0D1920' }, { label: 'Surface', value: '#162630' },
        { label: 'Raised', value: '#203641' }, { label: 'Text', value: '#F3FAFC' },
        { label: 'Secondary', value: '#C8D9DE' }, { label: 'Accent', value: '#74D9C2' }
      ],
      theme: { '--page': '#0D1920', '--surface': '#162630', '--raised': '#203641', '--border': '#3D5862', '--text': '#F3FAFC', '--secondary': '#C8D9DE', '--muted': '#A9BEC5', '--accent': '#74D9C2', '--accent-ink': '#10231F', '--selected': '#203B3C' }
    },
    {
      id: 'QUIET-PLUM',
      name: 'Quiet plum',
      direction: 'Smoky plum · lavender action',
      description: 'A muted violet-charcoal foundation with soft lavender actions gives the member space a considered, creative tone.',
      colors: [
        { label: 'Page', value: '#1B1720' }, { label: 'Surface', value: '#28222F' },
        { label: 'Raised', value: '#373041' }, { label: 'Text', value: '#F8F5FA' },
        { label: 'Secondary', value: '#D4CBDD' }, { label: 'Accent', value: '#C2A7F2' }
      ],
      theme: { '--page': '#1B1720', '--surface': '#28222F', '--raised': '#373041', '--border': '#554A61', '--text': '#F8F5FA', '--secondary': '#D4CBDD', '--muted': '#B8AFC2', '--accent': '#C2A7F2', '--accent-ink': '#241B30', '--selected': '#3B3048' }
    },
    {
      id: 'CLAY-EMBER',
      name: 'Clay & ember',
      direction: 'Earth charcoal · coral action',
      description: 'A grounded charcoal with warm stone text and a softened coral accent brings warmth without brightening the whole interface.',
      colors: [
        { label: 'Page', value: '#1D1918' }, { label: 'Surface', value: '#2B2422' },
        { label: 'Raised', value: '#3B302D' }, { label: 'Text', value: '#FAF5F2' },
        { label: 'Secondary', value: '#DED0C9' }, { label: 'Accent', value: '#E9957D' }
      ],
      theme: { '--page': '#1D1918', '--surface': '#2B2422', '--raised': '#3B302D', '--border': '#5A4842', '--text': '#FAF5F2', '--secondary': '#DED0C9', '--muted': '#BFAFA8', '--accent': '#E9957D', '--accent-ink': '#2B1B17', '--selected': '#46332F' }
    },
    {
      id: 'NIGHT-SIGNAL',
      name: 'Night signal',
      direction: 'Ink navy · soft gold action',
      description: 'A deep ink-blue base paired with balanced cool text and a muted gold accent feels focused and assured.',
      colors: [
        { label: 'Page', value: '#121923' }, { label: 'Surface', value: '#1D2835' },
        { label: 'Raised', value: '#2A3745' }, { label: 'Text', value: '#F4F6F8' },
        { label: 'Secondary', value: '#CBD4DE' }, { label: 'Accent', value: '#E5C477' }
      ],
      theme: { '--page': '#121923', '--surface': '#1D2835', '--raised': '#2A3745', '--border': '#435263', '--text': '#F4F6F8', '--secondary': '#CBD4DE', '--muted': '#AAB7C5', '--accent': '#E5C477', '--accent-ink': '#2A2417', '--selected': '#34404A' }
    }
  ];

  palette = this.palettes[0];

  constructor(route: ActivatedRoute) {
    route.data.subscribe(({ paletteId }) => {
      this.palette = this.palettes.find(option => option.id === paletteId) ?? this.palettes[0];
    });
  }

  get previousPalette(): Palette {
    return this.palettes[(this.palettes.indexOf(this.palette) + this.palettes.length - 1) % this.palettes.length];
  }

  get nextPalette(): Palette {
    return this.palettes[(this.palettes.indexOf(this.palette) + 1) % this.palettes.length];
  }
}
