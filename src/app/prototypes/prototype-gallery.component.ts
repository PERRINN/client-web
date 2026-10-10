import { Component } from '@angular/core';

@Component({
  selector: 'prototyping',
  templateUrl: './prototype-gallery.component.html',
  styleUrls: ['./prototype-gallery.component.css'],
  standalone: false
})
export class PrototypeGalleryComponent {
  readonly prototypes = [
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
    {
      name: 'conversation-sidebar',
      category: 'layouts',
      type: 'Chat layout',
      description: 'A chat-first workspace with app links above recent chats.',
      route: '/prototypes/conversation-sidebar'
    },
    {
      name: 'home',
      category: 'layouts',
      type: 'Team dashboard',
      description: 'A live overview of recent images, upcoming events, and recent chat activity.',
      route: '/prototypes/home'
    },
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
    { id: 'architecture', title: 'Architecture maps', prototypes: this.prototypes.filter(item => item.category === 'architecture') },
    { id: 'inputs', title: 'Inputs', prototypes: this.prototypes.filter(item => item.category === 'inputs') },
    { id: 'layouts', title: 'Layouts', prototypes: this.prototypes.filter(item => item.category === 'layouts') },
    { id: 'colours', title: 'Colour palettes', prototypes: this.prototypes.filter(item => item.category === 'colours') }
  ];
}
