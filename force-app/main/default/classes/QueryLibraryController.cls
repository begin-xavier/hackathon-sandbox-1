public with sharing class QueryLibraryController {

    // gets a page of query records from the database
    // takes page size, how many to skip, search text, object filter, sort field, and sort direction
    @AuraEnabled
    public static List<UsefulQuery__c> getPagedQueryRecords(Integer pageSize, Integer pageOffset, String searchTerm, String sObjectFilter, String sortField, String sortDirection) {
        
        // start with a base query that gets all records
        String query = 'SELECT Id, Name, SObjectAPIName__c, DescriptionField__c, LastModifiedDate FROM UsefulQuery__c WHERE Id != null';
        
        // if the user picked an object to filter by, add that to the query
        if (String.isNotBlank(sObjectFilter)) {
            query += ' AND SObjectAPIName__c = :sObjectFilter';
        }
        
        // if the user typed something in the search box, add that to the query
        // the percent signs mean match anything before or after the search text
        if (String.isNotBlank(searchTerm)) {
            searchTerm = '%' + searchTerm + '%';
            query += ' AND Name LIKE :searchTerm';
        }

        // only allow sorting by these three fields so nobody can inject bad code
        String safeSort = 'LastModifiedDate';
        List<String> allowedFields = new List<String>{'Name', 'SObjectAPIName__c', 'LastModifiedDate'};
        if (String.isNotBlank(sortField) && allowedFields.contains(sortField)) {
            safeSort = sortField;
        }
        
        // set the sort direction to ascending or descending
        String safeDir = sortDirection == 'desc' ? 'DESC' : 'ASC';
        
        // add the sort, limit, and offset to the end of the query
        // limit controls how many records come back per page
        // offset controls how many records to skip for pagination
        query += ' ORDER BY ' + safeSort + ' ' + safeDir + ' LIMIT :pageSize OFFSET :pageOffset';

        return Database.query(query);
    }

    // gets one full record by its id including the soql field
    @AuraEnabled
    public static UsefulQuery__c getQueryById(Id recordId) {
        return [
            SELECT Id, Name, SObjectAPIName__c, DescriptionField__c, SOQLField__c, LastModifiedDate
            FROM   UsefulQuery__c
            WHERE  Id = :recordId
            LIMIT  1
        ];
    }

    // gets a list of all the unique object names that exist in saved queries
    // used to populate the filter dropdown in the library
    @AuraEnabled(cacheable=true)
    public static List<String> getSObjectOptions() {
        List<String> options = new List<String>();
        for (AggregateResult ar : [
            SELECT SObjectAPIName__c
            FROM   UsefulQuery__c
            WHERE  SObjectAPIName__c != null
            GROUP BY SObjectAPIName__c
            ORDER BY SObjectAPIName__c ASC
        ]) {
            options.add((String) ar.get('SObjectAPIName__c'));
        }
        return options;
    }

    // deletes a single query record by its id
    @AuraEnabled
    public static void deleteQuery(Id recordId) {
        UsefulQuery__c record = [SELECT Id FROM UsefulQuery__c WHERE Id = :recordId LIMIT 1];
        delete record;
    }

    // counts how many records match the current search and filter
    // used to calculate how many pages there are
    @AuraEnabled
    public static Integer getQueryCount(String searchTerm, String sObjectFilter) {
        String query = 'SELECT COUNT() FROM UsefulQuery__c WHERE Id != null';
        
        // add the same filters as the main query so the count matches
        if (String.isNotBlank(sObjectFilter)) {
            query += ' AND SObjectAPIName__c = :sObjectFilter';
        }
        if (String.isNotBlank(searchTerm)) {
            searchTerm = '%' + searchTerm + '%';
            query += ' AND Name LIKE :searchTerm';
        }
        
        return Database.countQuery(query);
    }

}