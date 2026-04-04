export function createSendTimeOptimizerFixtures() {
  return {
    contacts: [
      { id: 'send-time-optimizer-contact-1', email: 'send.time.optimizer+1@example.com', tier: 'growth' },
      { id: 'send-time-optimizer-contact-2', email: 'send.time.optimizer+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'send-time-optimizer-ws-1', name: 'Send Time Optimizer Demo North' },
      { id: 'send-time-optimizer-ws-2', name: 'Send Time Optimizer Demo South' }
    ],
    notes: ['Expansion fixture for Send Time Optimizer', 'Supports test and catalog rendering']
  };
}

export function summarizeSendTimeOptimizerFixtures(fixtures = createSendTimeOptimizerFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
