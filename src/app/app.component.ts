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
        <img src="./../assets/App icons/Perrinn_02.png" style="cursor:pointer;float:left;width:30px;margin:5px 45px 5px 5px;border-radius:3px;" (click)="router.navigate(['profile','all'])">
        <span class="material-icons" style="float:left;margin:5px 45px 5px 45px;font-size:30px;cursor:pointer;color:white" (click)="router.navigate(['directory'])">list</span>
        <span class="material-icons-outlined" style="float:left;margin:5px 45px 5px 45px;font-size:30px;height:30px;cursor:pointer;color:white" onclick="window.open('https://discover.perrinn.com','_blank')">info</span>
      </div>
    </div>
    <div style="user-select:none">
      <div *ngIf="UI.currentUser" style="max-width:800px;margin:0 auto">
        <div style="float:left;width:175px;height:35px;cursor:pointer" (click)="router.navigate(['profile',UI.currentUser])">
          <img *ngIf="UI.currentUserLastMessageObj?.imageUrlThumbUser" [src]="UI.currentUserLastMessageObj.imageUrlThumbUser" style="display:inline;float:left;margin:4px;border-radius:50%;object-fit:cover;width:25px;height:25px">
          <div style="float:left;margin:8px;font-size:12px">
            <span>{{UI.formatSharesToCurrency(null,UI.currentUserLastMessageObj.wallet.shareBalance||0)}}</span>
            <span style="font-size:10px;margin-left:10px"> {{UI.appSettingsCosts?.interestRateYear | percent : "0.0"}} APY</span>
          </div>
        </div>
        <div style="float:left;font-size:12px;text-align:center;line-height:15px;width:75px;padding:2px;margin:7px;color:white;background-color:black;border-radius:3px;cursor:pointer" (click)="router.navigate(['buy'])">Buy</div>
        <div style="float:left;font-size:12px;text-align:center;line-height:15px;width:75px;padding:2px;margin:7px;color:black;border-radius:3px;cursor:pointer;border-width:1px;border-style:solid" (click)="router.navigate(['sell'])">Sell</div>
        <span class="material-icons" style="float:right;margin:5px;cursor:pointer;color:black" (click)="router.navigate(['apps'])">apps</span>
        <div style="float:right;width:1px;height:35px;cursor:pointer;border-style:solid;border-width:0 1px 0 0;border-color:#ddd"></div>
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
