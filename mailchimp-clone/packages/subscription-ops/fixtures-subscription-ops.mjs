export function createSubscriptionOpsFixtures() {
  return {
    contacts: [
      { id: 'subscription-ops-contact-1', email: 'subscription.ops+1@example.com', tier: 'growth' },
      { id: 'subscription-ops-contact-2', email: 'subscription.ops+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'subscription-ops-ws-1', name: 'Subscription Ops Demo North' },
      { id: 'subscription-ops-ws-2', name: 'Subscription Ops Demo South' }
    ],
    notes: ['Expansion fixture for Subscription Ops', 'Supports test and catalog rendering']
  };
}

export function summarizeSubscriptionOpsFixtures(fixtures = createSubscriptionOpsFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
