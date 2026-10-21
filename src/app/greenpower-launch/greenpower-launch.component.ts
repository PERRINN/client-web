import { DOCUMENT } from '@angular/common';
import { Component, Inject, OnDestroy } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { GREENPOWER_LINKS, GREENPOWER_PHOTOS, GREENPOWER_PAGE, GREENPOWER_META } from './greenpowerContent';

@Component({
  selector: 'app-greenpower-launch',
  standalone: false,
  templateUrl: './greenpower-launch.component.html',
  styleUrls: ['./greenpower-launch.component.css']
})
export class GreenpowerLaunchComponent implements OnDestroy {
  readonly links = GREENPOWER_LINKS;
  readonly photos = GREENPOWER_PHOTOS;
  private previousTitle: string;
  private previousMeta: { selector: string; content: string | null }[] = [];

  constructor(private title: Title, private meta: Meta, @Inject(DOCUMENT) document: Document) {
    const pageDefaults = document.getElementById('greenpower-page-defaults');
    const defaults: { title: string; meta: Record<string, string | null> } | null = pageDefaults ? JSON.parse(pageDefaults.textContent || 'null') : null;
    this.previousTitle = defaults?.title ?? title.getTitle();
    title.setTitle(GREENPOWER_PAGE.title);
    for (const tag of GREENPOWER_META) {
      const selector = tag.name ? `name="${tag.name}"` : `property="${tag.property}"`;
      this.previousMeta.push({ selector, content: defaults ? defaults.meta[selector] ?? null : meta.getTag(selector)?.content ?? null });
      meta.updateTag(tag, selector);
    }
    document.getElementById('main_container')?.scrollTo(0, 0);
  }

  ngOnDestroy() {
    this.title.setTitle(this.previousTitle);
    for (const previous of this.previousMeta) {
      if (previous.content === null) this.meta.removeTag(previous.selector);
      else {
        const tag = this.meta.getTag(previous.selector);
        if (tag) tag.content = previous.content;
      }
    }
  }
}
