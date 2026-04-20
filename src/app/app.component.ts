import { Component, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, interval } from 'rxjs';

@Component({
  selector: 'app-root',
  template: `
    <div class="appShell">
    <img class="fullScreenImage" id="fullScreenImage" (click)="hideFullScreenImage()">
    <progress value='0' max='100' id='uploader' class="uploadProgress">0%</progress>

    <div class="topNav" [class.topNavFullWidth]="router.url.startsWith('/chat/')">
      <div class="navLeft">
        <button class="iconBtn" (click)="router.navigate(['profile','all'])" aria-label="Go to profile">
          <img src="./../assets/App icons/Perrinn_02.png" class="brandIcon">
        </button>
        <button class="iconBtn" (click)="router.navigate(['directory'])" aria-label="Open directory">
          <span class="material-icons">list</span>
        </button>
        <button class="iconBtn" (click)="openDiscover()" aria-label="Open discover">
          <span class="material-icons-outlined">info</span>
        </button>
        <button class="iconBtn" (click)="toggleSocialLinksPopup()" aria-label="Open apps">
          <span class="material-icons-outlined">apps</span>
        </button>
      </div>

      <div class="navRight">
        <button *ngIf="!UI.currentUser" class="buttonSecondary" (click)="router.navigate(['login'])" [disabled]='this.router.url.startsWith("/login")'>
          Login
        </button>

        <div *ngIf="UI.currentUser" class="userPill" (click)="router.navigate(['profile',UI.currentUser])">
          <img *ngIf="UI.currentUserLastMessageObj" [src]="UI.currentUserLastMessageObj?.imageUrlThumbUser" (error)="UI.handleUserImageError($event, UI.currentUserLastMessageObj)" class="avatar">
          <span class="balance">{{UI.convertAndFormatPRNToPRNCurrency(null,UI.currentUserLastMessageObj?.wallet?.balance||0)}}</span>
          <span *ngIf="UI.isCurrentUserMember" class="material-icons verified">check_circle</span>
        </div>

        <div class="devPillArea" *ngIf="UI.profileSimulatorNonMember || UI.profileSimulatorLoggedOut || UI.isDev || UI.revolutMode !== 'prod'">
          <div class="devPill devPillActive devPillToggle" *ngIf="UI.profileSimulatorLoggedOut" (click)="UI.toggleprofileSimulatorLoggedOut()">Logged-out ON</div>
          <div class="devPill devPillToggle" *ngIf="!UI.profileSimulatorLoggedOut && UI.isDev" (click)="UI.toggleprofileSimulatorLoggedOut()">Logged-out OFF</div>
          <div class="devPill devPillActive devPillToggle" *ngIf="UI.profileSimulatorNonMember" (click)="UI.toggleprofileSimulatorNonMember()">Non-member ON</div>
          <div class="devPill devPillToggle" *ngIf="!UI.profileSimulatorNonMember && UI.isDev" (click)="UI.toggleprofileSimulatorNonMember()">Non-member OFF</div>
          <span *ngIf="UI.isDev" class="devPill">DEV</span>
          <span *ngIf="UI.revolutMode=='sandbox'" class="devPill">sandbox</span>
        </div>

        <button class="buttonPrimary buyBtn" (click)="router.navigate(['buyPRN',''])" [disabled]='this.router.url.startsWith("/buyPRN")'>
          Buy PRN
        </button>
      </div>
    </div>

    <div id='main_container'>
      <div class="sideProfile" *ngIf="router.url.startsWith('/chat/')">
        <profile [sidePanelScope]="'all'"></profile>
      </div>
      <div class="sideResizer" *ngIf="router.url.startsWith('/chat/')" (mousedown)="startResizing($event)"></div>
      <div id='secondary_container' class="contentWrap" [class.contentWrapFullWidth]="router.url.startsWith('/chat/')">
        <div class="contentCard">
          <router-outlet></router-outlet>
        </div>
      </div>
    </div>

    <div class="socialPopupBackdrop" *ngIf="showSocialLinksPopup" (click)="closeSocialLinksPopup()">
      <div class="socialPopupCard" (click)="$event.stopPropagation()">
        <div class="socialPopupHeader">
          <span class="socialPopupTitle">Apps</span>
        </div>
        <div class="socialPopupGrid">
          <button *ngIf="UI.PERRINNProfileLastMessageObj?.publicLink" class="buttonSecondary socialPopupBtn" (click)="openSocialLink(UI.PERRINNProfileLastMessageObj?.publicLink)">
            <span class="material-icons-outlined">cloud</span>
            Google Drive
          </button>
          <button class="buttonSecondary socialPopupBtn" (click)="openSocialLink('https://chat.whatsapp.com/CzUNIrzBBuiI6lOCnh9DRx')">
            <span class="material-icons-outlined">chat</span>
            WhatsApp
          </button>
          <button class="buttonSecondary socialPopupBtn" (click)="openSocialLink('https://www.youtube.com/@PERRINN424WeAreATeam')">
            <span class="material-icons-outlined">smart_display</span>
            YouTube
          </button>
          <button class="buttonSecondary socialPopupBtn" (click)="openSocialLink('https://www.linkedin.com/company/perrinn')">
            <span class="material-icons-outlined">business</span>
            LinkedIn
          </button>
          <button class="buttonSecondary socialPopupBtn" (click)="openSocialLink('https://github.com/PERRINN')">
            <span class="material-icons-outlined">code</span>
            GitHub
          </button>
        </div>
      </div>
    </div>
    </div>
  `
})
export class AppComponent {
  showSocialLinksPopup = false;
  isResizing = false;

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
    document.getElementById('uploader').style.visibility = 'hidden';
    document.getElementById('fullScreenImage').style.visibility = 'hidden';
  }

  hideFullScreenImage() {
    const fullScreenImage = document.getElementById('fullScreenImage') as HTMLImageElement;
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

  startResizing(event: MouseEvent) {
    event.preventDefault();
    this.isResizing = true;
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isResizing) return;
    let pct = (event.clientX / window.innerWidth) * 100;
    if (pct < 20) pct = 20; // Limite mini
    if (pct > 60) pct = 60; // Limite maxi
    document.documentElement.style.setProperty('--side-width-pct', `${pct}vw`);
    this.UI.sidePanelWidthChanged.next();
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    this.isResizing = false;
  }
}
