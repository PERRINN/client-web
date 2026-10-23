import { Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output } from '@angular/core';
import { ChatDataService } from '../chatData.service';
import { PermissionsService } from '../../permissions.service';

@Component({ selector: 'app-chat-input-settings', standalone: false,
  templateUrl: './chat-input-settings.component.html', styleUrls: ['./chat-input-settings.component.css'] })
export class ChatInputSettingsComponent implements OnChanges, OnDestroy {
  @Input() chain = '';
  @Input() mode: 'text' | 'voice' = 'text';
  @Output() busyChange = new EventEmitter<boolean>();
  saving = false;
  error = '';
  private epoch = 0;
  private confirmation?: ReturnType<typeof setTimeout>;
  constructor(public permissions: PermissionsService, private data: ChatDataService, private zone: NgZone) {}
  ngOnChanges(): void {
    const wasSaving = this.saving, epoch = ++this.epoch;
    clearTimeout(this.confirmation); this.saving = false; this.error = '';
    if (wasSaving) queueMicrotask(() => this.zone.run(() => {
      if (epoch === this.epoch && !this.saving) this.busyChange.emit(false);
    }));
  }
  async toggle(): Promise<void> {
    if (!this.permissions.current.isAdmin || this.saving || !this.chain) return;
    const epoch = this.epoch, mode = this.mode === 'voice' ? 'text' : 'voice';
    this.saving = true; this.error = ''; this.busyChange.emit(true);
    try {
      await this.data.updateInputMode(this.chain, mode);
      this.zone.run(() => {
        if (epoch !== this.epoch) return;
        // The existing chat subscription confirms verification; no polling/query.
        this.confirmation = setTimeout(() => this.zone.run(() => {
          if (epoch !== this.epoch) return;
          this.saving = false; this.error = 'Input mode wasn’t confirmed. Try again.'; this.busyChange.emit(false);
        }), 30000);
      });
    } catch {
      this.zone.run(() => {
        if (epoch !== this.epoch) return;
        this.error = 'Input mode couldn’t save. Try again.'; this.saving = false; this.busyChange.emit(false);
      });
    }
  }
  ngOnDestroy(): void { this.epoch++; clearTimeout(this.confirmation); }
}
