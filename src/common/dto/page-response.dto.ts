import { ApiResponseDto } from './api-response.dto';

export class PageResponseDto<T> extends ApiResponseDto<T[]> {
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasMore: boolean;

  constructor(result: T[], page: number, size: number, totalElements: number) {
    super({ result });
    this.page = page;
    this.size = size;
    this.totalElements = totalElements;
    this.totalPages = Math.ceil(totalElements / size);
    this.hasMore = page < this.totalPages;
  }
}
