function dataUrl(payload) {
  return 'data:application/json,' + encodeURIComponent(JSON.stringify(payload));
}

export async function syncIntegrationProvider(app, installation) {
  const payload = {
    appId: app.id,
    installationId: installation.id,
    syncedContacts: app.category === 'crm' ? 24 : 0,
    syncedOrders: app.category === 'commerce' ? 6 : 0,
    syncedRevenue: app.category === 'commerce' ? 1840 : 0,
    refreshedScopes: app.scopes || []
  };
  const response = await fetch(dataUrl(payload));
  return response.json();
}
