import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('');
const DOMPurify = createDOMPurify(window);

/**
 * Sanitiza SVG (remove scripts, eventos on*, links externos, foreignObject etc.).
 * Toda saída entregue ao cliente passa por aqui.
 */
export function sanitizeSvg(svg) {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image', 'use', 'a', 'script', 'style', 'animate', 'set', 'animateTransform', 'animateMotion'],
    FORBID_ATTR: ['href', 'xlink:href', 'style'],
    NAMESPACE: 'http://www.w3.org/2000/svg',
    PARSER_MEDIA_TYPE: 'image/svg+xml',
  });
  if (!/^<svg[\s>]/i.test(clean.trim())) throw new Error('SVG inválido após sanitização');
  let out = clean.trim();
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(out)) {
    out = out.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return out;
}
