import { Injectable } from '@angular/core';
import { UserInterfaceService } from '../userInterface.service';
import { ProfileRecord } from './profileModel';
@Injectable({ providedIn: 'root' })
export class ProfileActionsService {
    constructor(private UI: UserInterfaceService) { }
    // Existing contract-specific identity; this is not the shared admin role.
    canSign(profile: ProfileRecord) {
        return !!profile.contract?.createdTimestamp && !profile.contract?.signed && this.UI.currentUser === 'QYm5NATKa6MGD87UpNZCTl6IolX2';
    }
    sign(profile: ProfileRecord) {
        if (!this.canSign(profile))
            return;
        return this.UI.createMessage({ chain: profile.user, text: 'Contract signature for level ' + (profile.contract?.level || 0),
            contractSignature: { user: profile.user, contract: profile.contract || {} } });
    }
    async startChat(profile: ProfileRecord) {
        if (!this.UI.currentUser || !profile.user || profile.user === this.UI.currentUser)
            return null;
        const chain = this.UI.newId();
        await this.UI.createMessage({ text: 'Starting a new chat.', chain, recipientList: [profile.user] });
        return chain;
    }
}
