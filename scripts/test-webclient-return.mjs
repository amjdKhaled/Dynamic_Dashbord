import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const clientSource = fs.readFileSync('src/LFPortal.Web/wwwroot/js/lf-webclient-button.js', 'utf8')
    .replace('__DASHBOARD_URL_NOT_CONFIGURED__', 'http://localhost:5000');
const receiverEvents = {};
let focused = 0;
let toolbar = true;
const client = {
    location: new URL('https://localhost/laserfiche/Browse.aspx?db=TestEmployee#/id=1;view=browse'),
    addEventListener: (type, fn) => { receiverEvents[type] = fn; },
    focus: () => focused++,
    document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById: id => id === 'rightNavbar' ? (toolbar ? {} : null) :
            id === 'WebAccessRepositoryName' ? { value: 'TestEmployee' } : null
    }
};
vm.runInNewContext(clientSource, { window: client, URL, URLSearchParams, console });
const replies = [];
const portal = { postMessage: (data, origin) => replies.push({ data, origin }) };
const searchUrl = 'https://localhost/laserfiche/Browse.aspx?db=testemployee#search=%7BLF%3AID%3D445%7D;view=search';
const request = (origin = 'http://localhost:5000', url = searchUrl) => receiverEvents.message({
    origin, source: portal, data: { type: 'lf-dashboard-search', requestId: 'one', url }
});
request('https://evil.test');
request('http://localhost:5000', searchUrl.replace('db=testemployee', 'db=another'));
request('http://localhost:5000', searchUrl.replace('/laserfiche/', '/another/'));
toolbar = false; request(); toolbar = true;
assert.equal(replies.length, 0);
request();
assert.equal(replies.length, 1);
assert.equal(client.location.hash, '#/search=%7BLF%3AID%3D445%7D;view=search');
assert.equal(client.location.pathname, '/laserfiche/Browse.aspx');
assert.equal(client.location.search, '?db=TestEmployee');
assert.equal(focused, 1);
assert.equal(replies[0].origin, 'http://localhost:5000');
console.log('Web Client search receiver: origin, repository and path checks, acknowledgement and focus passed.');
