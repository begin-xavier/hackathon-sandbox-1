import { LightningElement, api, track, wire } from 'lwc';
import { createRecord, updateRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import validateSOQL from '@salesforce/apex/SoqlValidator.validateSoql';
import getSObjectNames from '@salesforce/apex/SoqlValidator.getSObjectNames';
import { publish, MessageContext } from 'lightning/messageService';
import QUERY_SAVED_CHANNEL from '@salesforce/messageChannel/QuerySaved__c';

const OBJECT_API_NAME = 'UsefulQuery__c';

export default class QueryEditor extends LightningElement {
    @api recordId;
    @wire(MessageContext)
    messageContext;

    @track name           = '';
    @track description    = '';
    @track sObjectApiName = '';
    @track soql          = '';

    @track isValidated     = false;
    @track validationError = '';
    @track isValidating    = false;

    @track sObjectOptions = [];
    @track sObjectsLoaded = false;

    @wire(getSObjectNames)
    wiredSObjects({ error, data }) {
        if (data) {
            this.sObjectOptions = data.map(name => ({
                label: name,
                value: name
            }));
            this.sObjectsLoaded = true;
        } else if (error) {
            console.error('Failed to load SObjects:', error);
            this.sObjectsLoaded = true;
        }
    }
    get isSaveDisabled() {
        return !this.isValidated;
    }

    handleChange(event) {
        const field = event.target.dataset.field;
        this[field] = event.target.value;
        if (field === 'soql') {
            this.isValidated = false;
            this.validationError = '';
        }
    }
    handleSObjectChange(event) {
    this.sObjectApiName = event.detail.value;
    this.isValidated = false;
    this.validationError = '';
    }

    async handleValidate() {
    if (!this.soql.trim()) {
        this.validationError = 'Enter a SOQL query before validating.';
        return;
    }

    this.isValidating = true;
    this.validationError = '';
    this.isValidated = false;

    try {
        const result = await validateSOQL({ queryString: this.soql });
        if (result.isValid) {
            this.isValidated = true;
            this.validationError = '';
        } else {
            this.isValidated = false;
            this.validationError = result.errorMessage;
        }
    } catch (error) {
        this.validationError = error.body?.message || 'Validation failed.';
    } finally {
        this.isValidating = false;
    }
    }

    async handleSave() {
        const fields = {
            Name:                this.name,
            DescriptionField__c:      this.description,
            SObjectAPIName__c:   this.sObjectApiName,
            SOQLField__c:             this.soql,
        };

        try {
            if (this.recordId) {
                await updateRecord({ fields: { Id: this.recordId, ...fields } });
            } else {
                const result = await createRecord({ apiName: OBJECT_API_NAME, fields });
                this.recordId = result.id;
            }
            this.dispatchEvent(new ShowToastEvent({
                title: 'Success',
                message: 'Query saved successfully.',
                variant: 'success'
            })); publish(this.messageContext, QUERY_SAVED_CHANNEL, { saved: true });
            this.resetForm();
        } catch (error) {
            console.log('Save error:', JSON.stringify(error));
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error saving record',
                message: error.body?.message || error.body?.output?.errors?.[0]?.message || 'Unknown error',
                variant: 'error'
    }));
    }}
    get isLoadingObjects() {
    return !this.sObjectsLoaded;
    }
    resetForm() {
        this.name           = '';
        this.description    = '';
        this.soql           = '';
        this.sObjectApiName = '';
        this.isValidated    = false;
        this.validationError = '';
        this.recordId       = null;
    }
}