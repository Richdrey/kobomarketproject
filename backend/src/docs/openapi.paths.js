const routes = [
  ['post', '/auth/register', 'Register a buyer account', 'Authentication', false],
  ['post', '/auth/verify-email', 'Verify an email address', 'Authentication', false],
  ['post', '/auth/login', 'Log in', 'Authentication', false],
  ['post', '/auth/refresh', 'Rotate a refresh token', 'Authentication', false],
  ['post', '/auth/logout', 'Revoke a refresh token', 'Authentication', false],
  ['post', '/auth/forgot-password', 'Request a password reset', 'Authentication', false],
  ['post', '/auth/reset-password', 'Reset a password', 'Authentication', false],
  ['get', '/users/me', 'Get the current user', 'Users', true],
  ['patch', '/users/me', 'Update the current user', 'Users', true],
  ['post', '/vendors/apply', 'Apply to become a vendor', 'Vendors', true],
  ['get', '/vendors/{id}', 'Get a public vendor store', 'Vendors', false],
  ['get', '/products', 'Search and list products', 'Products', false],
  ['get', '/products/{slug}', 'Get a product by slug', 'Products', false],
  ['post', '/products', 'Create a product', 'Products', true],
  ['patch', '/products/{id}', 'Update a product', 'Products', true],
  ['delete', '/products/{id}', 'Soft-delete a product', 'Products', true],
  ['get', '/products/{id}/reviews', 'List product reviews', 'Reviews', false],
  ['post', '/products/{id}/reviews', 'Review a purchased product', 'Reviews', true],
  ['get', '/cart', 'Get the current cart', 'Cart', true],
  ['post', '/cart/items', 'Add a cart item', 'Cart', true],
  ['patch', '/cart/items/{itemId}', 'Update a cart item', 'Cart', true],
  ['delete', '/cart/items/{itemId}', 'Remove a cart item', 'Cart', true],
  ['get', '/wallet', 'Get wallet balances', 'Wallets', true],
  ['get', '/wallet/transactions', 'List wallet transactions', 'Wallets', true],
  ['post', '/wallet/fund', 'Initialize NGN wallet funding', 'Wallets', true],
  ['post', '/webhooks/paystack', 'Receive a verified Paystack event', 'Payments', false],
  ['post', '/orders/checkout', 'Check out the current cart', 'Orders', true],
  ['get', '/orders', 'List buyer orders', 'Orders', true],
  ['get', '/orders/{id}', 'Get an order', 'Orders', true],
  ['post', '/orders/{id}/cancel', 'Cancel an unshipped order', 'Orders', true],
  ['get', '/vendor/orders', 'List vendor sub-orders', 'Orders', true],
  ['patch', '/sub-orders/{id}/ship', 'Mark a sub-order shipped', 'Orders', true],
  ['patch', '/sub-orders/{id}/confirm', 'Confirm delivery', 'Orders', true],
  ['post', '/sub-orders/{id}/disputes', 'Open a sub-order dispute', 'Disputes', true],
  ['get', '/disputes', 'List disputes for admins', 'Disputes', true],
  ['patch', '/disputes/{id}/resolve', 'Resolve a dispute', 'Disputes', true],
  ['post', '/payouts', 'Request a vendor payout', 'Payouts', true],
  ['get', '/payouts', 'List vendor payouts', 'Payouts', true],
  ['get', '/notifications', 'List notifications', 'Notifications', true],
  ['get', '/notifications/unread-count', 'Get unread notification count', 'Notifications', true],
  ['patch', '/notifications/{id}/read', 'Mark a notification read', 'Notifications', true],
  ['patch', '/notifications/read-all', 'Mark all notifications read', 'Notifications', true],
  ['get', '/admin/users', 'Search users', 'Administration', true],
  ['patch', '/admin/users/{id}/freeze', 'Freeze or unfreeze a user', 'Administration', true],
  ['get', '/admin/vendors', 'List pending vendor applications', 'Administration', true],
  ['patch', '/admin/vendors/{id}/approve', 'Approve a vendor', 'Administration', true],
  ['patch', '/admin/vendors/{id}/reject', 'Reject a vendor', 'Administration', true],
  ['get', '/admin/wallets/{id}/ledger', 'View wallet ledger entries', 'Administration', true],
  ['patch', '/admin/settings/commission', 'Set the commission rate', 'Administration', true],
  ['get', '/admin/settings/exchange-rates', 'List exchange-rate snapshots', 'Administration', true],
  ['patch', '/admin/settings/exchange-rates', 'Record an exchange-rate snapshot', 'Administration', true],
  ['get', '/admin/reports/revenue', 'Report daily platform revenue', 'Reports', true],
  ['get', '/admin/reports/top-vendors', 'Report top vendors this month', 'Reports', true],
  ['get', '/admin/reports/escrow', 'Report held escrow balances', 'Reports', true],
  ['get', '/admin/reports/reconciliation', 'Report wallet reconciliation', 'Reports', true]
];

const paths = {};
for (const [method, path, summary, tag, authenticated] of routes) {
  if (!paths[path]) paths[path] = {};
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' }
  }));
  paths[path][method] = {
    tags: [tag],
    summary,
    ...(parameters.length ? { parameters } : {}),
    ...(authenticated ? { security: [{ bearerAuth: [] }] } : {}),
    responses: {
      200: { description: 'Request completed successfully' },
      400: { description: 'Request validation failed' },
      401: { description: 'Authentication or provider signature failed' },
      403: { description: 'The current account is not permitted to perform this action' },
      409: { description: 'The request conflicts with current state' }
    }
  };
}

module.exports = paths;
