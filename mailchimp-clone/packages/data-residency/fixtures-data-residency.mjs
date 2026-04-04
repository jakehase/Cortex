export function createDataResidencyFixtures() {
  return {
    contacts: [
      { id: 'data-residency-contact-1', email: 'data.residency+1@example.com', tier: 'growth' },
      { id: 'data-residency-contact-2', email: 'data.residency+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'data-residency-ws-1', name: 'Data Residency Demo North' },
      { id: 'data-residency-ws-2', name: 'Data Residency Demo South' }
    ],
    notes: ['Expansion fixture for Data Residency', 'Supports test and catalog rendering']
  };
}

export function summarizeDataResidencyFixtures(fixtures = createDataResidencyFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
