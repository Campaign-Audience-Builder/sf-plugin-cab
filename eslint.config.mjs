import salesforce from 'eslint-config-salesforce-typescript';

export default [
  ...salesforce,
  {
    // This plugin is not a Salesforce project, so the Salesforce copyright header does not apply.
    rules: { 'header/header': 'off' },
  },
];
