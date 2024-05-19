import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';

@Component({
  selector: 'app-root',
  template: `
    <img class="fullScreenImage" id="fullScreenImage" (click)="hideFullScreenImage()">
    <progress value='0' max='100' id='uploader'>0%</progress>
    <div class='menu'>
      <div style="width:320px;display:block;margin: 0 auto">
        <img src="./../assets/App icons/Perrinn_02.png" style="cursor:pointer;float:left;width:30px;margin:5px 45px 5px 5px" (click)="router.navigate(['profile','all'])">
        <span class="material-icons" style="float:left;margin:5px 45px 5px 45px;font-size:30px;cursor:pointer" (click)="router.navigate(['directory'])">list</span>
        <span class="material-icons-outlined" style="float:left;margin:5px 45px 5px 45px;font-size:30px;height:30px;cursor:pointer" onclick="window.open('https://discover.perrinn.com','_blank')">info</span>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div style="user-select:none">
      <div style="max-width:800px;margin:0 auto">
        <div *ngIf="!UI.currentUser" class="buttonWhite" style="float:left;line-height:20px;width:75px;margin:7px" (click)="router.navigate(['login'])">Login</div>
        <div *ngIf="UI.currentUser" style="float:left;cursor:pointer" (click)="router.navigate(['profile',UI.currentUser])">
          <img [src]="UI.currentUserLastMessageObj?.imageUrlThumbUser" style="display:inline;float:left;margin:5px;object-fit:cover;width:35px;height:35px">
          <span style="margin:11px;font-size:14px;line-height:40px">{{UI.formatSharesToPRN(UI.currentUserLastMessageObj?.wallet.shareBalance||0)}}</span>
          <span style="margin:11px;font-size:14px;line-height:40px">{{UI.formatSharesToCurrency(null,UI.currentUserLastMessageObj?.wallet.shareBalance||0)}}</span>
        </div>
        <div class="buttonBlack" style="float:right;line-height:20px;width:100px;margin:7px" (click)="router.navigate(['buyPRN'])">Buy PRN</div>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div id='main_container'>
      <router-outlet></router-outlet>
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
