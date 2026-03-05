import { Component } from '@angular/core';
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

    <div class="topNav">
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

        <span *ngIf="UI.isDev||UI.profileSimulatorNonMember" class="devFlag" (click)="UI.toggleprofileSimulatorNonMember()">
          Non Member {{UI.profileSimulatorNonMember ? '(ON)' : '(OFF)'}}
        </span>
        <span *ngIf="UI.isDev" class="devFlag">DEV</span>
        <span *ngIf="UI.revolutMode=='sandbox'" class="devFlag">sandbox</span>

        <button class="buttonPrimary buyBtn" (click)="router.navigate(['buyPRN',''])" [disabled]='this.router.url.startsWith("/buyPRN")'>
          Buy PRN
        </button>
      </div>
    </div>

    <div id='main_container'>
      <div id='secondary_container' class="contentWrap">
        <div class="contentCard">
          <router-outlet></router-outlet>
        </div>
      </div>
    </div>
    </div>
  `
})
export class AppComponent {

  constructor(
    public router:Router,
    public afs:AngularFirestore,
    public UI:UserInterfaceService,
    private updates: SwUpdate
  ) {
    localStorage.clear()

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

}
