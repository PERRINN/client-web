import { Component } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserInterfaceService } from './userInterface.service';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

@Component({
  selector:'settings',
  template:`
  <div class="settingsPage">
  <div class="settingsPageTitle">Settings</div>
  <div class="island profileSummary settingsProfileCard">
    <div class="settingsProfileHead">
      <img class="imageWithZoom settingsProfileImage" [src]="UI.currentUserLastMessageObj?.imageUrlMedium||UI.currentUserLastMessageObj?.imageUrlThumbUser" (error)="UI.handleUserImageError($event, UI.currentUserLastMessageObj)" (click)="UI.showFullScreenImage(UI.currentUserLastMessageObj?.imageUrlOriginal)"
      onerror="this.onerror=null;this.src='https://storage.googleapis.com/perrinn-d5fc1.appspot.com/images%2F1585144867972Screen%20Shot%202018-03-16%20at%2015.05.10_180x180.png?GoogleAccessId=firebase-adminsdk-rh8x2%40perrinn-d5fc1.iam.gserviceaccount.com&Expires=16756761600&Signature=I3Kem9n6zYjSNijnKOx%2FAOUAg65GN3xf8OD1qD4uo%2BayOFblFIgfn81uPWRTzhGg14lJdyhz3Yx%2BiCXuYCIdYnduqMZcIjtHE6WR%2BPo74ckemuxIKx3N24tlBJ6DgkfgqwmIkw%2F%2FKotm8Cz%2Fq%2FbIZm%2FvAOi2dpBHqrHiIFXYb8AVYnhP1osUhVvyzapgYJEBZJcHur7v6uqrSKwQ4DfeHHinbJpvkX3wjM6Nxabi3kVABdGcGqMoAPGCTZJMzNj8xddAXuECbptQprd9LlnQOuL4tuDfLMAOUXTHmJVhJEBrquxQi8iPRjnLOvnqF8s2We0SOxprqEuwbZyxSgH05Q%3D%3D'">

      <div class="settingsProfileMain">
        <div class="settingsProfileTopRow">
          <div class="settingsProfileNameWrap">
            <span class="settingsProfileName">{{UI.currentUserLastMessageObj?.name}}</span>
          </div>
          <span class="settingsProfileBalance">{{UI.convertAndFormatPRNToPRNCurrency(null,UI.currentUserLastMessageObj?.wallet?.balance)}}</span>
        </div>

        <div class="settingsProfilePresentation">{{UI.currentUserLastMessageObj?.userPresentation}} Level {{UI.currentUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}}</div>

        <div class="settingsProfileMeta">
          <span *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed">Waiting for contract signature (Level {{UI.currentUserLastMessageObj?.contract?.level}})</span>
          <span>{{UI.hasTouch?"On mobile (touch screen)":"On desktop / laptop"}}</span>
          <span>{{UI.isStandalone?"On home screen":"In the browser"}}</span>
        </div>

        <div class="settingsUploadRow">
          <input
            type="file"
            id="chatImage"
            (change)="onImageChange($event)"
            accept="image/*"
            style="display: none;"
          />
          <label
            for="chatImage"
            id="buttonFile"
            class="buttonPrimary settingsUploadBtn"
          >
            Upload a new profile picture
          </label>
        </div>
      </div>
    </div>
  </div>
  <div class="island settingsSection">
    <div class="title">Your name (preferably your first name)</div>
    <input [(ngModel)]="name" placeholder="First name">
    <button class="buttonPrimary" (click)="updateName()" style="font-size:12px;width:200px;padding:2px;margin:10px" [disabled]="name==UI.currentUserLastMessageObj?.name">Update my name</button>
  </div>
  <br/>
  <div class="island settingsSection">
    <div class="title">Preferred currency</div>
    <div style="padding:10px">
      <ul class="listLight">
        <li class="buttonBlack" *ngFor="let currency of objectToArray(UI.PERRINNAdminLastMessageObj?.currencyList)"
          (click)="UI.currentUserLastMessageObj?.userCurrency==currency[0]?'':updateUserCurrency(currency[0])"
          [class.activeCurrency]="UI.currentUserLastMessageObj?.userCurrency==currency[0]"
          style="float:left;width:125px;padding:5px;margin:5px"
          [style.pointer-events]="UI.currentUserLastMessageObj?.userCurrency==currency[0]?'none':'auto'">
          {{currency[1].designation}}
        </li>
      </ul>
    </div>
  </div>
  <br/>
  <div class="island settingsSection">
    <div class="title">Short presentation</div>
    <div style="margin:20px">Your short presentation helps other members get to know you.</div>
    <div style="margin:10px 20px 0 20px">I am someone who is:</div>
    <input [(ngModel)]="userPresentation" placeholder="Your short presentation" maxlength="150">
    <button class="buttonPrimary" (click)="updateUserPresentation()" style="font-size:12px;width:200px;padding:2px;margin:10px" [disabled]="userPresentation==UI.currentUserLastMessageObj?.userPresentation">Update my presentation</button>
  </div>
  <br/>
  <div class="island settingsSection">
    <div class="title">Public link</div>
    <div style="margin:20px 20px 0 20px">Add view only public link so other members can view your documents, website, code and more.</div>
    <input [(ngModel)]="publicLink" placeholder="Add a link">
    <button class="buttonPrimary" (click)="updatePublicLink()" style="font-size:12px;width:200px;padding:2px;margin:10px" [disabled]="publicLink==UI.currentUserLastMessageObj?.publicLink">Update my link</button>
  </div>
  <br/>
  <div class="island settingsSection">
    <div class="title">Email address</div>
    <div style="margin:10px 20px 0 20px">Authentication address.</div>
    <input [(ngModel)]="emailsAuth" placeholder="Enter your authentication email">
    <button class="buttonPrimary" (click)="updateEmails()" style="font-size:12px;width:250px;padding:2px;margin:10px" [disabled]="emailsAuth==UI.currentUserLastMessageObj?.emails.auth">Update my email address</button>
  </div>
  <br/>
  <div class="island settingsSection">
    <div class="title">PERRINN contract</div>
    <div style="margin:20px">Your PERRINN contract defines how you collaborate with the team. Any change you submit here is first reviewed, then approved before it becomes active. Either you or PERRINN can end the contract at any time.</div>
    <div style="margin:15px 20px 0 20px">Contract level is a scale from <b>1 to 10</b> based on your ability to work independently: <b>1</b> = beginner, <b>10</b> = expert (10+ years of experience). After signature, your effective level increases automatically over time by about <b>+1 per year</b>.</div>
    <input [(ngModel)]="contract.level" (input)="onContractLevelInput($event)" maxlength="2" inputmode="numeric" pattern="[0-9]*" placeholder="Contract level">
    <button class="buttonPrimary" (click)="updateContract()" style="clear:both;font-size:12px;width:200px;padding:2px;margin:10px auto;display:block" [disabled]="contract.level==UI.currentUserLastMessageObj?.contract?.level">Update my contract</button>
    <div *ngIf="!UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:10px 10px 5px 15px">No contract registered.</div>
    <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:10px 10px 5px 15px">Contract number {{UI.currentUserLastMessageObj?.contract?.createdTimestamp}}</div>
    <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:5px 10px 10px 15px">Signature valid for level {{UI.currentUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}}, you will receive {{UI.convertAndFormatPRNToPRNCurrency(null,(UI.PERRINNAdminLastMessageObj?.contract?.hourlyRateLevel1||0)*UI.currentUserLastMessageObj?.contract?.levelTimeAdjusted)}} per hour when you declare working hours.</div>
    <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:5px 10px 10px 15px">Waiting for contract signature</div>
  </div>
  <br/>
  <div class="island settingsSection">
    <div class="title">Profile simulator (for UI dev)</div>
    <button class="buttonPrimary" (click)="UI.toggleprofileSimulatorNonMember()" style="clear:both;font-size:12px;width:200px;padding:2px;margin:10px auto;display:block">Non member {{UI.profileSimulatorNonMember ? 'ON' : 'OFF'}} </button>
      <button class="buttonPrimary" (click)="UI.toggleprofileSimulatorLoggedOut()">Logged-out {{UI.profileSimulatorLoggedOut ? 'ON' : 'OFF'}}</button>
  </div>
  <br/>
  <div class="island settingsSection">
    <div class="title">Account</div>
    <button class="buttonRed" style="width:120px;margin:10px auto; display: block" (click)="this.UI.logout()">Logout</button>
  </div>
  </div>
  `
})
export class SettingsComponent {
  name:string
  userPresentation:string
  emailsAuth:string
  contract:any
  searchFilter:string
  publicLink:any

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    private storage:AngularFireStorage,
    public UI:UserInterfaceService
  ) {
    this.contract={}
    this.name=(this.UI.currentUserLastMessageObj||{}).name||null
    this.userPresentation=(this.UI.currentUserLastMessageObj||{}).userPresentation||null
    this.publicLink=(this.UI.currentUserLastMessageObj||{}).publicLink||null
    this.emailsAuth=((this.UI.currentUserLastMessageObj||{}).emails||{}).auth||null
    this.contract.level=((this.UI.currentUserLastMessageObj||{}).contract||{}).level||null
  }

  ngOnInit() {
    this.afAuth.user.subscribe((auth) => {
      if (!auth) return;
      this.afs
        .collection<any>('PERRINNMessages', (ref) =>
          ref
            .where('user', '==', auth.uid)
            .where('verified', '==', true)
            .orderBy('serverTimestamp', 'desc')
            .limit(1)
        )
        .valueChanges()
        .subscribe((snapshot) => {
          const profile = (snapshot && snapshot[0]) || {};
          this.name = profile.name || null;
          this.userPresentation = profile.userPresentation || null;
          this.publicLink = profile.publicLink || null;
          this.emailsAuth = (profile.emails || {}).auth || null;
          this.contract.level = (profile.contract || {}).level || null;
        });
    });
  }

  updateName(){
    if(!this.name)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my name to '+this.name,
      name:this.name
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      name: this.name
    }
  }

  updateUserCurrency(currency){
    if(!currency)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my preferred currency to '+((this.UI.PERRINNAdminLastMessageObj?.currencyList||{})[currency]||{}).designation,
      userCurrency:currency
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      userCurrency: currency
    }
  }

  updateUserPresentation(){
    if(!this.userPresentation)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my presentation to '+this.userPresentation,
      userPresentation:this.userPresentation
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      userPresentation: this.userPresentation
    }
  }

  updatePublicLink(){
    if(this.publicLink==(this.UI.currentUserLastMessageObj.publicLink||null))return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my public link.',
      publicLink:this.publicLink
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      publicLink: this.publicLink
    }
  }

  updateEmails(){
    if(this.emailsAuth!=this.UI.currentUserLastMessageObj.emails.auth){
      this.UI.createMessage({
        chain:this.UI.currentUser,
        text:'Updating my email addresses.',
        emails:{
          auth:this.emailsAuth
        }
      })
      this.UI.currentUserLastMessageObj = {
        ...(this.UI.currentUserLastMessageObj || {}),
        emails: {
          ...((this.UI.currentUserLastMessageObj || {}).emails || {}),
          auth: this.emailsAuth
        }
      }
      return
    }
    else return
  }

  updateContract(){
    const contractLevel = this.getNormalizedContractLevel()
    if(!contractLevel)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my contract details to level '+contractLevel,
      contract:{
        level:contractLevel
      }
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      contract: {
        ...((this.UI.currentUserLastMessageObj || {}).contract || {}),
        level: contractLevel
      }
    }
  }

  onContractLevelInput(event: Event) {
    const inputElement = event.target as HTMLInputElement;
    const digitsOnlyValue = (inputElement.value || '').replace(/\D/g, '').slice(0, 2);
    inputElement.value = digitsOnlyValue;
    this.contract.level = digitsOnlyValue;
  }

  private getNormalizedContractLevel(): number | null {
    const digitsOnlyValue = String(this.contract.level ?? '').replace(/\D/g, '').slice(0, 2);
    if (!digitsOnlyValue) return null;
    const contractLevel = Number(digitsOnlyValue);
    if (!Number.isFinite(contractLevel) || contractLevel <= 0) return null;
    return contractLevel;
  }

  addChild(team){
  }

  onImageChange(event:any) {
    const image = event.target.files[0];
    const uploader = document.getElementById('uploader') as HTMLInputElement;
    const storageRef = this.storage.ref('images/'+Date.now()+image.name);
    const task = storageRef.put(image);

    task.snapshotChanges().subscribe((snapshot) => {
      document.getElementById('buttonFile').style.visibility = 'hidden';
      document.getElementById('uploader').style.visibility = 'visible';

      const percentage = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      uploader.value = percentage.toString();
    },
    (err:any) => {
      document.getElementById('buttonFile').style.visibility = 'visible';
      document.getElementById('uploader').style.visibility = 'hidden';
      uploader.value = '0';
    },
    () => {
      uploader.value = '0';
      document.getElementById('buttonFile').style.visibility = 'visible';
      document.getElementById('uploader').style.visibility = 'hidden';
      let imageTimestamp = task.task.snapshot.ref.name.substring(0, 13);
      storageRef.getDownloadURL().subscribe(url => {
        this.UI.createMessage({
          chain:this.UI.currentUser,
          text:'updating my profile picture',
          userImageTimestamp:imageTimestamp,
          chatImageTimestamp:imageTimestamp,
          chatImageUrlThumb:url,
          chatImageUrlMedium:url,
          chatImageUrlOriginal:url,
          imageUrlThumbUser:url,
          imageUrlMedium:url,
          imageUrlOriginal:url
        })
        this.UI.currentUserLastMessageObj = {
          ...(this.UI.currentUserLastMessageObj || {}),
          userImageTimestamp:imageTimestamp,
          imageUrlThumbUser:url,
          imageUrlMedium:url,
          imageUrlOriginal:url
        }
      });
    });
  }

  objectToArray(obj) {
    if (obj == null) { return []; }
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]];
    });
  }

}
