import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService, private config: ConfigService) {}

  login(username: string, password: string): { token: string; username: string } {
    const validUser = this.config.get<string>('ADMIN_USERNAME', 'admin');
    const validPass = this.config.get<string>('ADMIN_PASSWORD', 'admin');
    if (username !== validUser || password !== validPass) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const token = this.jwt.sign(
      { sub: username, username },
      { secret: this.config.get<string>('JWT_SECRET', 'uptimebot-secret') },
    );
    return { token, username };
  }

  verify(token: string): any {
    return this.jwt.verify(token, {
      secret: this.config.get<string>('JWT_SECRET', 'uptimebot-secret'),
    });
  }
}
