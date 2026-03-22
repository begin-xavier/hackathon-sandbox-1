import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import getPagedQueryRecords from '@salesforce/apex/QueryLibraryController.getPagedQueryRecords';
import getQueryCount        from '@salesforce/apex/QueryLibraryController.getQueryCount';
import getQueryById         from '@salesforce/apex/QueryLibraryController.getQueryById';
import getSObjectOptions    from '@salesforce/apex/QueryLibraryController.getSObjectOptions';
import validateSoql         from '@salesforce/apex/SoqlValidator.validateSoql';
import { subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import QUERY_SAVED_CHANNEL  from '@salesforce/messageChannel/QuerySaved__c';
import deleteQuery          from '@salesforce/apex/QueryLibraryController.deleteQuery';
import { updateRecord }     from 'lightning/uiRecordApi';
import previewQuery         from '@salesforce/apex/SoqlValidator.previewQuery';
import trackUsage from '@salesforce/apex/QueryLibraryController.trackUsage';

// how long to wait after the user stops typing before searching
const DEBOUNCE_DELAY = 300;

// defines the columns shown in the main table
const COLUMNS = [
    { label: 'Name',        fieldName: 'Name',               type: 'text', sortable: true },
    { label: 'SObject',     fieldName: 'SObjectAPIName__c',  type: 'text', sortable: true },
    { label: 'Description', fieldName: 'DescriptionField__c',type: 'text', wrapText: false },
    {
        label: 'Last Modified',
        fieldName: 'LastModifiedDate',
        type: 'date',
        sortable: true,
        typeAttributes: {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }
    },
    {
        type: 'action',
        typeAttributes: {
            rowActions: [
                { label: 'View SOQL', name: 'view_soql', iconName: 'utility:code' },
                { label: 'Copy SOQL', name: 'copy_soql', iconName: 'utility:copy' },
                { label: 'Edit',      name: 'edit',      iconName: 'utility:edit' },
                { label: 'Delete',    name: 'delete',    iconName: 'utility:delete' }
    ]
        }
    }
];

export default class BrowseAndFind extends NavigationMixin(LightningElement) {

    // rows currently shown in the table
    @track displayedRows   = [];
    // options for the sobject filter dropdown
    @track sobjectOptions  = [];

    // loading and error state for the main table
    @track isLoading      = false;
    @track isLoadingSoql  = false;
    @track hasError       = false;
    @track errorMessage   = '';

    // page size tracker
    @track pageSize = 10;

    // controls whether the view modal is open and which record is selected
    @track isModalOpen      = false;
    @track selectedRecord   = {};

    // total number of records matching the current search and filter
    @track totalRecordCount = 0;

    // validation state for the view modal
    @track isValidating     = false;
    @track validationResult = null;
    @track showValidation   = false;

    // delete confirmation state
    @track isDeleting        = false;
    @track showDeleteConfirm = false;

    // wire gives this component access to the message service
    @wire(MessageContext)
    messageContext;

    // edit modal state
    @track isEditModalOpen     = false;
    @track editRecord          = {};
    @track editIsValidated     = false;
    @track editValidationError = '';
    @track editIsValidating    = false;

    // preview modal state
    @track previewRows      = [];
    @track previewColumns   = [];
    @track isPreviewOpen    = false;
    @track isPreviewLoading = false;
    @track previewError     = '';

    // grouped sObject variable
    @track isGroupedView = false;

    // current search and filter values
    searchTerm      = '';
    selectedSObject = '';
    sortedBy        = 'Name';
    sortedDirection = 'asc';
    currentPage     = 1;
    columns         = COLUMNS;

    _searchDebounceTimer = null;

    // runs when the component loads
    // loads the sobject options, the first page of queries, and subscribes to the message channel
    connectedCallback() {
        this.loadSObjectOptions();
        this.loadQueries();
        this.subscription = subscribe(
            this.messageContext,
            QUERY_SAVED_CHANNEL,
            () => this.loadQueries()
        );
    }

    // runs when the component is removed from the page
    // clears the search timer and unsubscribes from the message channel
    disconnectedCallback() {
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
        }
        unsubscribe(this.subscription);
    }

    // fetches one page of records from the database using the current filters and sort
    loadQueries() {
        this.isLoading = true;
        this.hasError  = false;

        const params = {
            pageSize:      this.pageSize,
            pageOffset:    (this.currentPage - 1) * this.pageSize,
            searchTerm:    this.searchTerm      || '',
            sObjectFilter: this.selectedSObject || '',
            sortField:     this.sortedBy        || 'LastModifiedDate',
            sortDirection: this.sortedDirection || 'desc'
        };

        getPagedQueryRecords(params)
            .then(data => {
                this.displayedRows = data || [];
            })
            .catch(error => {
                this.hasError     = true;
                this.errorMessage = this._extractError(error);
            })
            .finally(() => {
                this.isLoading = false;
            });

        // also fetch the total count so we know how many pages there are
        getQueryCount({
            searchTerm:    this.searchTerm      || '',
            sObjectFilter: this.selectedSObject || ''
        })
            .then(count => {
                this.totalRecordCount = count;
            })
            .catch(() => {
                this.totalRecordCount = 0;
            });
    }

    // loads the list of sobject names that exist in saved queries
    // used to populate the filter dropdown
    loadSObjectOptions() {
        getSObjectOptions()
            .then(data => {
                const all  = [{ label: '— All SObjects —', value: '' }];
                const rest = (data || []).map(s => ({ label: s, value: s }));
                this.sobjectOptions = [...all, ...rest];
            })
            .catch(() => {
                this.sobjectOptions = [];
            });
    }

    // loads the full record including the soql field when the user opens the view modal
    loadFullRecord(recordId) {
        this.isLoadingSoql = true;
        getQueryById({ recordId })
            .then(data => {
                this.selectedRecord = { ...this.selectedRecord, ...data };
            })
            .catch(error => {
                this.selectedRecord = {
                    ...this.selectedRecord,
                    SOQLField__c: `Error loading SOQL: ${this._extractError(error)}`
                };
            })
            .finally(() => {
                this.isLoadingSoql = false;
            });
    }

    // resets to page 1 and reloads when filters or sort change
    applyFiltersAndSort() {
        this.currentPage = 1;
        this.loadQueries();
    }

    // handles column header clicks to sort the table
    handleSort(event) {
        const { fieldName, sortDirection } = event.detail;
        this.sortedBy        = fieldName;
        this.sortedDirection = sortDirection;
        this.currentPage     = 1;
        this.loadQueries();
    }

    // handles the search input with a short delay so we dont call apex on every keystroke
    handleSearchChange(event) {
        const value = event.target.value;
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
        }
        this._searchDebounceTimer = setTimeout(() => {
            this.searchTerm = value;
            this.applyFiltersAndSort();
        }, DEBOUNCE_DELAY);
    }

    // handles the sobject filter dropdown change
    handleSObjectChange(event) {
        this.selectedSObject = event.detail.value;
        this.applyFiltersAndSort();
    }

    // goes to the previous page
    goToPrevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadQueries();
        }
    }

    // goes to the next page
    goToNextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.loadQueries();
        }
    }

    // handles row action clicks from the datatable
    handleRowAction(event) {
    const { name } = event.detail.action;
    const row      = event.detail.row;

    if (name === 'view_soql') {
        this.openModal(row);
    } else if (name === 'copy_soql') {
        this.loadFullRecord(row.Id);
        setTimeout(() => {
            this._copyToClipboard(this.selectedRecord.SOQLField__c || '');
        }, 1000);
    } else if (name === 'edit') {
        this.selectedRecord      = { ...row };
        this.editIsValidated     = false;
        this.editValidationError = '';
        this.isEditModalOpen     = false;

        getQueryById({ recordId: row.Id })
            .then(data => {
                this.editRecord = {
                    Id:                  data.Id,
                    Name:                data.Name,
                    DescriptionField__c: data.DescriptionField__c,
                    SObjectAPIName__c:   data.SObjectAPIName__c,
                    SOQLField__c:        data.SOQLField__c
                };
                this.isEditModalOpen = true;
            })
            .catch(error => {
                this._toast('Error', this._extractError(error), 'error');
        });
    } else if (name === 'delete') {
        this.selectedRecord = { ...row };
        this.showDeleteConfirm = true;
        this.isModalOpen = true;
        }
    }

    // opens the view modal and loads the full record
    openModal(row) {
        this.selectedRecord    = { ...row };
        this.isModalOpen       = true;
        this.validationResult  = null;
        this.showValidation    = false;
        this.showDeleteConfirm = false;
        this.loadFullRecord(row.Id);
        trackUsage({ recordId: row.Id });
    }

    // closes the view modal and refreshes the table
    closeModal() {
    this.isModalOpen       = false;
    this.selectedRecord    = {};
    this.validationResult  = null;
    this.showValidation    = false;
    this.showDeleteConfirm = false;
    this.isPreviewOpen     = false;
    this.previewRows       = [];
    this.previewColumns    = [];
    this.previewError      = '';
    this.loadQueries();
    }

    // copies the soql text to the clipboard
    copySoql() {
        this._copyToClipboard(this.selectedRecord.SOQLField__c || '');
        this._toast('Copied', 'SOQL copied to clipboard.', 'success');
        trackUsage({ recordId: this.selectedRecord.Id });
    }

    // handles changes to any field in the edit modal
    // resets validation whenever something changes
    handleEditFieldChange(event) {
        const field = event.target.dataset.field;
        const value = event.detail.value !== undefined ? event.detail.value : event.target.value;
        this.editRecord          = { ...this.editRecord, [field]: value };
        this.editIsValidated     = false;
        this.editValidationError = '';
    }

    // validates the soql in the edit modal before allowing save
    async handleEditValidate() {
        if (!this.editRecord.SOQLField__c?.trim()) {
            this.editValidationError = 'Enter a SOQL query before validating.';
            return;
        }
        this.editIsValidating    = true;
        this.editValidationError = '';
        this.editIsValidated     = false;
        try {
            const result = await validateSoql({ queryString: this.editRecord.SOQLField__c });
            if (result.isValid) {
                this.editIsValidated     = true;
                this.editValidationError = '';
            } else {
                this.editValidationError = result.errorMessage;
            }
        } catch (error) {
            this.editValidationError = error.body?.message || 'Validation failed.';
        } finally {
            this.editIsValidating = false;
        }
    }

    // saves the edited record to the database
    // only runs if soql has been validated first
    async handleEditSave() {
        if (!this.editIsValidated) {
            this._toast('Validate First', 'Validate SOQL before saving.', 'warning');
            return;
        }
        try {
            await updateRecord({
                fields: {
                    Id:                  this.editRecord.Id,
                    Name:                this.editRecord.Name,
                    DescriptionField__c: this.editRecord.DescriptionField__c,
                    SObjectAPIName__c:   this.editRecord.SObjectAPIName__c,
                    SOQLField__c:        this.editRecord.SOQLField__c
                }
            });
            this._toast('Saved', 'Query updated successfully.', 'success');
            this.isEditModalOpen = false;
            this.closeModal();
            this.loadQueries();
        } catch (error) {
            this._toast('Save Failed', error.body?.message || 'Unknown error.', 'error');
        }
    }

    // closes the edit modal and resets validation state
    handleEditCancel() {
        this.isEditModalOpen     = false;
        this.editIsValidated     = false;
        this.editValidationError = '';
    }

    // opens the edit modal with the current record pre filled
    handleEdit() {
        this.editRecord = {
            Id:                  this.selectedRecord.Id,
            Name:                this.selectedRecord.Name,
            DescriptionField__c: this.selectedRecord.DescriptionField__c,
            SObjectAPIName__c:   this.selectedRecord.SObjectAPIName__c,
            SOQLField__c:        this.selectedRecord.SOQLField__c
        };
        this.editIsValidated     = false;
        this.editValidationError = '';
        this.isEditModalOpen     = true;
    }

    // shows the delete confirmation box inside the view modal
    handleDeleteClick() {
        this.showDeleteConfirm = true;
    }

    // hides the delete confirmation box without deleting
    handleDeleteCancel() {
        this.showDeleteConfirm = false;
    }

    // deletes the record and refreshes the table
    handleDeleteConfirm() {
        this.isDeleting = true;
        deleteQuery({ recordId: this.selectedRecord.Id })
            .then(() => {
                this._toast('Deleted', `"${this.selectedRecord.Name}" has been deleted.`, 'success');
                this.closeModal();
                this.loadQueries();
            })
            .catch(error => {
                this._toast('Delete Failed', this._extractError(error), 'error');
            })
            .finally(() => {
                this.isDeleting = false;
            });
    }

    // validates the soql in the view modal without saving anything
    handleValidate() {
        const soql = this.selectedRecord.SOQLField__c;
        if (!soql) {
            this._toast('Nothing to Validate', 'SOQL body is empty or still loading.', 'warning');
            return;
        }
        this.isValidating     = true;
        this.validationResult = null;
        this.showValidation   = false;
        validateSoql({ queryString: soql })
            .then(result => {
                this.validationResult = result;
                this.showValidation   = true;
            })
            .catch(error => {
                this.validationResult = {
                    isValid:      false,
                    errorMessage: this._extractError(error),
                    Query:        null
                };
                this.showValidation = true;
            })
            .finally(() => {
                this.isValidating = false;
            });
    }

    // clears the search and filter inputs and reloads all records
    clearFilters() {
        this.searchTerm      = '';
        this.selectedSObject = '';
        const searchInput = this.template.querySelector('lightning-input[type="search"]');
        if (searchInput) searchInput.value = '';
        this.applyFiltersAndSort();
    }

    // runs the query and shows the first 5 rows in the preview modal
    handlePreview() {
        const soql = this.selectedRecord.SOQLField__c;
        if (!soql) {
            this._toast('Nothing to Preview', 'SOQL body is empty or still loading.', 'warning');
            return;
        }
        this.isPreviewLoading = true;
        this.previewError     = '';
        this.previewRows      = [];
        this.previewColumns   = [];
        this.isPreviewOpen    = true;

        previewQuery({ queryString: soql })
            .then(results => {
                if (results && results.length > 0) {
                    // build columns from the keys of the first record
                    const keys = Object.keys(results[0]).filter(k => k !== 'attributes');
                    this.previewColumns = keys.map(k => ({ label: k, fieldName: k, type: 'text' }));
                    // add a row index to each record so the datatable has a unique key
                    this.previewRows = results.map((row, index) => ({ ...row, _rowIndex: index }));
                } else {
                    this.previewError = 'Query returned no records.';
                }
            })
            .catch(error => {
                this.previewError = error.body?.message || 'Preview failed.';
            })
            .finally(() => {
                this.isPreviewLoading = false;
            });
    }

    // closes the preview modal and clears the results
    closePreview() {
        this.isPreviewOpen  = false;
        this.previewRows    = [];
        this.previewColumns = [];
        this.previewError   = '';
    }

    // total number of records matching the current search and filter
    get totalCount() {
        return this.totalRecordCount;
    }

    // number of records on the current page
    get displayedCount() {
        return this.displayedRows.length;
    }

    // total number of pages based on record count and page size
    get totalPages() {
        return Math.max(1, Math.ceil(this.totalRecordCount / this.pageSize));
    }

    // true if there are rows to show in the table
    get hasRows() {
        return this.displayedRows.length > 0;
    }

    // true if the user has typed something or picked an sobject filter
    get hasActiveFilters() {
        return !!(this.searchTerm.trim() || this.selectedSObject);
    }

    // true if we are on the first page
    get isFirstPage() {
        return this.currentPage <= 1;
    }

    // true if we are on the last page
    get isLastPage() {
        return this.currentPage >= this.totalPages;
    }

    // true if there is more than one page
    get showPagination() {
        return this.totalPages > 1;
    }

    // formats the last modified date for display in the view modal
    get formattedLastModified() {
        if (!this.selectedRecord.LastModifiedDate) return '';
        return new Date(this.selectedRecord.LastModifiedDate).toLocaleString();
    }

    // returns the right icon for the validation result
    get validationIcon() {
        if (!this.validationResult) return '';
        return this.validationResult.isValid ? 'utility:success' : 'utility:error';
    }

    // returns the validation message text
    get validationMessage() {
        if (!this.validationResult) return '';
        return this.validationResult.errorMessage;
    }

    // disables the validate button while loading or already validating
    get isValidateDisabled() {
        return this.isLoadingSoql || this.isValidating;
    }

    // disables the delete button while loading or already deleting
    get isDeleteDisabled() {
        return this.isDeleting || this.isLoadingSoql;
    }

    // disables the save button in the edit modal until soql is validated
    get isEditSaveDisabled() {
        return !this.editIsValidated || this.editIsValidating;
    }

    // true if there are preview rows to show
    get hasPreviewRows() {
        return this.previewRows.length > 0;
    }

    // gets grouped record by sobject
    get groupedRecords() {
    const groups = {};
    this.displayedRows.forEach(row => {
        const key = row.SObjectAPIName__c || 'Unknown';
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
    });
    return Object.keys(groups).sort().map(key => ({
        sObject: key,
        records: groups[key]
    }));
    }

    // copies text to the clipboard using a hidden textarea
    _copyToClipboard(text) {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity  = '0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        try {
            document.execCommand('copy');
            this.dispatchEvent(new ShowToastEvent({
                title:   'Copied',
                message: 'SOQL copied to clipboard.',
                variant: 'success'
            }));
        } catch (e) {
            this.dispatchEvent(new ShowToastEvent({
                title:   'Copy Failed',
                message: 'Could not copy to clipboard.',
                variant: 'error'
            }));
        }
        document.body.removeChild(el);
    }

    // shows a toast notification
    _toast(title, message, variant = 'info') {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    // pulls the error message out of different error formats
    _extractError(error) {
        if (error?.body?.message) return error.body.message;
        if (error?.message)       return error.message;
        return 'An unexpected error occurred.';
    }
    // handles toggling between grouped and ungrouped views
    handleToggleView() {
    this.isGroupedView = !this.isGroupedView;
    }
    get toggleViewLabel() {
    return this.isGroupedView ? 'Switch to Table View' : 'Switch to Grouped View';
    }

    get toggleViewIcon() {
    return this.isGroupedView ? 'utility:table' : 'utility:rows';
    }

    // view page size methods

    handlePageSizeChange(event) {
    this.pageSize    = parseInt(event.detail.value);
    this.currentPage = 1;
    this.loadQueries();
    }
    get pageSizeOptions() {
    return [
        { label: '5',  value: '5'  },
        { label: '10', value: '10' },
        { label: '25', value: '25' },
        { label: '50', value: '50' }
    ];
}
}