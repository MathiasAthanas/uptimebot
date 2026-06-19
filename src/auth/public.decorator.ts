import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC } from './auth.guard';

export const Public = () => SetMetadata(IS_PUBLIC, true);
