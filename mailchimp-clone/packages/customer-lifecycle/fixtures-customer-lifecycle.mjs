export function createCustomerLifecycleFixtures() {
  return {
    contacts: [
      { id: 'customer-lifecycle-contact-1', email: 'customer.lifecycle+1@example.com', tier: 'growth' },
      { id: 'customer-lifecycle-contact-2', email: 'customer.lifecycle+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'customer-lifecycle-ws-1', name: 'Customer Lifecycle Demo North' },
      { id: 'customer-lifecycle-ws-2', name: 'Customer Lifecycle Demo South' }
    ],
    notes: ['Expansion fixture for Customer Lifecycle', 'Supports test and catalog rendering']
  };
}

export function summarizeCustomerLifecycleFixtures(fixtures = createCustomerLifecycleFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
