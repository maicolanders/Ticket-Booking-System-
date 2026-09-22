import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { signAuthToken } from '../../lib/jwt';
import { badRequest, unauthorized } from '../../lib/errors';
import type { RegisterInput, LoginInput, AuthResponseDTO } from '@ticket/shared';

function toAuthResponse(user: User): AuthResponseDTO {
  const token = signAuthToken({ sub: user.id, role: user.role, email: user.email });
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

export async function register(input: RegisterInput): Promise<AuthResponseDTO> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw badRequest('An account with this email already exists');

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, name: input.name, role: input.role },
  });
  return toAuthResponse(user);
}

export async function login(input: LoginInput): Promise<AuthResponseDTO> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw unauthorized('Invalid email or password');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw unauthorized('Invalid email or password');

  return toAuthResponse(user);
}
