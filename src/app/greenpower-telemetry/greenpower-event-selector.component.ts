import { ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { Subscription } from 'rxjs';
import { eventListSummary, RecordedEvent } from './greenpowerDay';
import { GreenpowerEventsService } from './greenpowerEvents.service';

@Component({ selector: 'app-greenpower-event-selector', standalone: false,
  templateUrl: './greenpower-event-selector.component.html', styleUrls: ['./greenpower-event-selector.component.css'] })
export class GreenpowerEventSelectorComponent implements OnInit, OnChanges, OnDestroy {
  @Input() locked = false;
  @Input() loading = false;
  @Output() loadRecording = new EventEmitter<void>();
  readonly currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/London', year: 'numeric' }).format(new Date()));
  readonly years = Array.from({ length: Math.max(1, this.currentYear - 2025) }, (_, index) => 2026 + index);
  year = this.currentYear;
  eventOpen = false;
  @ViewChild('eventPicker') private picker?: ElementRef<HTMLElement>;
  @ViewChild('eventTrigger') private trigger?: ElementRef<HTMLButtonElement>;
  @ViewChildren('eventOption') private options?: QueryList<ElementRef<HTMLButtonElement>>;
  private focusTimer?: ReturnType<typeof setTimeout>;
  private search = '';
  private searchedAt = 0;
  private readonly changes: Subscription;
  constructor(public events: GreenpowerEventsService, change: ChangeDetectorRef) {
    this.year = Number(events.filters.from.slice(0, 4)) || this.currentYear;
    this.changes = events.changed.subscribe(() => change.markForCheck());
  }
  ngOnInit() {
    if (!this.events.loadedEvents && !this.events.loadingEvents) void this.events.loadEvents();
  }
  get selectedOutsidePage() { return this.events.selectedEvent && !this.events.events.some(event => event.date === this.events.eventId); }
  get eventChoices() { return this.selectedOutsidePage ? [this.events.selectedEvent!, ...this.events.events] : this.events.events; }
  get eventTitle() { return this.events.eventId ? this.events.eventLabel(this.events.eventId) : 'Select event'; }
  label(event: RecordedEvent) { return [event.date, eventListSummary(event)].filter(Boolean).join(' · '); }
  ngOnChanges() { if (this.locked) this.closeEvents(false); }
  toggleEvents() {
    if (this.locked) return;
    if (this.eventOpen) this.closeEvents();
    else this.openEvents();
  }
  private openEvents(last = false) {
    if (this.locked) return;
    this.eventOpen = true; this.search = '';
    const index = this.eventChoices.findIndex(event => event.date === this.events.eventId);
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      if (this.eventOpen) this.focusOption(index < 0 ? last ? this.eventChoices.length - 1 : 0 : index);
    });
  }
  private focusOption(index: number) { this.options?.get(index)?.nativeElement.focus(); }
  closeEvents(focus = true) {
    this.eventOpen = false; clearTimeout(this.focusTimer);
    if (focus) this.trigger?.nativeElement.focus();
  }
  chooseEvent(date: string) {
    if (this.locked) return;
    this.events.selectEvent(date, false); this.closeEvents();
  }
  triggerKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.openEvents(event.key === 'ArrowUp'); }
    else if (event.key === 'Escape') { event.preventDefault(); this.closeEvents(); }
    else if (event.key === 'Tab' && this.eventOpen) this.closeAfterFocus();
  }
  optionKey(event: KeyboardEvent, index: number) {
    const choices = this.eventChoices, count = choices.length;
    if (event.key === 'Escape') { event.preventDefault(); this.closeEvents(); }
    else if (event.key === 'Tab') this.closeAfterFocus();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      this.focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now(); this.search = (now - this.searchedAt < 700 ? this.search : '') + event.key.toLowerCase(); this.searchedAt = now;
      for (let offset = 1; offset <= count; offset++) {
        const next = (index + offset) % count, choice = choices[next];
        if ((choice.eventName || choice.date).toLowerCase().startsWith(this.search)) { this.focusOption(next); break; }
      }
    }
  }
  private closeAfterFocus() {
    clearTimeout(this.focusTimer); this.focusTimer = setTimeout(() => this.closeEvents(false));
  }
  @HostListener('document:click', ['$event']) outside(event: MouseEvent) {
    if (this.eventOpen && !this.picker?.nativeElement.contains(event.target as Node)) this.closeEvents(false);
  }
  selectYear(year: number) {
    if (this.locked || year === this.year) return;
    this.closeEvents(false); this.year = year;
    this.events.selectSession('');
    void this.events.loadEvents(true, { type: '', location: '', from: `${year}-01-01`, to: `${year}-12-31` });
  }
  ngOnDestroy() { clearTimeout(this.focusTimer); this.changes.unsubscribe(); }
}
