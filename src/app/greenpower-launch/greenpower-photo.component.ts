import { Component, Input, OnChanges } from '@angular/core';
import { GreenpowerPhoto } from './greenpowerContent';

@Component({
  selector: 'app-greenpower-photo',
  standalone: false,
  templateUrl: './greenpower-photo.component.html',
  styleUrls: ['./greenpower-photo.component.css']
})
export class GreenpowerPhotoComponent implements OnChanges {
  @Input({ required: true }) photo!: GreenpowerPhoto;
  @Input() eager = false;
  failed = false;

  ngOnChanges() { this.failed = false; }

  get src() { return `/assets/greenpower-2027/${this.photo.name}-1600.webp`; }
  get srcset() {
    const largeWidth = Math.round(this.photo.width * Math.min(1, 1600 / Math.max(this.photo.width, this.photo.height)));
    const smallWidth = Math.round(this.photo.width * Math.min(1, 640 / Math.max(this.photo.width, this.photo.height)));
    return `/assets/greenpower-2027/${this.photo.name}-640.webp ${smallWidth}w, ${this.src} ${largeWidth}w`;
  }
}
