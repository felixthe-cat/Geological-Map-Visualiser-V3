// Unit test for web/api/keep-alive.js
import handler from './api/keep-alive.js';

let statusCode = null;
let responseJson = null;

const mockRes = {
  status(code) {
    statusCode = code;
    return this;
  },
  json(data) {
    responseJson = data;
    return this;
  }
};

console.log('Testing /api/keep-alive handler against Supabase...');
await handler({}, mockRes);

if (statusCode !== 200) {
  console.error(`FAILED: Expected status 200, got ${statusCode}`);
  process.exit(1);
}

if (!responseJson || !responseJson.ok) {
  console.error('FAILED: Expected ok: true in response body', responseJson);
  process.exit(1);
}

console.log('ok — keep-alive handler successfully connected to Supabase and returned:', responseJson);
