export function createAgencyWorkspaceFixtures() {
  return {
    contacts: [
      { id: 'agency-workspace-contact-1', email: 'agency.workspace+1@example.com', tier: 'growth' },
      { id: 'agency-workspace-contact-2', email: 'agency.workspace+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'agency-workspace-ws-1', name: 'Agency Workspace Demo North' },
      { id: 'agency-workspace-ws-2', name: 'Agency Workspace Demo South' }
    ],
    notes: ['Expansion fixture for Agency Workspace', 'Supports test and catalog rendering']
  };
}

export function summarizeAgencyWorkspaceFixtures(fixtures = createAgencyWorkspaceFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
