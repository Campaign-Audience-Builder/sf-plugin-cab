import salesforce from 'eslint-config-salesforce-typescript';

export default [
  ...salesforce,
  {
    // This plugin is not a Salesforce project, so the Salesforce copyright header does not apply.
    rules: { 'header/header': 'off' },
  },
  {
    // Salesforce API names such as Audience__c are not camel case.
    rules: { camelcase: 'off' },
  },
  {
    // The import and plan steps are long sequences of plain checks. A limit of 30 keeps them readable.
    rules: { complexity: ['error', 30] },
  },
];
