import { Component } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';

@Component({
  selector:'apps',
  template:`
  <div class="sheet">
    <div style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" (click)="newMessage()">
      <span class="material-icons" style="margin:5px;cursor:pointer;color:rgba(0,0,0,0.6)">create</span>
      <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">New</div>
    </div>
    <div style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" onclick="window.open('https://meet.google.com/rxn-vtfa-shq','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:22px;margin:5px 8px 5px 8px;margin-top:11px;filter:grayscale(100%)" src="./../assets/App icons/google-meet-logo.png">
      <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Meet</div>
    </div>
    <div style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" onclick="window.open('https://drive.google.com/drive/u/1/folders/1qvipN1gs1QS4sCh1tY8rSSFXV5S0-uR3','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:22px;margin:5px 8px 5px 8px;margin-top:9px;filter:grayscale(100%)" src="./../assets/App icons/Google_Drive_icon_(2020).svg">
      <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Documents</div>
    </div>
    <div style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" onclick="window.open('https://github.com/PERRINN')" (click)="router.navigate(['profile','all'])">
      <img style="width:22px;margin:5px 8px 5px 8px;margin-top:7px;filter:grayscale(100%)" src="./../assets/App icons/Octicons-mark-github.svg">
      <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Code</div>
    </div>
    <div style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" onclick="window.open('https://cad.onshape.com/documents?nodeId=31475a51a48fbcc9cfc7e244&resourceType=folder','_blank')" (click)="router.navigate(['profile','all'])">
      <img style="width:24px;margin:5px 8px 5px 8px;filter:grayscale(100%)" src="./../assets/App icons/onshape_new.png">
      <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Design</div>
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

  newMessage() {
    this.router.navigate(['chat',this.UI.newId()])
  }

}
