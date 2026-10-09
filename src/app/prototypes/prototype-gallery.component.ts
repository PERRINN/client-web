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
      name: 'chat-input-bar',
      category: 'inputs',
      type: 'Chat input',
      description: 'A bottom-pinned message composer with image paste, file selection, preview, and local sending.',
      route: '/prototypes/chat-input-bar'
    },
    {
      name: 'member-text-field',
      category: 'inputs',
      type: 'Text input',
      description: 'A labeled text field with helper text, a character count, and a clear action.',
      route: '/prototypes/member-text-field'
    },
    {
      name: 'classic-social-feed',
      category: 'layouts',
      type: 'Classic social feed',
      description: 'A familiar three-column community feed with member navigation and upcoming events.',
      route: '/prototypes/classic-social-feed'
    },
    {
      name: 'community-dashboard',
      category: 'layouts',
      type: 'Community dashboard',
      description: 'A member home that brings updates, conversations, events, and community activity together.',
      route: '/prototypes/community-dashboard'
    },
    {
      name: 'mobile-first-social',
      category: 'layouts',
      type: 'Mobile-first social',
      description: 'A compact, thumb-friendly social stream that expands into a desktop community workspace.',
      route: '/prototypes/mobile-first-social'
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
    { id: 'inputs', title: 'Inputs', description: 'Fields and form interactions', prototypes: this.prototypes.filter(item => item.category === 'inputs') },
    { id: 'layouts', title: 'Layouts', description: 'Ways to arrange community content', prototypes: this.prototypes.filter(item => item.category === 'layouts') },
    { id: 'colours', title: 'Colour palettes', description: 'Surface, text, and accent combinations', prototypes: this.prototypes.filter(item => item.category === 'colours') }
  ];
}
