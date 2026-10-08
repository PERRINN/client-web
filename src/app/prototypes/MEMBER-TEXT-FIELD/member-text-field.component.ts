import { Component } from '@angular/core';

@Component({
  selector: 'prototype-member-text-field',
  templateUrl: './member-text-field.component.html',
  styleUrls: ['./member-text-field.component.css'],
  standalone: false
})
export class MemberTextFieldComponent {
  value = '';
  readonly maxLength = 80;

  clear(input: HTMLInputElement): void {
    this.value = '';
    input.focus();
  }
}
