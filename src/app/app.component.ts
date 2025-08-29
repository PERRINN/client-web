import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';

@Component({
  selector: 'app-root',
  template: `
    <img class="fullScreenImage" id="fullScreenImage" (click)="hideFullScreenImage()">
    <progress value='0' max='100' id='uploader'>0%</progress>
    <div style="width:320px;margin: 0 auto">
      <img src="./../assets/App icons/Perrinn_02.png" style="cursor:pointer;float:left;width:30px;margin:10px 45px 0px 5px" (click)="router.navigate(['profile','all'])">
      <span class="material-icons" style="float:left;margin:10px 45px 0px 45px;font-size:30px;cursor:pointer" (click)="router.navigate(['directory'])">list</span>
      <span class="material-icons-outlined" style="float:left;margin:10px 45px 0px 45px;font-size:30px;height:30px;cursor:pointer" onclick="window.open('https://discover.perrinn.com','_blank')">info</span>
    </div>
    <div style="padding:10px">
      <div class="island">
        <button *ngIf="!UI.currentUser" class="buttonWhite" style="float:left;line-height:20px;width:75px" (click)="router.navigate(['login'])" [disabled]='this.router.url.startsWith("/login")'>Login</button>
        <div *ngIf="UI.currentUser" style="float:left;cursor:pointer" (click)="router.navigate(['profile',UI.currentUser])">
          <img *ngIf="UI.currentUserLastMessageObj" [src]="UI.currentUserLastMessageObj?.imageUrlThumbUser" (error)="UI.handleUserImageError($event, UI.currentUserLastMessageObj)" style="display:inline;float:left;object-fit:cover;width:35px;height:35px">
          <span style="margin-left:11px;font-size:14px;line-height:40px">{{UI.formatSharesToPRNCurrency(null,UI.currentUserLastMessageObj?.wallet?.balance||0)}}</span>
          <span style="margin-left:11px;font-size:14px;line-height:40px;color:#ff6666"> {{UI.isDev ? 'DEV' : ''}}</span>
          <span style="font-size:14px;line-height:40px;color:#ff6666"> {{UI.revolutMode=='sandbox'?'sandbox':''}}</span>
        </div>
        <button class="buttonWhite" style="float:right;line-height:20px;width:100px" (click)="router.navigate(['buyPRN',''])" [disabled]='this.router.url.startsWith("/buyPRN")'>Buy PRN</button>
      </div>
    </div>
    <div id='main_container'>
      <div style="max-width:800px;margin:0 auto;padding:10px">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
})
export class AppComponent {

  constructor(
    public router:Router,
    public afs:AngularFirestore,
    public UI:UserInterfaceService
  ) {
    localStorage.clear()
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

}
