export function createComplianceExportsFixtures() {
  return {
    contacts: [
      { id: 'compliance-exports-contact-1', email: 'compliance.exports+1@example.com', tier: 'growth' },
      { id: 'compliance-exports-contact-2', email: 'compliance.exports+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'compliance-exports-ws-1', name: 'Compliance Exports Demo North' },
      { id: 'compliance-exports-ws-2', name: 'Compliance Exports Demo South' }
    ],
    notes: ['Expansion fixture for Compliance Exports', 'Supports test and catalog rendering']
  };
}

export function summarizeComplianceExportsFixtures(fixtures = createComplianceExportsFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
