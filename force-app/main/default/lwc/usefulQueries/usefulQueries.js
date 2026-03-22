import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class UsefulQueries extends LightningElement {
    connectedCallback() {
        this.showToast('Welcome to QueryVault', 'Browse existing queries or create a new one to get started.', 'info');
    }

    showToast(title, message, variant, isPersistent = false) {
        this.dispatchEvent(
            new ShowToastEvent({
                title: title,
                message: message,
                variant: variant,
                mode: isPersistent ? 'sticky' : 'dismissible'
            })
        );
    }
}