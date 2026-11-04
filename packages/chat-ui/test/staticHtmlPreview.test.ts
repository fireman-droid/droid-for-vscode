// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { staticHtmlDocument } from '../src/ui/static-html-preview';

it('removes active content, navigation and external resources from untrusted dashboards', () => {
  const html = staticHtmlDocument(`<meta http-equiv="refresh" content="0;url=https://example.invalid">
    <base href="https://example.invalid"><script>parent.postMessage({type:'management.request'},'*')</script>
    <iframe src="https://example.invalid"></iframe><form action="https://example.invalid"><input name="secret"></form>
    <a href="command:run">Navigate</a><img src="https://example.invalid/track" onerror="alert(1)">
    <svg><a href="https://example.invalid">SVG link</a></svg>
    <p onclick="alert(1)" style="color:red">Report</p><style>p { font-size:14px }</style>`, 'test_nonce');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  expect(parsed.querySelector('script,iframe,form,input,a,svg,base')).toBeNull();
  expect(parsed.querySelector('[onclick],[onerror],[href],[src]')).toBeNull();
  expect(parsed.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  expect(parsed.querySelector('p')?.textContent).toBe('Report');
  expect([...parsed.querySelectorAll('style')].every(style => style.getAttribute('nonce') === 'test_nonce')).toBe(true);
  const csp = parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
  expect(csp).toContain("script-src 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("frame-src 'none'");
});

it('prevents CSS attribute text from escaping into markup and allows only embedded raster images', () => {
  const html = staticHtmlDocument(`<p style="color:red;&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;">Safe</p>
    <img src="data:image/png;base64,aGVsbG8="><img src="data:image/svg+xml,&lt;svg onload='alert(1)'&gt;">`, 'test_nonce');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  expect(parsed.querySelector('script')).toBeNull();
  expect(parsed.querySelectorAll('img[src]')).toHaveLength(1);
  expect(parsed.querySelector('p')?.textContent).toBe('Safe');
});