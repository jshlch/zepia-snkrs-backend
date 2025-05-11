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

const MAX_SESSIONS = 3;
const TARGET_PRODUCT_IDS = ["ZEPIA_SNKRS_TOOL_30_DAYS"];

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

// WEBHOOK
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

    if (type === 'checkout.session.completed') {
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
          status: 'ACTIVE',
          stripe_customer_id: customerId,
          access_key: uuidv4(),
          email: customerEmail,
          sub_from,
          sub_to,
          session_ids: [],
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


// 🧰 Utility: respond with error and log
function respondError(res, statusCode, accessKey, message) {
  console.error(`❌ [${accessKey}] ${message}`);
  return res.status(statusCode).json({ error: message });
}

// 🧰 Utility: fetch user with logs
async function getUserByAccessKey(access_key) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('access_key', access_key)
    .single();

  if (error || !data) return { user: null, error: 'User not found' };
  return { user: data, error: null };
}

// 📌 Bind Endpoint
app.post('/api/v1/auth/bind', async (req, res) => {
  const { access_key } = req.body;
  console.log(`🔑 [${access_key}] Attempting bind`);

  const { user, error } = await getUserByAccessKey(access_key);
  if (error) return respondError(res, 404, access_key, error);

  const now = new Date();
  const subTo = new Date(user.sub_to);
  const sessionIds = user.session_ids || [];

  if (user.status !== 'ACTIVE') return respondError(res, 403, access_key, 'Access key is invalid');
  if (subTo < now) {
    await supabase.from('users').update({ status: 'EXPIRED' }).eq('access_key', access_key);
    return respondError(res, 403, access_key, 'Access key is expired');
  }
  if (sessionIds.length >= MAX_SESSIONS)
    return respondError(res, 429, access_key, 'Maximum sessions reached');

  const session_id = uuidv4();
  const { data: updatedUser, error: updateError } = await supabase
    .from('users')
    .update({ session_ids: [...sessionIds, session_id] })
    .eq('access_key', access_key)
    .select()
    .single();

  if (updateError) return respondError(res, 500, access_key, 'Failed to update session_ids');

  console.log(`✅ [${access_key}] Bind successful with session_id: ${session_id}`);
  res.json({ ...updatedUser, session_id });
});

// 📌 Unbind Endpoint
app.post('/api/v1/auth/unbind', async (req, res) => {
  const { access_key, session_id } = req.body;
  console.log(`🔐 [${access_key}] Attempting unbind key`);

  const { user, error } = await getUserByAccessKey(access_key);
  if (error) return respondError(res, 404, access_key, error);

  const now = new Date();
  const subTo = new Date(user.sub_to);
  const sessionIds = user.session_ids || [];

  if (user.status !== 'ACTIVE') return respondError(res, 403, access_key, 'Access key is invalid');
  if (subTo < now) {
    await supabase.from('users').update({ status: 'EXPIRED' }).eq('access_key', access_key);
    return respondError(res, 403, access_key, 'Access key is expired');
  }

  if (!session_id) return res.json(user); // No session_id to remove

  const updatedSessions = sessionIds.filter(id => id !== session_id);
  const { data: updatedUser, error: updateError } = await supabase
    .from('users')
    .update({ session_ids: updatedSessions })
    .eq('access_key', access_key)
    .select()
    .single();

  if (updateError) return respondError(res, 500, access_key, 'Failed to update session_ids');

  console.log(`👋 [${access_key}] Unbind successful for session_id: ${session_id}`);
  res.json(updatedUser);
});

// 📌 Session Validate Endpoint
app.post('/api/v1/session/validate', async (req, res) => {
  const { access_key, session_id } = req.body;
  console.log(`🔎 [${access_key}] Validating session`);

  if (!session_id) return respondError(res, 400, access_key, 'Session ID is required');

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('access_key', access_key)
    .single();

  if (error) {
    return respondError(res, 500, access_key, 'Something went wrong');
  } else if (!user) {
    return respondError(res, 404, access_key, 'Access key is invalid');
  } else {
    const now = new Date();
    const subTo = new Date(user.sub_to);
    const sessionIds = user.session_ids || []
    const isSessionValid = sessionIds.includes(session_id)

    // Check the status of the key
    if (user.status !== 'ACTIVE') {
      if (isSessionValid) {
        const updatedSessions = sessionIds.filter(id => id !== session_id);
        await supabase.from('users').update({ session_ids: updatedSessions }).eq('access_key', access_key);
      }
      return respondError(res, 403, access_key, 'Access key is invalid')
    };

    // Check if the key is already expired
    if (subTo < now) {
      let params = isSessionValid ? { status: 'EXPIRED', session_ids: sessionIds.filter(id => id !== session_id) } : { status: 'EXPIRED' }
      await supabase.from('users').update(params).eq('access_key', access_key);
      return respondError(res, 403, access_key, 'Access key is already expired');
    }
  }

  console.log(`🟢 [${access_key}] Session valid`);
  res.json(user);
});

app.get('/api/v1/app', (req, res) => {
  res.json({ version: '1.0.0' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
