public with sharing class SoqlValidator {

    // the max number of rows we allow during validation so we dont pull too much data
    private static final Integer VALIDATION_LIMIT = 5;

    // list of dangerous clauses that we block from being saved
    private static final List<String> INVALIDATED_FIELDS = new List<String>{
        'FOR UPDATE',
        'ALL ROWS',
        'WITH SYSTEM_MODE',
        'WITH USER_MODE'
    };

    // this is the object we send back after validation
    // it tells the ui if the query passed or failed and why
    public class ValidationResult {
        @AuraEnabled public Boolean isValid;
        @AuraEnabled public String errorMessage;
        @AuraEnabled public String Query;

        public ValidationResult(Boolean isValid, String errorMessage, String Query) {
            this.isValid = isValid;
            this.errorMessage = errorMessage;
            this.Query = Query;
        }
    }

    // checks if a soql query is safe and valid before letting the user save it
    @AuraEnabled
    public static ValidationResult validateSoql(String queryString) {

        // reject blank queries right away
        if (String.isBlank(queryString)) {
            return new ValidationResult(false, 'Query cannot be blank.', null);
        }

        String trimmed = queryString.trim();

        // reject anything that doesnt start with select
        if (!trimmed.toUpperCase().startsWith('SELECT')) {
            return new ValidationResult(false, 'Query must begin with SELECT.', null);
        }

        // check for any blocked clauses and reject if found
        String upperQuery = trimmed.toUpperCase();
        for (String pattern : INVALIDATED_FIELDS) {
            if (upperQuery.contains(pattern)) {
                return new ValidationResult(false, 'Query cannot contain: ' + pattern + ', Remove and try again.', null);
            }
        }

        // look for a limit clause in the query
        String safeQuery;
        Pattern limitPattern = Pattern.compile('(?i)\\bLIMIT\\s+(\\d+)');
        Matcher limitMatcher = limitPattern.matcher(trimmed);

        if (limitMatcher.find()) {
            // if there is a limit, cap it at our max so we dont pull too many rows
            Integer existingLimit = Integer.valueOf(limitMatcher.group(1));
            Integer capLimit = Math.min(existingLimit, VALIDATION_LIMIT);
            safeQuery = trimmed.replaceAll('(?i)\\bLIMIT\\s+\\d+', 'LIMIT ' + capLimit);
        } else {
            // reject queries that have no limit at all
            return new ValidationResult(false, 'Query must include a LIMIT clause.', null);
        }

        // actually run the query to check for any syntax errors
        // if it throws an error we catch it and send back the message
        try {
            List<SObject> results = Database.query(safeQuery);
            return new ValidationResult(true, 'Query is valid. Returned ' + results.size() + ' records (capped at ' + VALIDATION_LIMIT + ').', safeQuery);
        } catch (QueryException e) {
            return new ValidationResult(false, 'SOQL Error: ' + e.getMessage(), null);
        } catch (Exception e) {
            return new ValidationResult(false, 'Unexpected Error: ' + e.getMessage(), null);
        }
    }

    // saves a new query record to the database
    // returns the id of the newly created record
    @AuraEnabled
    public static String saveQuery(String name, String description, String soqlQuery, String sObjectApiName) {
        UsefulQuery__c record = new UsefulQuery__c();
        record.Name = name;
        record.DescriptionField__c = description;
        record.SOQLField__c = soqlQuery;
        record.SObjectAPIName__c = sObjectApiName;
        insert record;
        return record.Id;
    }

    // gets all sobject api names from the org
    // used to populate the object picker dropdown in the editor
    @AuraEnabled(cacheable=true)
    public static List<String> getSObjectNames() {
        List<String> names = new List<String>();
        for (Schema.SObjectType t : Schema.getGlobalDescribe().values()) {
            names.add(t.getDescribe().getName());
        }
        names.sort();
        return names;
    }
@AuraEnabled
public static List<SObject> previewQuery(String queryString) {
    if (String.isBlank(queryString)) {
        throw new AuraHandledException('Query cannot be blank.');
    }
    String trimmed = queryString.trim();
    
    // reuse same safety checks
    if (!trimmed.toUpperCase().startsWith('SELECT')) {
        throw new AuraHandledException('Query must begin with SELECT.');
    }
    
    // cap at 5 rows for safety
    Pattern limitPattern = Pattern.compile('(?i)\\bLIMIT\\s+(\\d+)');
    Matcher limitMatcher = limitPattern.matcher(trimmed);
    String safeQuery;
    if (limitMatcher.find()) {
        Integer capLimit = Math.min(Integer.valueOf(limitMatcher.group(1)), 5);
        safeQuery = trimmed.replaceAll('(?i)\\bLIMIT\\s+\\d+', 'LIMIT ' + capLimit);
    } else {
        throw new AuraHandledException('Query must include a LIMIT clause.');
    }
    
    try {
        return Database.query(safeQuery);
    } catch (Exception e) {
        throw new AuraHandledException('SOQL Error: ' + e.getMessage());
    }
}
}