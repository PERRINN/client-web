import { Injectable }    from '@angular/core'
import { AngularFireAuth } from '@angular/fire/compat/auth'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import firebase from 'firebase/compat/app'
import { formatNumber } from '@angular/common'
import { Router, ActivatedRoute } from '@angular/router';
import { isDevMode } from '@angular/core';
import { environment } from '../environments/environment';
import { profile } from 'console'


@Injectable()
export class UserInterfaceService {
  loading:boolean
  currentUser:string
  currentUserEmail:string
  currentUserLastMessageObj:any
  PERRINNProfileLastMessageObj:any
  PERRINNAdminLastMessageObj:any
  nowSeconds:number
  hasTouch:boolean
  isStandalone:boolean
  profileSimulatorNonMember:boolean
  profileSimulatorLoggedOut:boolean
  isCurrentUserMember:boolean
  public isDev: boolean;
  public revolutMode: 'sandbox' | 'prod';
  private authenticatedUser:string
  private authenticatedUserEmail:string
  private profileUserId:string
  private adminUserId:string
  
  constructor(
    private afAuth: AngularFireAuth,
    public router:Router,
    public afs: AngularFirestore
  ) {

    this.profileUserId='ubiLUzQOd0ZIAEDYsOltrUMUdim2'
    this.adminUserId='FHk0zgOQUja7rsB9jxDISXzHaro2'

    this.profileSimulatorNonMember = false;
  this.profileSimulatorLoggedOut = false;

    const host = location.hostname;
    this.isDev =
      isDevMode() ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      !environment.production;
    
    this.revolutMode = this.isDev ? 'sandbox' : 'prod';
    
    // Optional: quick visibility
    console.log('Env detect →', {
      isDevMode: isDevMode(),
      prodFlag: environment.production,
      host,
      isDev: this.isDev,
      revolutMode: this.revolutMode,
    });

    this.hasTouch = false;

    if ('maxTouchPoints' in navigator && navigator.maxTouchPoints > 0) {
      // Filter false positives on desktops
      const mQ = matchMedia('(pointer:coarse)');
      this.hasTouch = mQ && mQ.matches;
    } else if ('ontouchstart' in window) {
      this.hasTouch = true;
    }

    this.isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    this.nowSeconds = Math.floor(Date.now() / 1000);
    setInterval(() => {
      this.nowSeconds = Math.floor(Date.now() / 1000);
    }, 60000);
    this.afAuth.user.subscribe((auth) => {
      if (auth != null) {
        this.authenticatedUser = auth.uid;
        this.authenticatedUserEmail = auth.email;
        if (!this.profileSimulatorLoggedOut) {
          this.currentUser = auth.uid;
          this.currentUserEmail = auth.email;
        }
        afs
          .collection<any>("PERRINNMessages", (ref) =>
            ref
              .where("user", "==", auth.uid)
              .where("verified", "==", true)
              .orderBy("serverTimestamp", "desc")
              .limit(1)
          )
          .valueChanges()
          .subscribe((snapshot) => {
            this.currentUserLastMessageObj = snapshot[0];
            this.isCurrentUserMember = this.profileSimulatorLoggedOut
              ? false
              : (this.profileSimulatorNonMember ? false : (this.currentUserLastMessageObj?.membership?.isMember || false));
          });
      } else {
        this.authenticatedUser = null;
        this.authenticatedUserEmail = null;
        this.profileSimulatorLoggedOut = false;
        this.currentUser = null;
        this.currentUserEmail = null;
      }
    })
    afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("user", "==", this.profileUserId)
          .where("verified", "==", true)
          .orderBy("serverTimestamp", "desc")
          .limit(1)
      )
      .valueChanges()
      .subscribe((snapshot) => {
        this.PERRINNProfileLastMessageObj = snapshot[0];
    })
    afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("user", "==", this.adminUserId)
          .where("verified", "==", true)
          .orderBy("serverTimestamp", "desc")
          .limit(1)
      )
      .valueChanges()
      .subscribe((snapshot) => {
        this.PERRINNAdminLastMessageObj=snapshot[0]
    })
  }

  toggleprofileSimulatorNonMember() {
    this.profileSimulatorNonMember = !this.profileSimulatorNonMember;
    this.isCurrentUserMember = this.profileSimulatorLoggedOut ? false : (this.profileSimulatorNonMember ? false : (this.currentUserLastMessageObj?.membership?.isMember || false));
  }

  toggleprofileSimulatorLoggedOut() {
    this.profileSimulatorLoggedOut = !this.profileSimulatorLoggedOut;
    if (this.profileSimulatorLoggedOut) {
      this.currentUser = null;
      this.currentUserEmail = null;
      this.isCurrentUserMember = false;
      return;
    }
    this.currentUser = this.authenticatedUser || null;
    this.currentUserEmail = this.authenticatedUserEmail || null;
    this.isCurrentUserMember = this.profileSimulatorNonMember ? false : (this.currentUserLastMessageObj?.membership?.isMember || false);
  }

  createMessage(messageObj) {
    if (!messageObj.text && !messageObj.chatImageTimestamp && !messageObj.chatProfileImageTimestamp) return null;
    messageObj.serverTimestamp =
      firebase.firestore.FieldValue.serverTimestamp();
    messageObj.user = this.currentUser;
    messageObj.name =
      messageObj.name || this.currentUserLastMessageObj.name || "";
    messageObj.imageUrlThumbUser =
      messageObj.imageUrlThumbUser ||
      this.currentUserLastMessageObj.imageUrlThumbUser ||
      "";
    messageObj.reads = { [this.currentUser]: true };
    return this.afs.collection("PERRINNMessages").add(messageObj);
  }

  convertPRNToCurrency(currency,amount){
    const currencyList = (this.PERRINNAdminLastMessageObj||{}).currencyList||{};
    if (!currencyList) return Number(amount) || 0;
    if (currency == null) {
      if (this.currentUserLastMessageObj!=undefined&&this.currentUserLastMessageObj.userCurrency!=undefined)
        currency = this.currentUserLastMessageObj.userCurrency;
      else currency = "usd";
    }
    const selectedCurrency = currencyList[currency] ? currency : (currencyList['usd'] ? 'usd' : Object.keys(currencyList)[0]);
    return (Number(amount) || 0) / (currencyList[selectedCurrency]?.toCOIN || 1)
  }

  formatCurrency(currency, amount) {
    const currencyList = (this.PERRINNAdminLastMessageObj||{}).currencyList||{};
    if (!currencyList) {
      const rawAmount = Number(amount) || 0;
      return formatNumber(rawAmount, "en-US", "1.0-2");
    }
    if (currency == null) {
      if (this.currentUserLastMessageObj!=undefined&&this.currentUserLastMessageObj.userCurrency!=undefined)
        currency = this.currentUserLastMessageObj.userCurrency;
      else currency = "usd";
    }
    const selectedCurrency = currencyList[currency] ? currency : (currencyList['usd'] ? 'usd' : Object.keys(currencyList)[0]);
    const selectedSymbol = currencyList[selectedCurrency]?.symbol || '';
    let amountCurrency = amount;
    if (amountCurrency < 0) amountCurrency = -amountCurrency;
    if (amountCurrency < 100)
      return (
        (amount < 0 ? "-" : "") +
        selectedSymbol +
        formatNumber(amountCurrency, "en-US", "1.2-2")
      );
    if (amountCurrency < 1000)
      return (
        (amount < 0 ? "-" : "") +
        selectedSymbol +
        formatNumber(amountCurrency, "en-US", "1.1-1")
      );
    if (amountCurrency < 10000)
      return (
        (amount < 0 ? "-" : "") +
        selectedSymbol +
        formatNumber(amountCurrency, "en-US", "1.0-0")
      );
    if (amountCurrency < 100000)
      return (
        (amount < 0 ? "-" : "") +
        selectedSymbol +
        formatNumber(amountCurrency / 1000, "en-US", "1.2-2") +
        "K"
      );
    if (amountCurrency < 1000000)
      return (
        (amount < 0 ? "-" : "") +
        selectedSymbol +
        formatNumber(amountCurrency / 1000, "en-US", "1.1-1") +
        "K"
      );
    if (amountCurrency < 10000000)
      return (
        (amount < 0 ? "-" : "") +
        selectedSymbol +
        formatNumber(amountCurrency / 1000000, "en-US", "1.3-3") +
        "M"
      );
    else
      return (
        (amount < 0 ? "-" : "") +
        selectedSymbol +
        formatNumber(amountCurrency / 1000000, "en-US", "1.2-2") +
        "M"
      );
  }

  convertAndFormatPRNToCurrency(currency, amount) {
    if (currency == null) {
      if (this.currentUserLastMessageObj!=undefined&&this.currentUserLastMessageObj.userCurrency!=undefined)
        currency = this.currentUserLastMessageObj.userCurrency;
      else currency = "usd";
    }
    return this.formatCurrency(currency, this.convertPRNToCurrency(currency, amount));
  }

  convertAndFormatPRNToPRNCurrency(currency, amount) {
    return 'PRN ' + this.convertAndFormatPRNToCurrency(currency, amount)
  }

  formatPRNCurrency(currency, amount) {
    return 'PRN ' + this.formatCurrency(currency, amount)
  }

  convertAndRoundUpAndFormatPRNToCurrency(currency, amount) {
    return this.formatCurrency(currency, this.roundUpByMagnitude(this.convertPRNToCurrency(currency, amount)));
  }

  formatSecondsToDhm2(seconds) {
    seconds = Number(seconds);
    var d = Math.floor(seconds / (3600 * 24));
    var h = Math.floor((seconds % (3600 * 24)) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var dDisplay = d > 0 ? d + "d " : "";
    var hDisplay = h > 0 ? h + "h " : "";
    var mDisplay = m >= 0 && d == 0 ? m + "m " : "";
    return dDisplay + hDisplay + mDisplay;
  }

  formatSecondsToDhm1(seconds) {
    seconds = Number(seconds);
    var d = Math.floor(seconds / (3600 * 24));
    var h = Math.floor((seconds % (3600 * 24)) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var dDisplay = d > 0 ? d + "d " : "";
    var hDisplay = h > 0 && d == 0 ? h + "h " : "";
    var mDisplay = m >= 0 && d == 0 && h == 0 ? m + "m " : "";
    return dDisplay + hDisplay + mDisplay;
  }

  newId(): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let autoId = "";
    for (let i = 0; i < 20; i++) {
      autoId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return autoId;
  }

  logout(){
    this.afAuth.signOut().then(() => {
      // Recharge la page pour vider la mémoire et garantir l'état "non connecté"
      window.location.href = '/';
    });
  }

  openWindow(url){
    event.stopPropagation()
    window.open(url,'_blank')
  }

  showFullScreenImage(src) {
    const fullScreenImage=document.getElementById('fullScreenImage') as HTMLImageElement
    fullScreenImage.src=src
    fullScreenImage.style.visibility='visible'
  }

  fieldShowHide(effect:string){
    let visibility:string;
    let outlinedEyeStyle:string;
    let fullEyeStyle:string;
    let focus:string;
    if (effect === "show") {
      visibility = "text";
      outlinedEyeStyle ="display:none";
      fullEyeStyle ="display:block";
      focus = "border-style:solid; border-width: 1px; border-color:#757566;"
    }
    else if (effect === "hide") {
      visibility = "password";
      outlinedEyeStyle ="display:block";
      fullEyeStyle ="display:none";
      focus = ""
    }
    return [visibility, outlinedEyeStyle, fullEyeStyle, focus];
  }

  /**
   * Rounds a number UP based on its magnitude:
   * < 100    → nearest 1
   * < 1,000  → nearest 10
   * < 10,000 → nearest 100
   * < 100,000 → nearest 1,000
   * etc.
   */
  roundUpByMagnitude(value: number): number {
    if (value <= 0) return 0;

    const absValue = Math.abs(value);

    // Determine magnitude (10^(digits - 2))
    const digits = Math.floor(Math.log10(absValue)) + 1;
    const step = Math.pow(10, Math.max(0, digits - 2));

    return Math.ceil(value / step) * step;
  }

  handleChatImageError(event: Event, message: any) {
    const img = event.target as HTMLImageElement;
    // Add a class to visually mark it
    img.classList.add('image-fallback');
    // Fallback to Original URL
    if (message?.chatImageUrlOriginal) img.src = message.chatImageUrlOriginal
  }

  handleUserImageError(event: Event, message: any) {
    const img = event.target as HTMLImageElement;
    // Add a class to visually mark it
    img.classList.add('image-fallback');
    // Fallback to Original URL
    if (message?.imageUrlOriginal) img.src = message.imageUrlOriginal
  }

}
