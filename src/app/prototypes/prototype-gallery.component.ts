import { Component } from '@angular/core';

@Component({
  selector: 'prototyping',
  templateUrl: './prototype-gallery.component.html',
  styleUrls: ['./prototype-gallery.component.css'],
  standalone: false
})
export class PrototypeGalleryComponent {
  readonly prototypes = [
    { name: 'dil-sensitivity-analysis', category: 'engineering', type: 'DIL analysis', description: 'Trace the 424 replay workflow and compare synthetic setup sensitivities through individual corners.', route: '/prototypes/dil-sensitivity-analysis' },
    {
      name: 'app-wiring',
      category: 'architecture',
      type: 'System map',
      description: 'Trace the Angular client through Firebase services and Cloud Functions.',
      route: '/prototypes/app-wiring'
    },
    {
      name: 'data-model-map',
      category: 'architecture',
      type: 'Data model',
      description: 'See how shared message records, read cursors, images and payment documents relate.',
      route: '/prototypes/data-model-map'
    },
    {
      name: 'workflow-map',
      category: 'architecture',
      type: 'Workflows',
      description: 'Follow message, image upload and PRN purchase flows across client and server.',
      route: '/prototypes/workflow-map'
    },
    {
      name: 'chat-input-bar',
      category: 'inputs',
      type: 'Chat input',
      description: 'A bottom-pinned message composer with image paste, file selection, preview, and local sending.',
      route: '/prototypes/chat-input-bar'
    },
    { name: 'editorial-mosaic', category: 'mosaics', type: 'Editorial mosaic', description: 'One broad lead image anchors a compact supporting grid.', route: '/prototypes/editorial-mosaic' },
    { name: 'balanced-grid', category: 'mosaics', type: 'Balanced grid', description: 'A regular image grid adapts its column count to the available width.', route: '/prototypes/balanced-grid' },
    { name: 'masonry-flow', category: 'mosaics', type: 'Masonry flow', description: 'Images keep varied heights in a responsive column flow.', route: '/prototypes/masonry-flow' },
    { name: 'panorama-rail', category: 'mosaics', type: 'Panorama rail', description: 'A wide feature image leads into a compact six-column image field.', route: '/prototypes/panorama-rail' },
    { name: 'staggered-collage', category: 'mosaics', type: 'Staggered collage', description: 'Alternating tile sizes create a denser, varied rhythm.', route: '/prototypes/staggered-collage' },
    {
      name: 'clear-slate',
      category: 'colours',
      type: 'Colour palette · cool slate',
      description: 'A familiar slate base with stronger text contrast and bright blue actions.',
      route: '/prototypes/clear-slate'
    },
    {
      name: 'warm-graphite',
      category: 'colours',
      type: 'Colour palette · warm graphite',
      description: 'Warm charcoal surfaces, ivory text, and a restrained amber accent.',
      route: '/prototypes/warm-graphite'
    },
    {
      name: 'deep-tide',
      category: 'colours',
      type: 'Colour palette · deep tide',
      description: 'A blue-green neutral base with crisp text and a mint accent.',
      route: '/prototypes/deep-tide'
    },
    {
      name: 'quiet-plum',
      category: 'colours',
      type: 'Colour palette · quiet plum',
      description: 'Smoky plum surfaces, soft neutral text, and a lavender accent.',
      route: '/prototypes/quiet-plum'
    },
    {
      name: 'clay-ember',
      category: 'colours',
      type: 'Colour palette · clay & ember',
      description: 'Earthy charcoal surfaces, warm stone text, and a softened coral accent.',
      route: '/prototypes/clay-ember'
    },
    {
      name: 'night-signal',
      category: 'colours',
      type: 'Colour palette · night signal',
      description: 'Ink-blue surfaces, cool neutral text, and a muted gold accent.',
      route: '/prototypes/night-signal'
    }
  ];

  readonly categories = [
    { id: 'engineering', title: '424 engineering', prototypes: this.prototypes.filter(item => item.category === 'engineering') },
    { id: 'architecture', title: 'Architecture maps', prototypes: this.prototypes.filter(item => item.category === 'architecture') },
    { id: 'inputs', title: 'Inputs', prototypes: this.prototypes.filter(item => item.category === 'inputs') },
    { id: 'mosaics', title: 'Mosaics', prototypes: this.prototypes.filter(item => item.category === 'mosaics') },
    { id: 'colours', title: 'Colour palettes', prototypes: this.prototypes.filter(item => item.category === 'colours') }
  ];
}
