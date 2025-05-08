const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TARGET_PRODUCT_IDS = ["ZEPIA_SNKRS_TOOL_30_DAYS"];
const MAX_LOGINS = 20;

const updateUserByCustomerId = async (customerId, updates) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error || !user) {
    console.error('⚠️ User not found for customer ID:', customerId);
    return;
  }

  const { error: updateError } = await supabase.from('users').update(updates).eq('stripe_customer_id', user.stripe_customer_id);
  if (updateError) {
    console.error(`❌ Failed to update user ${customerId}:`, updateError);
  } else {
    console.log(`✅ User updated: ${user.stripe_customer_id}`);
  }
};

// Modify the isTargetProduct function to check the metadata set inside payment links
const isTargetProduct = (session) => TARGET_PRODUCT_IDS.includes(session.metadata.ID);

app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  console.log('🔔 Stripe webhook received');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log(`✅ Event verified: ${event.type}`);
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const now = new Date();
  const sub_from = now.toISOString();
  const sub_to = new Date(now.setMonth(now.getMonth() + 1)).toISOString();

  try {
    const { type, data } = event;

    const session = data.object;  // Extract the session object

    if (type === 'checkout.session') {
      // Check if the session corresponds to a target product
      if (!isTargetProduct(session)) {
        console.log('🔕 Ignored: session for unrelated product');
        return res.status(200).json({ received: true });
      }

      const customerId = session.customer;
      const customerEmail = session.customer_details.email || '';

      // Query for existing user based on the customerId
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('stripe_customer_id', customerId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('❌ Error querying user:', error);
        return res.status(500).json({ error: 'Unexpected error querying user' });
      }

      // Handle existing user or new user
      if (user) {
        await supabase.from('users')
          .update({ status: 'ACTIVE', sub_from, sub_to })
          .eq('stripe_customer_id', user.stripe_customer_id);
        console.log('🔁 Existing user updated:', user.stripe_customer_id);
      } else {
        await supabase.from('users').insert({
          email: customerEmail,
          access_key: uuidv4(),
          status: 'ACTIVE',
          sub_from,
          sub_to,
          login_count: 0,
          stripe_customer_id: customerId
        });
        console.log('🎉 New user created:', customerId);
      }
    } else if (type === 'customer.subscription.deleted') {
      await updateUserByCustomerId(session.customer, { status: 'CANCELLED' });
      console.log(`✅ Subscription cancelled for Customer ID: ${session.customer}`);
    }
  } catch (err) {
    console.error('🔥 Unhandled error processing webhook event:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  res.status(200).json({ received: true });
});

app.use(bodyParser.json());

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

app.get('/v1/users/:accessKey', async (req, res) => {
  const { accessKey } = req.params;
  const { data: user, error } = await supabase
    .from('users')
    .select()
    .eq('access_key', accessKey)
    .single();

  if (error || !user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  const subTo = new Date(user.sub_to);
  if (subTo < now) {
    await supabase.from('users').update({ status: 'INACTIVE' }).eq('access_key', accessKey);
    return res.status(403).json({ error: 'Subscription expired' });
  }

  res.json(user);
});

app.get('/v1/app', (req, res) => {
  res.json({ version: '1.0.0' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
