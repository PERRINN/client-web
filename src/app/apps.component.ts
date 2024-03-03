import { Component } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';

@Component({
  selector:'apps',
  template:`
  <div class="sheet">
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://chat.whatsapp.com/CzUNIrzBBuiI6lOCnh9DRx','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:28px;margin:5px 8px 0px 5px;margin-top:5px;filter:grayscale(100%)" src="./../assets/App icons/whatsapp-black-logo-icon--24.png">
      <div>WhatsApp</div>
    </div>
    <div class="seperator"></div>
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://drive.google.com/drive/folders/15lFP8gDsQ6VV_v3vUPlX-5PXzq0vna7G?usp=sharing','_blank')" (click)="router.navigate(['profile','all'])">
      <span class="material-icons" style="width:22px;margin:5px 8px 0px 8px;margin-top:9px">photo_library</span>
      <div>Images</div>
    </div>
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://drive.google.com/drive/folders/1Yckl0G4nlVZVtT0hViJiHlY9HmxlrG5d?usp=sharing','_blank')" (click)="router.navigate(['profile','all'])">
      <span class="material-icons" style="width:22px;margin:5px 8px 0px 8px;margin-top:9px">video_library</span>
      <div>Videos</div>
    </div>
    <div class="seperator"></div>
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://meet.google.com/rxn-vtfa-shq','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:22px;margin:5px 8px 5px 8px;margin-top:11px;filter:grayscale(100%)" src="./../assets/App icons/google-meet-logo.png">
      <div>Meet</div>
    </div>
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://drive.google.com/drive/u/0/folders/1qvipN1gs1QS4sCh1tY8rSSFXV5S0-uR3','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:22px;margin:5px 8px 5px 8px;margin-top:11px;filter:grayscale(100%)" src="./../assets/App icons/Google_Drive_icon_(2020).svg">
      <div>Documents</div>
    </div>
    <div class="seperator"></div>
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://github.com/PERRINN')" (click)="router.navigate(['profile','all'])">
      <img style="width:22px;margin:5px 8px 5px 8px;margin-top:7px;filter:grayscale(100%)" src="./../assets/App icons/Octicons-mark-github.svg">
      <div>Code</div>
    </div>
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://cad.onshape.com/documents?nodeId=31475a51a48fbcc9cfc7e244&resourceType=folder','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:24px;margin:5px 8px 5px 8px;filter:grayscale(100%)" src="./../assets/App icons/onshape_new.png">
      <div>Design</div>
    </div>
    <div class="buttonWhite" style="float:left;width:100px;height:68px;margin:10px" onclick="window.open('https://app.bramblecfd.com/#/forces','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:24px;margin:5px 8px 5px 8px;filter:grayscale(100%)" src="./../assets/App icons/bramble-logo-small.png">
      <div>Aero</div>
    </div>
    <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  `,
})
export class AppsComponent {

  constructor(
    public router:Router,
    public UI:UserInterfaceService
  ) {
  }
}
