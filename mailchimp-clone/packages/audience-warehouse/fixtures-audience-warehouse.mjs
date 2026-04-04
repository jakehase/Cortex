export function createAudienceWarehouseFixtures() {
  return {
    contacts: [
      { id: 'audience-warehouse-contact-1', email: 'audience.warehouse+1@example.com', tier: 'growth' },
      { id: 'audience-warehouse-contact-2', email: 'audience.warehouse+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'audience-warehouse-ws-1', name: 'Audience Warehouse Demo East' },
      { id: 'audience-warehouse-ws-2', name: 'Audience Warehouse Demo West' }
    ],
    notes: ['Continuation fixture for Audience Warehouse', 'Supports regression catalog rendering']
  };
}

export function summarizeAudienceWarehouseFixtures(fixtures = createAudienceWarehouseFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
