export function createCampaignCalendarFixtures() {
  return {
    contacts: [
      { id: 'campaign-calendar-contact-1', email: 'campaign.calendar+1@example.com', tier: 'growth' },
      { id: 'campaign-calendar-contact-2', email: 'campaign.calendar+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'campaign-calendar-ws-1', name: 'Campaign Calendar Demo North' },
      { id: 'campaign-calendar-ws-2', name: 'Campaign Calendar Demo South' }
    ],
    notes: ['Expansion fixture for Campaign Calendar', 'Supports test and catalog rendering']
  };
}

export function summarizeCampaignCalendarFixtures(fixtures = createCampaignCalendarFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
