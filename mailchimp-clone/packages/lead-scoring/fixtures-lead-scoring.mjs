export function createLeadScoringFixtures() {
  return {
    contacts: [
      { id: 'lead-scoring-contact-1', email: 'lead.scoring+1@example.com', tier: 'growth' },
      { id: 'lead-scoring-contact-2', email: 'lead.scoring+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'lead-scoring-ws-1', name: 'Lead Scoring Demo North' },
      { id: 'lead-scoring-ws-2', name: 'Lead Scoring Demo South' }
    ],
    notes: ['Expansion fixture for Lead Scoring', 'Supports test and catalog rendering']
  };
}

export function summarizeLeadScoringFixtures(fixtures = createLeadScoringFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
