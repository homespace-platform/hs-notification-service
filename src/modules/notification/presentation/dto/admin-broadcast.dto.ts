import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { isSafeActionPath, BODY_MAX, TITLE_MAX } from '../../domain/notification-content';

export class AdminBroadcastDto {
  @IsUUID('4')
  broadcastId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX)
  @Matches(/\S/)
  // eslint-disable-next-line no-control-regex -- Reject control characters in admin-authored content.
  @Matches(/^[^<>\u0000-\u001f\u007f]+$/)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(BODY_MAX)
  @Matches(/\S/)
  // eslint-disable-next-line no-control-regex -- Permit newlines but reject other control characters.
  @Matches(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/)
  body!: string;

  @IsIn(['NORMAL', 'HIGH', 'URGENT'])
  priority!: 'NORMAL' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  actionPath?: string;

  isValidActionPath(): boolean {
    return this.actionPath === undefined || isSafeActionPath(this.actionPath);
  }
}
