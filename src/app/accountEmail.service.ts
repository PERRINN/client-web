import { Injectable, OnDestroy } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import { Subscription } from 'rxjs';

/** Settings-scoped Auth workflow. Addresses and credentials never enter Firestore. */
@Injectable()
export class AccountEmailService implements OnDestroy {
  address = '';
  currentAddress = '';
  password = '';
  needsPassword = false;
  busy = false;
  sent = false;
  error = '';
  private uid: string | null = null;
  private revision = 0;
  private destroyed = false;
  private refreshing = false;
  private verificationPending = false;
  private subscription: Subscription;

  constructor(private auth: AngularFireAuth) {
    this.subscription = this.auth.user.subscribe({
      next: user => this.sync(user),
      error: () => { this.sync(null); this.error = 'Sign in again.'; }
    });
  }

  get canSend(): boolean {
    return !!this.uid && !this.busy && !this.sent && this.validAddress(this.address)
      && this.address.trim() !== this.currentAddress && (!this.needsPassword || !!this.password);
  }

  get status(): string {
    if (this.error) return this.error;
    if (this.busy) return 'Sending…';
    if (this.sent) return 'Verification email sent.';
    if (this.needsPassword) return 'Confirm your current password.';
    return this.uid ? 'Verify the new address by email.' : 'Sign in to change your email.';
  }

  edit(): void {
    this.sent = false;
    this.error = '';
  }

  cancel(): void {
    if (this.busy) return;
    this.revision++;
    this.address = this.currentAddress;
    this.password = '';
    this.needsPassword = this.sent = false;
    this.error = '';
  }

  async send(): Promise<void> {
    if (!this.canSend) return;
    const revision = this.revision, uid = this.uid, address = this.address.trim();
    const password = this.password;
    this.password = '';
    this.busy = true;
    this.error = '';
    try {
      const user = await this.auth.currentUser;
      if (!this.active(revision) || !user || user.uid !== uid) return;
      if (this.needsPassword) {
        if (!user.email) { this.error = 'Sign in again.'; return; }
        await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
        if (!this.active(revision) || (await this.auth.currentUser)?.uid !== uid) return;
      }
      await user.verifyBeforeUpdateEmail(address);
      if (this.active(revision)) {
        this.sent = true;
        this.verificationPending = true;
        this.needsPassword = false;
      }
    } catch (error: unknown) {
      if (!this.active(revision)) return;
      const code = (error as { code?: string })?.code;
      if (code === 'auth/requires-recent-login') {
        this.needsPassword = true;
      } else {
        const messages: Record<string, string> = {
          'auth/invalid-email': 'Enter a valid email address.',
          'auth/email-already-in-use': 'Email unavailable. Try another.',
          'auth/wrong-password': 'Incorrect password. Try again.',
          'auth/invalid-credential': 'Incorrect password. Try again.',
          'auth/too-many-requests': 'Too many attempts. Try later.',
          'auth/network-request-failed': 'Connection failed. Try again.',
          'auth/user-disabled': 'Sign in again.',
          'auth/user-token-expired': 'Sign in again.'
        };
        this.error = messages[code || ''] || 'Couldn’t send. Try again.';
      }
    } finally {
      if (this.active(revision)) this.busy = false;
    }
  }

  /** One Auth reload on returning to Settings after a verification request. */
  async refresh(): Promise<void> {
    if (!this.verificationPending || this.busy || this.refreshing || this.destroyed) return;
    const revision = this.revision, uid = this.uid;
    this.refreshing = true;
    try {
      const user = await this.auth.currentUser;
      if (!this.active(revision) || !user || user.uid !== uid) return;
      await user.reload();
      if (this.active(revision) && (await this.auth.currentUser)?.uid === uid) this.sync(user);
    } catch {
      if (this.active(revision)) this.error = 'Sign in to refresh your email.';
    } finally { this.refreshing = false; }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.revision++;
    this.password = this.address = this.currentAddress = '';
    this.subscription.unsubscribe();
  }

  private active(revision: number): boolean { return !this.destroyed && revision === this.revision; }

  private sync(user: firebase.User | null): void {
    if (this.destroyed) return;
    const uid = user?.uid || null, email = user?.email || '';
    if (uid !== this.uid || email !== this.currentAddress) {
      this.revision++;
      this.uid = uid;
      this.address = this.currentAddress = email;
      this.password = this.error = '';
      this.needsPassword = this.busy = this.sent = false;
      this.verificationPending = false;
    }
  }

  private validAddress(address: string): boolean {
    return address.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim());
  }
}
