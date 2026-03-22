// README - Begin here

# QueryVault
QueryVault is a Salesforce app that gives your team one place to store, find, and reuse SOQL queries.

## What it does
You can save queries with a name, description, object, and SOQL. Every query gets validated before it can be saved. Anyone on the team can find and copy a query in seconds.

## How to find and copy a query
Open the Query Library tab. Search by name or filter by Salesforce object. Click View SOQL on any row to see the full query. Hit Copy SOQL to copy it to your clipboard.

## How to create a query

Open the Query Editor tab. Fill in the name, description, object, and SOQL. Click Validate SOQL first. Once it passes, Save Query becomes available.

## How validation works

When you click Validate SOQL the app sends your query to Salesforce and runs it with a cap of 5 rows. If the query has syntax errors you will see the exact error message. You cannot save until validation passes.

## Rules and limits

Queries must start with SELECT and must include a LIMIT clause. The following are not allowed: FOR UPDATE, ALL ROWS, WITH SYSTEM MODE, WITH USER MODE. Validation always caps execution at 5 rows regardless of your LIMIT value.

## Seed data

Sample records were loaded using the Salesforce Data Import Wizard from the provided Excel file. To reload them open Setup, go to Data Import Wizard, select UsefulQuery__c, and upload the file mapping Name, SObjectAPIName__c, SOQLField__c, and DescriptionField__c to their matching fields.