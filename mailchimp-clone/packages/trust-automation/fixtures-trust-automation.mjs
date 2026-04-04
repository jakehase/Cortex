export function createTrustAutomationFixtures() {
  return {
    contacts: [
      { id: "trust-automation-contact-1", email: "trust-automation+1@example.com", tier: 'growth' },
      { id: "trust-automation-contact-2", email: "trust-automation+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "trust-automation-ws-1", name: "Trust Automation Demo East" },
      { id: "trust-automation-ws-2", name: "Trust Automation Demo West" }
    ],
    notes: ["Trust Automation fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeTrustAutomationFixtures(fixtures = createTrustAutomationFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

