export function createServiceRecoveryFixtures() {
  return {
    contacts: [
      { id: "service-recovery-contact-1", email: "service-recovery+1@example.com", tier: 'growth' },
      { id: "service-recovery-contact-2", email: "service-recovery+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "service-recovery-ws-1", name: "Service Recovery Demo East" },
      { id: "service-recovery-ws-2", name: "Service Recovery Demo West" }
    ],
    notes: ["Service Recovery fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeServiceRecoveryFixtures(fixtures = createServiceRecoveryFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

