import type { Plugin } from 'vite'
import legal from '../../config/legal.public.json'

export const legalPublicPaths = legal.documents.map(doc => doc.path)

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
type Document = (typeof legal.documents)[number]
const partner = (doc: Document, language: string) => legal.documents.find(item => item.kind === doc.kind && item.language === language)!
const link = (href: string, label: string, external = false) => {
  if (!href.startsWith('/') && !href.startsWith('https://')) throw new Error('Enlace legal no permitido.')
  return `<a href="${escape(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escape(label)}</a>`
}

function render(doc: Document) {
  const en = doc.language === 'en'
  const t = (es: string, english: string) => en ? english : es
  const home = `/?lang=${doc.language}`
  const privacy = en ? '/privacy' : '/privacidad'
  const terms = en ? '/terms' : '/condiciones'
  const date = new Intl.DateTimeFormat(en ? 'en-GB' : 'es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${legal.updated}T12:00:00Z`))
  const sections = doc.sections.map((section, index) => `<section class="legal-section" id="${escape(section.id)}"><h2><span>${String(index + 1).padStart(2, '0')}</span>${escape(section.title)}</h2>${section.paragraphs.map(text => `<p>${escape(text)}</p>`).join('')}${'links' in section && section.links ? `<ul class="legal-references">${section.links.map(item => `<li>${link(item.href, item.label, item.href.startsWith('https://'))}</li>`).join('')}</ul>` : ''}</section>`).join('')
  return `<!doctype html>
<html lang="${doc.language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(doc.title)} · ${escape(legal.brand)}</title><meta name="description" content="${escape(doc.description)}"><meta name="referrer" content="strict-origin-when-cross-origin"><link rel="icon" href="/favicon.svg"><link rel="canonical" href="${legal.origin}${doc.path}"><link rel="alternate" hreflang="es" href="${legal.origin}${partner(doc, 'es').path}"><link rel="alternate" hreflang="en" href="${legal.origin}${partner(doc, 'en').path}"><link rel="stylesheet" href="/legal.css?v=${legal.updated}"></head>
<body><a class="legal-skip" href="#document">${t('Saltar al contenido', 'Skip to content')}</a>
<header class="legal-header"><a class="legal-brand" href="${home}"><img src="/el-morenaje-logo.png" width="62" height="62" alt="ElMorenaje Cuts"><span>EL MORENAJE<small>CUTS · CURAÇAO</small></span></a><nav aria-label="${t('Idioma', 'Language')}" class="legal-language"><a href="${partner(doc, 'es').path}" lang="es"${!en ? ' aria-current="page"' : ''}>ES</a><a href="${partner(doc, 'en').path}" lang="en"${en ? ' aria-current="page"' : ''}>EN</a></nav></header>
<main id="document"><div class="legal-hero"><a class="legal-back" href="${home}">← ${t('Volver al sitio', 'Back to website')}</a><p class="legal-eyebrow">${t('Información legal', 'Legal information')}</p><h1>${escape(doc.title)}</h1><p class="legal-intro">${escape(doc.intro)}</p><p class="legal-date">${t('Última actualización', 'Last updated')}: <time datetime="${legal.updated}">${escape(date)}</time></p></div>
<div class="legal-layout"><aside class="legal-index"><p>${t('En esta página', 'On this page')}</p><nav aria-label="${t('Índice del documento', 'Document contents')}">${doc.sections.map((section, index) => `<a href="#${escape(section.id)}"><span>${String(index + 1).padStart(2, '0')}</span>${escape(section.title)}</a>`).join('')}</nav></aside><article class="legal-copy">${sections}<section class="legal-contact" id="contact"><p class="legal-eyebrow">${t('Hablemos', 'Get in touch')}</p><h2>${t('Contacto del responsable', 'Contact the controller')}</h2><p><strong>${escape(legal.company)}</strong><br>${escape(legal.address)}</p><p>${t('Para consultas de privacidad o sobre estas condiciones, utiliza los canales públicos del negocio.', 'For privacy enquiries or questions about these terms, use the business contact channels.')}</p><div class="legal-contact-links">${link(`https://wa.me/${legal.whatsapp.replace(/\D/g, '')}`, `WhatsApp · ${legal.whatsapp}`, true)}${link(legal.mapsUrl, t('Dirección y ubicación en Google Maps', 'Address and location on Google Maps'), true)}${link(`${home}#ubicacion`, t('Ver todos los contactos del negocio', 'View all business contact details'))}</div></section></article></div></main>
<footer class="legal-footer"><span>© ${legal.updated.slice(0, 4)} ${escape(legal.brand)}</span><nav aria-label="${t('Enlaces legales', 'Legal links')}">${link(privacy, t('Política de Privacidad', 'Privacy Policy'))}${link(terms, t('Condiciones del Servicio', 'Terms of Service'))}${link(home, t('Inicio', 'Home'))}</nav></footer></body></html>`
}

/** Publish real HTML documents, also available through Vite during development. */
export function legalPagesPlugin(): Plugin {
  return {
    name: 'elmorenaje-public-legal-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '')
        const doc = legal.documents.find(item => item.path === pathname)
        if (!doc) return next()
        if (!['GET', 'HEAD'].includes(req.method || 'GET')) { res.statusCode = 405; res.end(); return }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(req.method === 'HEAD' ? undefined : render(doc))
      })
    },
    generateBundle() {
      for (const doc of legal.documents) this.emitFile({ type: 'asset', fileName: `${doc.path.slice(1)}/index.html`, source: render(doc) })
    },
  }
}
