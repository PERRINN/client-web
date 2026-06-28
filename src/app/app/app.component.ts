import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { UserInterfaceService } from '../userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, interval } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html'
})
export class AppComponent {
  showSocialLinksPopup = false;
  isDragging = false;

  private onMouseMove = (event: MouseEvent) => {
    if (!this.isDragging) return;
    const widthPct = (event.clientX / window.innerWidth) * 100;
    if (widthPct > 20 && widthPct < 80) {
      document.documentElement.style.setProperty('--side-panel-width', `${widthPct}vw`);
      localStorage.setItem('sidePanelWidth', `${widthPct}vw`);
      window.dispatchEvent(new Event('resize'));
    }
  };

  private onMouseUp = () => {
    if (this.isDragging) {
      this.isDragging = false;
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', this.onMouseMove);
      document.removeEventListener('mouseup', this.onMouseUp);
    }
  };

  startDragging(event: MouseEvent) {
    if (window.innerWidth < 900) return;
    this.isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    event.preventDefault();
  }

  private cleanupLegacyLocalStorage(): void {
    const legacyKeys = [
      'processingPayment',
      'paymentStatus',
      'revolutCheckoutUrl',
      'revolutOrderId',
      'revolutOrderReference'
    ];
    legacyKeys.forEach((key) => localStorage.removeItem(key));
  }

  constructor(
    public router:Router,
    public afs:AngularFirestore,
    public UI:UserInterfaceService,
    private updates: SwUpdate
  ) {
    this.cleanupLegacyLocalStorage();

    if (this.updates.isEnabled) {
      this.updates.versionUpdates
        .pipe(filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'))
        .subscribe(() => {
          this.updates.activateUpdate().then(() => document.location.reload());
        });

      interval(30000).subscribe(() => {
        this.updates.checkForUpdate();
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          this.updates.checkForUpdate();
        }
      });
    }
  }

  ngOnInit() {
    const savedWidth = localStorage.getItem('sidePanelWidth');
    if (savedWidth) {
      document.documentElement.style.setProperty('--side-panel-width', savedWidth);
    }
    const uploader = document.getElementById('uploader');
    if (uploader) uploader.style.visibility = 'hidden';
    const fullScreenImage = document.getElementById('fullScreenImage');
    if (fullScreenImage) fullScreenImage.style.visibility = 'hidden';
  }

  hideFullScreenImage() {
    const fullScreenImage = document.getElementById('fullScreenImage') as HTMLImageElement | null;
    if (!fullScreenImage) return;
    fullScreenImage.style.visibility = 'hidden';
    fullScreenImage.src = '';
  }

  openDiscover() {
    window.open('https://discover.perrinn.com', '_blank');
  }

  toggleSocialLinksPopup() {
    this.showSocialLinksPopup = !this.showSocialLinksPopup;
  }

  closeSocialLinksPopup() {
    this.showSocialLinksPopup = false;
  }

  openSocialLink(url: string) {
    if (!url) return;
    window.open(url, '_blank');
    this.closeSocialLinksPopup();
  }

}
