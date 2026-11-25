import type { Plugin } from 'vite'
import legal from '../../config/legal.public.json'

/** Public crawl information; private routes still require server authentication. */
export function publicationPlugin(indexable: boolean): Plugin {
  const origin = legal.origin
  const robots = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', ...legal.documents.map(doc => doc.path)].map(route => `<url><loc>${origin}${route}</loc></url>`).join('')}</urlset>\n`
  const documents = new Map([['/robots.txt', { body: robots, type: 'text/plain; charset=utf-8' }], ['/sitemap.xml', { body: sitemap, type: 'application/xml; charset=utf-8' }]])
  return {
    name: 'elmorenaje-publication',
    configureServer(server) {
      if (!indexable) return
      server.middlewares.use((req, res, next) => {
        const doc = documents.get((req.url || '').split('?')[0])
        if (!doc) return next()
        if (!['GET', 'HEAD'].includes(req.method || 'GET')) { res.statusCode = 405; res.end(); return }
        res.setHeader('Content-Type', doc.type)
        res.end(req.method === 'HEAD' ? undefined : doc.body)
      })
    },
    generateBundle() {
      if (indexable) for (const [route, doc] of documents) this.emitFile({ type: 'asset', fileName: route.slice(1), source: doc.body })
    },
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: `${origin}/` }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:url', content: `${origin}/` }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:type', content: 'website' }, injectTo: 'head' },
      ]
    },
  }
}
