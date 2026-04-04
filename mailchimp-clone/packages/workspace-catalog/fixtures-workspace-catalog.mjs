export function createWorkspaceCatalogFixtures() {
  return {
    contacts: [
      { id: 'workspace-catalog-contact-1', email: 'workspace.catalog+1@example.com', tier: 'growth' },
      { id: 'workspace-catalog-contact-2', email: 'workspace.catalog+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'workspace-catalog-ws-1', name: 'Workspace Catalog Demo North' },
      { id: 'workspace-catalog-ws-2', name: 'Workspace Catalog Demo South' }
    ],
    notes: ['Expansion fixture for Workspace Catalog', 'Supports test and catalog rendering']
  };
}

export function summarizeWorkspaceCatalogFixtures(fixtures = createWorkspaceCatalogFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
