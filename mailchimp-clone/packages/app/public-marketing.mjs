import { page } from './view.mjs';

export function marketingShell({ title, eyebrow, headline, intro, ctaPrimary, ctaSecondary, sections = [] }) {
  return page(title, null, `<section class="hero"><div class="eyebrow">${eyebrow}</div><h2>${headline}</h2><p>${intro}</p><div class="hero-actions"><a class="button-link" href="${ctaPrimary.href}">${ctaPrimary.label}</a><a class="button-link secondary" href="${ctaSecondary.href}">${ctaSecondary.label}</a></div></section>${sections.join('')}`);
}

export function marketingStats(state) {
  return `<div class="stat-strip">
    <div class="stat"><strong>${state.db.contacts.length}</strong><div class="muted">audience contacts</div></div>
    <div class="stat"><strong>${state.db.campaigns.length}</strong><div class="muted">campaign workflows</div></div>
    <div class="stat"><strong>${state.db.automations.length}</strong><div class="muted">automation journeys</div></div>
    <div class="stat"><strong>${state.db.forms.length + state.db.landingPages.length}</strong><div class="muted">forms + landing pages</div></div>
  </div>`;
}

export function featureCard(href, title, copy, bullets) {
  return `<div class="card"><h3><a href="${href}">${title}</a></h3><p>${copy}</p><ul class="feature-list">${bullets.map((entry) => `<li>${entry}</li>`).join('')}</ul></div>`;
}

export function planCard(name, price, audience, bullets) {
  return `<div class="card"><span class="pill">${audience}</span><h3>${name}</h3><p style="font-size:30px;font-weight:800;margin:8px 0">${price}</p><ul class="feature-list">${bullets.map((entry) => `<li>${entry}</li>`).join('')}</ul><div class="hero-actions"><a class="button-link" href="/signup">Start with ${name}</a></div></div>`;
}

export function faqCard(question, answer) {
  return `<div class="card"><h3>${question}</h3><p>${answer}</p></div>`;
}

export function resourceCard(href, label, title, copy) {
  return `<div class="card"><span class="pill">${label}</span><h3><a href="${href}">${title}</a></h3><p>${copy}</p></div>`;
}

export function templateCard(name, audience, bullets) {
  return `<div class="card"><span class="pill">${audience}</span><h3>${name}</h3><ul class="feature-list">${bullets.map((entry) => `<li>${entry}</li>`).join('')}</ul><div class="hero-actions"><a class="button-link secondary" href="/signup">Use this layout</a></div></div>`;
}

export function storyCard(company, outcome, copy) {
  return `<div class="card"><h3>${company}</h3><p style="font-size:30px;font-weight:800;margin:8px 0">${outcome}</p><p>${copy}</p></div>`;
}
