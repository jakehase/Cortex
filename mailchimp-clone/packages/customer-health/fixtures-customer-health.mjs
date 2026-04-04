export function createCustomerHealthFixtures() {
  return {
    contacts: [
      { id: "customer-health-contact-1", email: "customer-health+1@example.com", tier: 'growth' },
      { id: "customer-health-contact-2", email: "customer-health+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "customer-health-ws-1", name: "Customer Health Demo East" },
      { id: "customer-health-ws-2", name: "Customer Health Demo West" }
    ],
    notes: ["Customer Health fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeCustomerHealthFixtures(fixtures = createCustomerHealthFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

