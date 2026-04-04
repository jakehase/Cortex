export function createCampaignBudgetingFixtures() {
  return {
    contacts: [
      { id: 'campaign-budgeting-contact-1', email: 'campaign.budgeting+1@example.com', tier: 'growth' },
      { id: 'campaign-budgeting-contact-2', email: 'campaign.budgeting+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'campaign-budgeting-ws-1', name: 'Campaign Budgeting Demo East' },
      { id: 'campaign-budgeting-ws-2', name: 'Campaign Budgeting Demo West' }
    ],
    notes: ['Continuation fixture for Campaign Budgeting', 'Supports regression catalog rendering']
  };
}

export function summarizeCampaignBudgetingFixtures(fixtures = createCampaignBudgetingFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}
