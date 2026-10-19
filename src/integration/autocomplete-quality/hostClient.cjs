// Keep the live Host only as a credential-owning model gateway. Never persist its URL.
function createHostClient() {
  const supplied = process.env.DROID_AUTOCOMPLETE_GATEWAY_FILE
    ? JSON.parse(require('node:fs').readFileSync(process.env.DROID_AUTOCOMPLETE_GATEWAY_FILE, 'utf8')).url
    : process.env.DROID_AUTOCOMPLETE_BRIDGE_URL;
  const bridge = new URL(supplied ?? '');
  if (bridge.protocol !== 'http:' || bridge.hostname !== '127.0.0.1') throw new Error('A local Browser Dev link is required');
  const fragment = new URLSearchParams(bridge.hash.slice(1));
  const token = fragment.get('token'), port = fragment.get('bridgePort');
  if (!token || !port || !/^\d+$/.test(port)) throw new Error('The Browser Dev link is incomplete');
  return async payload => {
    const response = await fetch(`http://127.0.0.1:${port}/autocomplete/evaluate`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { Origin: 'http://127.0.0.1:4173', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Development evaluation endpoint returned HTTP ${response.status}`);
    return response.json();
  };
}
module.exports = { createHostClient };
