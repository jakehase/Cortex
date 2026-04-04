export function createTenantProvisioningFixtures() {
  return {
    contacts: [
      { id: 'tenant-provisioning-contact-1', email: 'tenant.provisioning+1@example.com', tier: 'growth' },
      { id: 'tenant-provisioning-contact-2', email: 'tenant.provisioning+2@example.com', tier: 'premium' }
    ],
    workspaces: [
      { id: 'tenant-provisioning-ws-1', name: 'Tenant Provisioning Demo North' },
      { id: 'tenant-provisioning-ws-2', name: 'Tenant Provisioning Demo South' }
    ],
    notes: ['Expansion fixture for Tenant Provisioning', 'Supports test and catalog rendering']
  };
}

export function summarizeTenantProvisioningFixtures(fixtures = createTenantProvisioningFixtures()) {
  return {
    contacts: fixtures.contacts.length,
    workspaces: fixtures.workspaces.length,
    notes: fixtures.notes.length
  };
}
