export function createBillingAnalyticsFixtures() {
  return {
    contacts: [
      { id: 'billing-analytics-contact-1', email: 'billing.analytics+1@example.com', tier: 'growth' },
      { id: 'billing-analytics-contact-2', email: 'billing.analytics+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'billing-analytics-ws-1', name: 'Billing Analytics Demo North' },
      { id: 'billing-analytics-ws-2', name: 'Billing Analytics Demo South' }
    ],
    notes: ['Expansion fixture for Billing Analytics', 'Supports test and catalog rendering']
  };
}

export function summarizeBillingAnalyticsFixtures(fixtures = createBillingAnalyticsFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
