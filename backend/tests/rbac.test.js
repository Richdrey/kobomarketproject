const { requireRoles } = require('../src/middleware/auth');

describe('role-based access control', () => {
  test.each(['vendor', 'admin'])('denies a buyer access to %s routes', (requiredRole) => {
    const req = { user: { roles: ['buyer'] } };
    const next = jest.fn();
    requireRoles(requiredRole)(req, {}, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' })
    );
  });
});
