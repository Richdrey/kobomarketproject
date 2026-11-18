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

  async transfer({ amountKobo, reference, bankDetails }) {
    const recipient = await this.request('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        name: bankDetails.accountName,
        account_number: bankDetails.accountNumber,
        bank_code: bankDetails.bankCode,
        currency: 'NGN'
      })
    });
    const transfer = await this.request('https://api.paystack.co/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: amountKobo,
        recipient_code: recipient.recipient_code,
        reason: 'KoboMarket vendor payout',
        reference
      })
    });
    return { reference: transfer.reference || transfer.transfer_code, status: transfer.status };
  }
}

class MockPaymentProvider {
  constructor() {
    this.payments = new Map();
  }

  async initialize({ email, amountKobo, reference }) {
    this.payments.set(reference, { email, amount: amountKobo, currency: 'NGN', status: 'pending' });
    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3020';
    return {
      reference,
      checkoutUrl: `${baseUrl}/api/v1/mock-payments/${encodeURIComponent(reference)}`
    };
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

  async transfer({ amountKobo, reference }) {
    if (process.env.MOCK_PAYOUT_FAIL === 'true') {
      const error = new Error('Mock payout provider reported a transfer failure');
      error.code = 'MOCK_PAYOUT_FAILED';
      throw error;
    }
    return { reference, amount: amountKobo, status: 'success' };
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
