const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());

// Stripe webhook must be defined before JSON parser
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    console.log('Received Stripe webhook');
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log('Stripe event constructed:', event.type);
    } catch (err) {
      console.error('Webhook Error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = session.customer_details.email;

      console.log('Checkout completed for:', customerEmail);
  
      const { data: existingUser, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', customerEmail)
        .single();
  
        if (error) {
            if (error.code === 'PGRST116') {
                console.log('No existing record found for:', customerEmail);
            } else {
                console.error('Unexpected error querying user:', error);
                return res.status(500).json({ error: 'Unexpected error querying user' });
            }
        }
  
      const now = new Date();
      const sub_from = now.toISOString();
      const sub_to = new Date(now.setMonth(now.getMonth() + 1)).toISOString();
  
      if (existingUser) {
        console.log('Updating existing user');

        await supabase
          .from('users')
          .update({ status: 'ACTIVE', sub_from, sub_to })
          .eq('email', customerEmail);
      } else {
        console.log('Creating new user');

        const access_key = uuidv4();
        await supabase.from('users').insert({
          email: customerEmail,
          access_key,
          status: 'ACTIVE',
          sub_from,
          sub_to,
          login_count: 0,
        });

        console.log(`Created new user with email: ${customerEmail} accessKey: ${access_key}`);
      }
    }
  
    res.status(200).json({ received: true });
  });

app.use(bodyParser.json());

// Supabase init
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Limit login count
const MAX_LOGINS = 20;

// Login
app.post('/v1/auth/login', async (req, res) => {
  const { access_key } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('access_key', access_key)
    .single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  const subTo = new Date(user.sub_to);

  if (subTo < now) {
    await supabase.from('users').update({ status: 'INACTIVE' }).eq('access_key', access_key);
    return res.status(403).json({ error: 'Subscription expired' });
  }

  if (user.login_count >= MAX_LOGINS)
    return res.status(403).json({ error: 'Maximum login limit reached' });

  const { data, error: updateError } = await supabase
    .from('users')
    .update({ login_count: user.login_count + 1 })
    .eq('access_key', access_key)
    .select()
    .single();

  if (updateError) return res.status(500).json({ error: 'Failed to update login count' });
  res.json(data);
});

// Logout
app.post('/v1/auth/logout', async (req, res) => {
  const { access_key } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('access_key', access_key)
    .single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });

  const updatedCount = Math.max(0, user.login_count - 1);
  const { data, error: updateError } = await supabase
    .from('users')
    .update({ login_count: updatedCount })
    .eq('access_key', access_key)
    .select()
    .single();

  if (updateError) return res.status(500).json({ error: 'Failed to update logout count' });
  res.json(data);
});

// Get user by access key
app.get('/v1/users/:accessKey', async (req, res) => {
  const { accessKey } = req.params;
  const { data: user, error } = await supabase
    .from('users')
    .select()
    .eq('access_key', accessKey)
    .single();

  if (error || !user) return res.status(404).json({ error: 'User not found' });

  // Check if subscription is expired
  const now = new Date();
  const subTo = new Date(user.sub_to);
  if (subTo < now) {
    await supabase.from('users').update({ status: 'INACTIVE' }).eq('access_key', accessKey);
    return res.status(403).json({ error: 'Subscription expired' });
  }

  res.json(user);
});

// App config
app.get('/v1/app', (req, res) => {
  res.json({ version: '1.0.0' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
