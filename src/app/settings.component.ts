import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { UserInterfaceService } from './userInterface.service';
import { AccountEmailService } from './accountEmail.service';
import { ScreenWakeLockService } from './screenWakeLock.service';
import { SettingsDataService } from './settings/settingsData.service';

@Component({
  selector: 'settings', templateUrl: './settings.component.html', styleUrls: ['./settings.component.css'],
  providers: [AccountEmailService, SettingsDataService], standalone: false
})
export class SettingsComponent implements OnInit, OnDestroy {
  private subscription?: Subscription;
  constructor(public settings: SettingsDataService, public UI: UserInterfaceService,
    public email: AccountEmailService, public screenWakeLock: ScreenWakeLockService, private cd: ChangeDetectorRef) {}
  ngOnInit() {
    this.subscription = this.settings.state.subscribe(() => this.cd.markForCheck());
    this.settings.start();
  }
  viewPhoto(source: string | null) { if (source) this.UI.showFullScreenImage(source); }
  async onImageChange(event: Event) { await this.settings.uploadPhoto(event.target as HTMLInputElement); }
  async pastePhoto(dialog: HTMLDialogElement) {
    await this.settings.pastePhoto();
    if (!this.settings.photo.error) dialog.close();
    this.cd.markForCheck();
  }
  async onPhotoPaste(event: ClipboardEvent, dialog: HTMLDialogElement) {
    const image = Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith('image/'));
    if (!image || !this.settings.canEdit || this.settings.busy) return;
    event.preventDefault(); dialog.close(); await this.settings.uploadPhotoFile(image);
  }
  async sendEmail() { await this.email.send(); this.cd.markForCheck(); }
  @HostListener('window:focus')
  async refreshEmail() { await this.email.refresh(); this.cd.markForCheck(); }
  editContract(event: Event) {
    const input = event.target as HTMLInputElement;
    this.settings.editContract(input.value);
    input.value = this.settings.contractLevel;
  }
  get hourlyCredit() {
    return (this.UI.PERRINNAdminLastMessageObj?.contract?.hourlyRateLevel1 || 0) * (this.settings.profile.contract?.levelTimeAdjusted || 0);
  }
  ngOnDestroy() { this.subscription?.unsubscribe(); }
}
