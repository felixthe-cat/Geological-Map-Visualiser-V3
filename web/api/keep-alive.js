export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ylxyovcujybqodjesbvo.supabase.co';
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHlvdmN1anlicW9kamVzYnZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NzEyNDUsImV4cCI6MjA5NjE0NzI0NX0.9sVC_mEqRTHvq2lRiWCpMBo8AHgpwlCecJxssJ01Zl8';

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/projects?select=id&limit=1`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const isOk = response.ok;
    const body = isOk ? await response.json() : await response.text();
    const payload = {
      ok: isOk,
      status: response.status,
      message: isOk ? 'Supabase keep-alive ping successful' : 'Supabase returned non-OK response',
      data: isOk ? body : undefined,
      error: !isOk ? body : undefined,
      timestamp: new Date().toISOString(),
    };

    if (res && typeof res.status === 'function') {
      return res.status(isOk ? 200 : response.status).json(payload);
    }
    return new Response(JSON.stringify(payload), {
      status: isOk ? 200 : response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorPayload = {
      ok: false,
      error: error.message || String(error),
      timestamp: new Date().toISOString(),
    };
    if (res && typeof res.status === 'function') {
      return res.status(500).json(errorPayload);
    }
    return new Response(JSON.stringify(errorPayload), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
