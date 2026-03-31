export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body;
  const correct = process.env.ADMIN_PASSWORD;

  if (!correct) return res.status(500).json({ error: 'ADMIN_PASSWORD not set' });

  if (password === correct) {
    // یه token ساده — timestamp + secret
    const token = Buffer.from(`${Date.now()}:${correct}`).toString('base64');
    return res.status(200).json({ token });
  }

  return res.status(401).json({ error: 'wrong password' });
}
