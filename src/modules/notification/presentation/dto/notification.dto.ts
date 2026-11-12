import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  FEED_MAX_LIMIT,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '../../domain/notification.model';

export class FeedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FEED_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;

  @IsOptional()
  @IsIn(NOTIFICATION_CATEGORIES)
  category?: NotificationCategory;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unreadOnly?: boolean;
}

export class PreferenceItemDto {
  @IsIn(NOTIFICATION_CATEGORIES)
  category: NotificationCategory;

  @IsBoolean()
  push: boolean;

  @IsBoolean()
  email: boolean;
}

export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_CATEGORIES.length)
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  items: PreferenceItemDto[];
}
