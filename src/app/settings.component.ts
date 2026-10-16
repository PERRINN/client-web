import { Component, NgZone, OnDestroy, OnInit, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserInterfaceService } from './userInterface.service';
import { ImageUploadService, imageUploadState } from './imageUpload.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

@Component({
    selector: 'settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.css', './upload-progress.css'],
    standalone: false
})
export class SettingsComponent implements OnInit, OnDestroy {
  profileUpload = imageUploadState();
  name:string
  userPresentation:string
  emailsAuth:string
  contract:any
  searchFilter:string
  publicLink:any

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    private uploads: ImageUploadService,
    public UI:UserInterfaceService,
    private injector: EnvironmentInjector,
    private zone: NgZone
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

      runInInjectionContext(this.injector, () =>
        this.afs
          .collection<any>('PERRINNMessages', (ref) =>
            ref
              .where('user', '==', auth.uid)
              .where('verified', '==', true)
              .orderBy('serverTimestamp', 'desc')
              .limit(1)
          )
          .valueChanges()
      ).subscribe((snapshot) => {
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
    const level = Number(this.contract.level);
    if(!(level >= 1 && level <= 10)) return;
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my contract details to level '+level,
      contract:{
        level:level
      }
    })
    this.UI.currentUserLastMessageObj = {
      ...(this.UI.currentUserLastMessageObj || {}),
      contract: {
        ...((this.UI.currentUserLastMessageObj || {}).contract || {}),
        level: level
      }
    }
  }

  isValidEmail(email: string): boolean {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  onContractLevelInput(event: Event) {
    const inputElement = event.target as HTMLInputElement;
    const digitsOnlyValue = (inputElement.value || '').replace(/\D/g, '').slice(0, 2);
    inputElement.value = digitsOnlyValue;
    this.contract.level = digitsOnlyValue;
  }

  addChild(team){
  }

  ngOnDestroy(): void { this.profileUpload = imageUploadState(); }

  async onImageChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement, image = input.files?.[0], state = this.profileUpload;
    if (!image || state.busy) return;
    const userId = this.UI.currentUser, timestamp = String(Date.now());
    state.busy = true; state.percent = 0; state.error = '';
    try {
      const url = await this.uploads.upload(`images/${timestamp}${image.name}`, image, percent => this.zone.run(() => state.percent = percent));
      if (state !== this.profileUpload) return;
      if (!userId || this.UI.currentUser !== userId) throw new Error('Account changed');
      const photos = { userImageTimestamp: timestamp, imageUrlThumbUser: url, imageUrlMedium: url, imageUrlOriginal: url };
      await this.UI.createMessage({ chain: userId, text: 'updating my profile picture', ...photos,
        chatImageTimestamp: timestamp, chatImageUrlThumb: url, chatImageUrlMedium: url, chatImageUrlOriginal: url });
      this.zone.run(() => {
        if (state === this.profileUpload && this.UI.currentUser === userId) this.UI.currentUserLastMessageObj = { ...(this.UI.currentUserLastMessageObj || {}), ...photos };
      });
    } catch {
      this.zone.run(() => state.error = 'Profile picture couldn’t save. Try again.');
    } finally { this.zone.run(() => { state.busy = false; state.percent = null; input.value = ''; }); }
  }

  objectToArray(obj) {
    if (obj == null) { return []; }
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]];
    });
  }

}
