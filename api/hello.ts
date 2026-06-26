import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Health-check endpoint. Step 1 "hello world" — proves the serverless
 * function layer is wired up before any OpenAI / Stripe / Supabase calls.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    message: 'AI Intake Assistant API is alive',
    time: new Date().toISOString(),
  });
}
