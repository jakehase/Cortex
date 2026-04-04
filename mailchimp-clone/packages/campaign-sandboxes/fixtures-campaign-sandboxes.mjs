export function createCampaignSandboxesFixtures() {
  return {
    contacts: [
      { id: "campaign-sandboxes-contact-1", email: "campaign-sandboxes+1@example.com", tier: 'growth' },
      { id: "campaign-sandboxes-contact-2", email: "campaign-sandboxes+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "campaign-sandboxes-ws-1", name: "Campaign Sandboxes Demo East" },
      { id: "campaign-sandboxes-ws-2", name: "Campaign Sandboxes Demo West" }
    ],
    notes: ["Campaign Sandboxes fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeCampaignSandboxesFixtures(fixtures = createCampaignSandboxesFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

