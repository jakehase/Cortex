export function createSmsOrchestrationFixtures() {
  return {
    contacts: [
      { id: 'sms-orchestration-contact-1', email: 'sms.orchestration+1@example.com', tier: 'growth' },
      { id: 'sms-orchestration-contact-2', email: 'sms.orchestration+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'sms-orchestration-ws-1', name: 'Sms Orchestration Demo North' },
      { id: 'sms-orchestration-ws-2', name: 'Sms Orchestration Demo South' }
    ],
    notes: ['Expansion fixture for Sms Orchestration', 'Supports test and catalog rendering']
  };
}

export function summarizeSmsOrchestrationFixtures(fixtures = createSmsOrchestrationFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
