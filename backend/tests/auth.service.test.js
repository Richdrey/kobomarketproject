jest.mock('../src/models/user.models', () => ({ findOne: jest.fn() }));
jest.mock('../src/models/refresh-session.models', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn()
}));
jest.mock('../src/repositories/user.repository', () => ({
  findByEmail: jest.fn(),
  findById: jest.fn(),
  create: jest.fn()
}));
jest.mock('../src/services/wallet.service', () => ({ provisionUserWallets: jest.fn() }));
jest.mock('../src/helper/email', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }));

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const RefreshSession = require('../src/models/refresh-session.models');
const userRepository = require('../src/repositories/user.repository');
const authService = require('../src/services/auth.service');

describe('authentication service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
  });

  test('rejects login before email verification', async () => {
    userRepository.findByEmail.mockResolvedValue({
      _id: 'user-id',
      password: await bcrypt.hash('correct horse battery', 4),
      isVerified: false,
      accountStatus: 'active'
    });

    await expect(authService.login({
      email: 'buyer@example.com',
      password: 'correct horse battery'
    })).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED', statusCode: 403 });
    expect(RefreshSession.create).not.toHaveBeenCalled();
  });

  test('revokes all sessions when a refresh token is reused', async () => {
    const token = jwt.sign(
      {},
      process.env.JWT_REFRESH_SECRET,
      {
        subject: 'user-id',
        jwtid: 'used-session',
        issuer: 'kobomarket',
        audience: 'kobomarket-api',
        expiresIn: '7d'
      }
    );
    RefreshSession.findOne.mockResolvedValue({
      tokenHash: 'already-rotated',
      revokedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60_000)
    });

    await expect(authService.refresh(token))
      .rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSE', statusCode: 401 });
    expect(RefreshSession.updateMany).toHaveBeenCalledWith(
      { userId: 'user-id', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
  });
});
