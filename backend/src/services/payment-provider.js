class PaystackProvider {
  constructor(secretKey) {
    this.secretKey = secretKey;
  }

  async request(url, options) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    const body = await response.json();
    if (!response.ok || !body.status) {
      const error = new Error('Payment provider request failed');
      error.code = 'PAYSTACK_REQUEST_FAILED';
      throw error;
    }
    return body.data;
  }

  async initialize({ email, amountKobo, reference, callbackUrl }) {
    const result = await this.request('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({ email, amount: amountKobo, reference, callback_url: callbackUrl, currency: 'NGN' })
    });
    return { reference: result.reference, checkoutUrl: result.authorization_url };
  }

  async verify(reference) {
    return this.request(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET'
    });
  }
}

class MockPaymentProvider {
  constructor() {
    this.payments = new Map();
  }

  async initialize({ email, amountKobo, reference }) {
    this.payments.set(reference, { email, amount: amountKobo, currency: 'NGN', status: 'pending' });
    return { reference, checkoutUrl: `http://localhost:3020/mock-payments/${encodeURIComponent(reference)}` };
  }

  async verify(reference) {
    const payment = this.payments.get(reference);
    if (!payment) {
      const error = new Error('Mock payment reference not found');
      error.code = 'PAYMENT_REFERENCE_NOT_FOUND';
      throw error;
    }
    return payment;
  }

  markSuccessful(reference) {
    const payment = this.payments.get(reference);
    if (!payment) {
      const error = new Error('Mock payment reference not found');
      error.code = 'PAYMENT_REFERENCE_NOT_FOUND';
      throw error;
    }
    payment.status = 'success';
    this.payments.set(reference, payment);
    return payment;
  }
}

const mockProvider = new MockPaymentProvider();

function getPaymentProvider() {
  if (process.env.PAYSTACK_SECRET_KEY) {
    if (!process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_')) {
      throw new Error('Only Paystack test-mode credentials are enabled by this integration');
    }
    return new PaystackProvider(process.env.PAYSTACK_SECRET_KEY);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PAYSTACK_SECRET_KEY is required in production');
  }
  return mockProvider;
}

module.exports = { PaystackProvider, MockPaymentProvider, mockProvider, getPaymentProvider };
