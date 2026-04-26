const shellId = 'mailclone-client-shell';
if (!document.getElementById(shellId)) {
  document.body.classList.add('mailclone-client-shell-ready');
  const header = document.createElement('div');
  header.id = shellId;
  header.innerHTML = '<strong>Mailclone client shell</strong><span class="shell-status">Hydrated marketing shell · client-ready builder hooks</span>';
  document.body.prepend(header);
  if (!document.querySelector('[data-builder-panel]')) {
    const panel = document.createElement('aside');
    panel.setAttribute('data-builder-panel', 'true');
    panel.innerHTML = '<h3 style="margin-top:0">Builder panel</h3><p style="margin-bottom:0">Client-side shell hooks are now active for richer editing, preview, and asset workflows.</p>';
    document.body.append(panel);
  }
}
