export function createDeliverabilityLabsFixtures() {
  return {
    contacts: [
      { id: 'deliverability-labs-contact-1', email: 'deliverability.labs+1@example.com', tier: 'growth' },
      { id: 'deliverability-labs-contact-2', email: 'deliverability.labs+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'deliverability-labs-ws-1', name: 'Deliverability Labs Demo East' },
      { id: 'deliverability-labs-ws-2', name: 'Deliverability Labs Demo West' }
    ],
    notes: ['Continuation fixture for Deliverability Labs', 'Supports regression catalog rendering']
  };
}

export function summarizeDeliverabilityLabsFixtures(fixtures = createDeliverabilityLabsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
