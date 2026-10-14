// Seeds test audiences for the end-to-end tests of sf-plugin-cab.
// Run it in a namespaced CAB scratch org (source deploy of the cab repo):
//   sf apex run --file test/e2e/seed-audiences.apex -o <alias>
// It uses CAB's own creation code, so the records look like records that the UI creates.

AgentModels.FieldFilter filter(Integer index, String field, String op, Object value) {
    AgentModels.FieldFilter f = new AgentModels.FieldFilter();
    f.index = index;
    f.field_name = field;
    f.operator = op;
    f.value = value;
    return f;
}

AgentModels.FlatNode node(String id, String parentId, String objectName, String type) {
    AgentModels.FlatNode n = new AgentModels.FlatNode();
    n.id = id;
    n.parent_id = parentId;
    n.object_name = objectName;
    n.type = type;
    return n;
}

lb__AudienceFolder__c marketing = new lb__AudienceFolder__c(lb__UniqueName__c = 'Marketing');
insert marketing;
lb__AudienceFolder__c emea = new lb__AudienceFolder__c(lb__UniqueName__c = 'EMEA', lb__ParentFolder__c = marketing.Id);
insert emea;
lb__AudienceFolder__c q4 = new lb__AudienceFolder__c(lb__UniqueName__c = 'Q4 Campaigns', lb__ParentFolder__c = emea.Id);
insert q4;

AudienceConfigurationConverter converter = new AudienceConfigurationConverter();

// Leads DE: Contact with two filters and a child Case node.
AgentModels.AudienceConfiguration de = new AgentModels.AudienceConfiguration();
de.target_object = 'Contact';
AgentModels.FlatNode deRoot = node('r', null, 'Contact', 'PARENT');
deRoot.field_filters.add(filter(1, 'MailingCountry', 'EQUALS', 'DE'));
deRoot.field_filters.add(filter(2, 'LastName', 'NOT_EQUALS', 'Test'));
AgentModels.FlatNode deCase = node('c', 'r', 'Case', 'CHILD');
deCase.lookup_field = 'ContactId';
deCase.quantifier = 'WITH';
deCase.field_filters.add(filter(1, 'Status', 'EQUALS', 'New'));
de.nodes = new List<AgentModels.FlatNode>{ deRoot, deCase };
Id deId = converter.convertAndSave(de, 'Leads DE', emea.Id).audienceId;

// Leads AT: Contact with one filter.
AgentModels.AudienceConfiguration at = new AgentModels.AudienceConfiguration();
at.target_object = 'Contact';
AgentModels.FlatNode atRoot = node('r', null, 'Contact', 'PARENT');
atRoot.field_filters.add(filter(1, 'MailingCountry', 'EQUALS', 'AT'));
at.nodes = new List<AgentModels.FlatNode>{ atRoot };
Id atId = converter.convertAndSave(at, 'Leads AT', q4.Id).audienceId;

// High Value Accounts: Account with an aggregate on Opportunity.
AgentModels.AudienceConfiguration hv = new AgentModels.AudienceConfiguration();
hv.target_object = 'Account';
AgentModels.FlatNode hvRoot = node('r', null, 'Account', 'PARENT');
hvRoot.field_filters.add(filter(1, 'Industry', 'EQUALS', 'Banking'));
AgentModels.FlatNode hvAgg = node('a', 'r', 'Opportunity', 'AGGREGATE');
hvAgg.lookup_field = 'AccountId';
hvAgg.quantifier = 'WITH';
hvAgg.agg_function = 'SUM';
hvAgg.agg_field = 'Amount';
hvAgg.agg_operator = 'GT';
hvAgg.agg_value = 10000;
hv.nodes = new List<AgentModels.FlatNode>{ hvRoot, hvAgg };
converter.convertAndSave(hv, 'High Value Accounts', marketing.Id);

// Owner Filter: a filter value that is a record Id (D11 warning).
AgentModels.AudienceConfiguration ow = new AgentModels.AudienceConfiguration();
ow.target_object = 'Contact';
AgentModels.FlatNode owRoot = node('r', null, 'Contact', 'PARENT');
owRoot.field_filters.add(filter(1, 'OwnerId', 'EQUALS', UserInfo.getUserId()));
ow.nodes = new List<AgentModels.FlatNode>{ owRoot };
converter.convertAndSave(ow, 'Owner Filter', null);

// No Key: an audience without an API name.
AgentModels.AudienceConfiguration nk = new AgentModels.AudienceConfiguration();
nk.target_object = 'Contact';
AgentModels.FlatNode nkRoot = node('r', null, 'Contact', 'PARENT');
nkRoot.field_filters.add(filter(1, 'Email', 'CONTAINS', '@example.com'));
nk.nodes = new List<AgentModels.FlatNode>{ nkRoot };
Id nkId = converter.convertAndSave(nk, 'No Key', null).audienceId;
update new lb__Audience__c(Id = nkId, lb__AudienceAPIName__c = null);

// Q4 Waterfall: a sequence of Leads DE and Leads AT, as AudienceOverlapController creates it.
lb__Audience__c seq = new lb__Audience__c(Name = 'Q4 Waterfall', lb__AudienceAPIName__c = 'Q4_Waterfall', lb__Type__c = 'Waterfall', lb__InitialObject__c = 'Contact', lb__Sharing__c = 'Public', lb__AudienceFolder__c = q4.Id);
insert seq;
lb__AudienceVersion__c seqVersion = new lb__AudienceVersion__c(lb__Audience__c = seq.Id, lb__VersionNumber__c = 1);
insert seqVersion;
seq.lb__LatestVersion__c = seqVersion.Id;
update seq;
insert new lb__AudienceFilterObject__c(lb__AudienceVersion__c = seqVersion.Id, lb__IsInitial__c = true, lb__FilterLogic__c = 'all', lb__SObjectName__c = 'Contact');
AudienceSequenceComponentController.createSequenceComponent(seq.Id, deId, 1, null);
AudienceSequenceComponentController.createSequenceComponent(seq.Id, atId, 2, 'Exclusion');
System.debug('Seeded 6 audiences');
